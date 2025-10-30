import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { StakeRecord, StakeRequest } from "../lib/stake-types";

import { createSolanaRpc, type Signature } from "@solana/kit";
import { Redis } from "@upstash/redis";

import {
  STAKE_TOTAL_GBPL_KEY,
  STAKE_PENDING_BTC_SET_KEY,
  stakeRecordKey,
  userStakesSetKey,
} from "../lib/redis-keys.js";

// Initialize Redis
const redis = Redis.fromEnv();

async function get(request: VercelRequest, response: VercelResponse) {
  try {
    const userAddress = request.query.userAddress as string | undefined;
    const btcPubkey = request.query.btcPubkey as string | undefined;

    // Get all pending BTC deposit stakes from global index (using Redis Set)
    const stakeKeys: string[] =
      (await redis.smembers(STAKE_PENDING_BTC_SET_KEY)) || [];

    // Fetch all stake records
    const stakeRecords = await Promise.all(
      stakeKeys.map(async (key) => {
        const recordData = await redis.get(key);

        if (recordData) {
          // Handle case where Redis returns parsed object or string
          if (typeof recordData === "string") {
            return JSON.parse(recordData) as StakeRecord;
          }

          return recordData as StakeRecord;
        }

        return null;
      }),
    );

    // Filter and validate (status: active/pending, htlcStatus: waiting)
    const pendingStakes = stakeRecords.filter(
      (stake) =>
        stake &&
        (stake.status === "active" || stake.status === "pending") &&
        stake.htlcStatus === "waiting",
    ) as StakeRecord[];

    // Get total GBPL staked (all users, all statuses)
    const totalRaw = await redis.get(STAKE_TOTAL_GBPL_KEY);

    // If userAddress is provided, also fetch user's stakes
    let userStakes: StakeRecord[] | undefined;
    let userStakesCount: number | undefined;
    // If btcPubkey is provided, also fetch BTC stakes
    let btcStakes: string[] | undefined;
    let btcStakesCount: number | undefined;

    if (userAddress) {
      const userStakesKey = userStakesSetKey(userAddress);
      // Use Redis Set for user stakes (atomic operations, automatic deduplication)
      const userStakeKeys: string[] =
        (await redis.smembers(userStakesKey)) || [];

      // Fetch all stake records for this user
      const userStakeRecords = await Promise.all(
        userStakeKeys.map(async (key) => {
          const recordData = await redis.get(key);

          if (recordData) {
            // Handle case where Redis returns parsed object or string
            if (typeof recordData === "string") {
              return JSON.parse(recordData) as StakeRecord;
            }

            return recordData as StakeRecord;
          }

          return null;
        }),
      );

      // Filter out null values
      userStakes = userStakeRecords.filter(
        (stake) => stake !== null,
      ) as StakeRecord[];
      userStakesCount = userStakes.length;
    }

    if (btcPubkey) {
      const stakeKey = userStakesSetKey(btcPubkey);
      const stakeKeys: string[] = (await redis.smembers(stakeKey)) || [];

      btcStakes = stakeKeys;
      btcStakesCount = btcStakes.length;
    }

    response.status(200).json({
      success: true,
      stakes: pendingStakes,
      count: pendingStakes.length,
      totalGbplStaked:
        typeof totalRaw === "string" ? totalRaw : totalRaw?.toString() || "0",
      userStakes,
      userStakesCount,
      btcStakes,
      btcStakesCount,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching stakes:", error);

    response.status(500).json({ error: "Internal server error" });
  }
}

async function post(request: VercelRequest, response: VercelResponse) {
  try {
    const body: StakeRequest = request.body;
    const { userAddress, signature, stakePeriod } = body as any;

    // Validate required fields
    if (!userAddress || !signature || !stakePeriod) {
      response.status(400).json({ error: "Missing required fields" });

      return;
    }

    // Sanitize signature to prevent injection
    const sanitizedSignature = signature.replace(/[^a-zA-Z0-9+/=]/g, "");

    if (sanitizedSignature !== signature) {
      response.status(400).json({ error: "Invalid signature format" });

      return;
    }

    // Check if transaction already processed
    const stakeKey = stakeRecordKey(signature);
    const existingRecordData = await redis.get(stakeKey);

    if (existingRecordData) {
      // Handle case where Redis returns parsed object or string
      const existingRecord =
        typeof existingRecordData === "string"
          ? (JSON.parse(existingRecordData) as StakeRecord)
          : (existingRecordData as StakeRecord);

      response.status(200).json({
        alreadyProcessed: true,
        stakeRecord: existingRecord,
      });

      return;
    }

    // Verify on-chain GBPL transfer amount to the vault equals gbplAmountRaw
    const GBPL_VAULT_TOKEN_ACCOUNT = process.env.VITE_GBPL_VAULT_TOKEN_ACCOUNT;

    if (!GBPL_VAULT_TOKEN_ACCOUNT) {
      response.status(500).json({ error: "GBPL vault address not configured" });

      return;
    }

    const rpcUrl =
      process.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const rpc = createSolanaRpc(rpcUrl);

    const signatureObj = sanitizedSignature as Signature;
    const txDetail = await rpc
      .getTransaction(signatureObj, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
        encoding: "json",
      })
      .send();

    if (!txDetail?.meta) {
      response.status(500).json({ error: "Failed to get transaction details" });

      return;
    }

    // Locate vault token account in the transaction
    const accountKeys = txDetail.transaction.message.accountKeys;
    const vaultIndex = accountKeys.findIndex(
      (key: any) => key.toString() === GBPL_VAULT_TOKEN_ACCOUNT,
    );

    if (vaultIndex === -1) {
      response.status(400).json({
        error: "Vault address not found in transaction",
      });

      return;
    }

    // Compare token balance change for vault
    const preTokenBalances = txDetail.meta.preTokenBalances || [];
    const postTokenBalances = txDetail.meta.postTokenBalances || [];

    const vaultPreBalance = preTokenBalances.find(
      (balance: any) => balance.accountIndex === vaultIndex,
    );
    const vaultPostBalance = postTokenBalances.find(
      (balance: any) => balance.accountIndex === vaultIndex,
    );

    if (!vaultPreBalance || !vaultPostBalance) {
      response.status(400).json({
        error: "Vault token balance not found in transaction",
      });

      return;
    }

    const actualTransferAmount =
      BigInt(vaultPostBalance.uiTokenAmount.amount) -
      BigInt(vaultPreBalance.uiTokenAmount.amount);

    if (actualTransferAmount <= 0n) {
      response.status(400).json({
        error: "Invalid or zero GBPL transfer amount",
      });

      return;
    }

    const actualGbplAmountRawString = actualTransferAmount.toString();

    // Record timestamps
    const now = new Date();

    // Generate hash from GBPL transaction signature
    // Preimage will be regenerated from signature when needed (e.g., in redeem API)
    const { hash: htlcHash } = await generatePreimageAndHash(signature);

    // Create stake record (use signature as unique ID)
    const stakeRecord: StakeRecord = {
      id: signature,
      userAddress,
      gbplAmountRaw: actualGbplAmountRawString,
      stakePeriod,
      status: "active",
      createdAt: now.toISOString(),
      htlcHash,
      htlcStatus: "waiting", // Waiting for BTC to be locked
    };

    // Store the stake record in Redis (without preimage)
    await redis.set(stakeKey, JSON.stringify(stakeRecord));

    // Also store by user address for querying (using Redis Set for atomic operations)
    const userStakesKey = userStakesSetKey(userAddress);

    // SADD returns the number of elements added (0 if already exists, 1 if new)
    await redis.sadd(userStakesKey, stakeKey);

    // Add to global pending BTC deposit list (using Redis Set for atomic operations)
    // SADD automatically handles deduplication, so no need to check if exists
    await redis.sadd(STAKE_PENDING_BTC_SET_KEY, stakeKey);

    // Update global total GBPL staked atomically using INCRBY
    // INCRBY is atomic and handles concurrent requests safely
    // LIMITATION: parseInt() limits to Number.MAX_SAFE_INTEGER (2^53 - 1)
    // Maximum supported: ~9,007,199 GBPL (~9M GBPL)
    // This is sufficient for hackathon/demo, but production needs:
    // - Use BigInt for string parsing, or
    // - Store as string and use Lua script for string-based arithmetic
    // Convert amount (string) to number for INCRBY
    const incrementAmount = parseInt(actualGbplAmountRawString, 10);

    // Use INCRBY for atomic increment operation
    // If the key doesn't exist, it will be initialized to 0 first, then incremented
    await redis.incrby(STAKE_TOTAL_GBPL_KEY, incrementAmount);

    // Log the stake for debugging
    // eslint-disable-next-line no-console
    console.log("New stake recorded:", {
      id: stakeRecord.id,
      userAddress,
      gbplAmount: actualGbplAmountRawString,
      stakePeriod,
      htlcHash,
    });

    // Return success response
    response.status(200).json({
      success: true,
      stakeRecord: {
        id: stakeRecord.id,
        status: stakeRecord.status,
        htlcHash: stakeRecord.htlcHash,
        htlcStatus: stakeRecord.htlcStatus,
      },
      explorerUrl: `https://solscan.io/tx/${signature}?cluster=devnet`,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error processing stake:", error);

    response.status(500).json({ error: "Internal server error" });
  }
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  try {
    switch (request.method) {
      case "GET":
        return get(request, response);

      case "POST":
        return post(request, response);

      default:
        response.status(405).json({ error: "Method not allowed" });

        return;
    }
  } catch (err) {
    if (err instanceof Error) {
      // eslint-disable-next-line no-console
      console.log(err);
      response.status(400).send(err.message);
    } else {
      // eslint-disable-next-line no-console
      console.error(err);
      response.status(500).send("unknown error");
    }

    return;
  }
}

// Generate both preimage and hash from signature (convenience function)
// Returns both preimage (for release) and hash (for storage)
async function generatePreimageAndHash(signature: string): Promise<{
  preimage: Uint8Array;
  hash: string;
}> {
  const preimage = await generatePreimageFromSignature(signature);
  const hash = await generateHTLCHash(preimage);

  return { preimage, hash };
}

// Generate preimage from GBPL transaction signature using root key: HMAC-SHA256(rootKey, signature)
// Only the coordinator with PREIMAGE_ENCRYPTION_KEY can generate the preimage
// PREIMAGE_ENCRYPTION_KEY should be a 32-byte key (64 hex chars or raw bytes)
// Signature is a Solana transaction signature (base58 encoded, 64 bytes when decoded)
// This function can be used in other APIs (e.g., redeem) when only preimage is needed
async function generatePreimageFromSignature(
  signature: string,
): Promise<Uint8Array> {
  const key = process.env.PREIMAGE_ENCRYPTION_KEY;

  if (!key) {
    throw new Error("PREIMAGE_ENCRYPTION_KEY environment variable is required");
  }

  // Convert hex string to bytes (assuming key is hex encoded)
  let keyBytes: Uint8Array;

  if (key.length === 64) {
    // Hex string: 64 chars = 32 bytes
    keyBytes = new Uint8Array(Buffer.from(key, "hex"));
  } else {
    // Raw bytes string or other format, use as-is
    keyBytes = new Uint8Array(Buffer.from(key, "utf8"));
  }

  // Import as HMAC key for use in HMAC-SHA256
  const rootKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(keyBytes).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  // Encode signature as bytes
  const encoder = new TextEncoder();
  const signatureBytes = encoder.encode(signature);

  // HMAC-SHA256(rootKey, signature) -> 32 bytes preimage
  const hmacSignature = await crypto.subtle.sign(
    "HMAC",
    rootKey,
    signatureBytes.buffer,
  );

  return new Uint8Array(hmacSignature);
}

// Generate HTLC hash from preimage (SHA256)
async function generateHTLCHash(preimage: Uint8Array): Promise<string> {
  // Convert to ArrayBuffer to ensure compatibility
  const preimageBuffer = new Uint8Array(preimage).buffer;
  const hashBuffer = await crypto.subtle.digest("SHA-256", preimageBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// (HTLC BTC address and BTC amount are computed on the frontend)
