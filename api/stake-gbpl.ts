import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { StakeRecord, StakeRequest } from "../lib/stake-types";

import { Redis } from "@upstash/redis";

// Initialize Redis
const redis = Redis.fromEnv();

// Redis key for total GBPL staked (all users, all statuses)
const STAKE_TOTAL_GBPL_KEY = "stake:total:gbpl";
// Redis key for pending BTC deposit stakes (global index - using Set)
const STAKE_PENDING_BTC_KEY = "stake:pending:btc";

async function get(request: VercelRequest, response: VercelResponse) {
  try {
    const userAddress = request.query.userAddress as string | undefined;

    // Get all pending BTC deposit stakes from global index (using Redis Set)
    const stakeKeys: string[] =
      (await redis.smembers(STAKE_PENDING_BTC_KEY)) || [];

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

    if (userAddress) {
      const userStakesKey = `stake:user:${userAddress}`;
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

    response.status(200).json({
      success: true,
      stakes: pendingStakes,
      count: pendingStakes.length,
      totalGbplStaked:
        typeof totalRaw === "string" ? totalRaw : totalRaw?.toString() || "0",
      userStakes,
      userStakesCount,
    });
  } catch (error) {
    console.error("Error fetching stakes:", error);

    response.status(500).json({ error: "Internal server error" });
  }
}

async function post(request: VercelRequest, response: VercelResponse) {
  try {
    const body: StakeRequest = request.body;
    const { userAddress, signature, gbplAmountRaw, stakePeriod } = body;

    // Validate required fields
    if (!userAddress || !signature || !gbplAmountRaw || !stakePeriod) {
      response.status(400).json({ error: "Missing required fields" });

      return;
    }

    // Check if transaction already processed
    const stakeKey = `stake:record:${signature}`;
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

    // Calculate maturity date based on stake period
    const now = new Date();
    const days = stakePeriod === "6m" ? 180 : 90;
    const maturityDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // Generate hash from GBPL transaction signature
    // Preimage will be regenerated from signature when needed (e.g., in redeem API)
    const { hash: htlcHash } = await generatePreimageAndHash(signature);

    // Create stake record
    // Use signature as the unique ID since all storage and queries are based on signature
    // Note: signature field removed from record (redundant with id, can be extracted from key)
    const stakeRecord: StakeRecord = {
      id: signature,
      userAddress,
      gbplAmountRaw,
      stakePeriod,
      status: "active",
      createdAt: now.toISOString(),
      maturityDate: maturityDate.toISOString(),
      htlcHash,
      htlcStatus: "waiting", // Waiting for BTC to be locked
      btcAddress: generateMockBTCAddress(),
      btcAmount: calculateRequiredBTCAmount(gbplAmountRaw),
    };

    // Store the stake record in Redis (without preimage)
    await redis.set(stakeKey, JSON.stringify(stakeRecord));

    // Also store by user address for querying (using Redis Set for atomic operations)
    const userStakesKey = `stake:user:${userAddress}`;

    // SADD returns the number of elements added (0 if already exists, 1 if new)
    await redis.sadd(userStakesKey, stakeKey);

    // Add to global pending BTC deposit list (using Redis Set for atomic operations)
    // SADD automatically handles deduplication, so no need to check if exists
    await redis.sadd(STAKE_PENDING_BTC_KEY, stakeKey);

    // Update global total GBPL staked atomically using INCRBY
    // INCRBY is atomic and handles concurrent requests safely
    // LIMITATION: parseInt() limits to Number.MAX_SAFE_INTEGER (2^53 - 1)
    // Maximum supported: ~9,007,199 GBPL (~9M GBPL)
    // This is sufficient for hackathon/demo, but production needs:
    // - Use BigInt for string parsing, or
    // - Store as string and use Lua script for string-based arithmetic
    // Convert gbplAmountRaw (string) to number for INCRBY
    const incrementAmount = parseInt(gbplAmountRaw, 10);

    // Use INCRBY for atomic increment operation
    // If the key doesn't exist, it will be initialized to 0 first, then incremented
    await redis.incrby(STAKE_TOTAL_GBPL_KEY, incrementAmount);

    // Log the stake for debugging
    console.log("New stake recorded:", {
      id: stakeRecord.id,
      userAddress,
      gbplAmount: gbplAmountRaw,
      stakePeriod,
      htlcHash,
    });

    // Return success response
    response.status(200).json({
      success: true,
      stakeRecord: {
        id: stakeRecord.id,
        status: stakeRecord.status,
        maturityDate: stakeRecord.maturityDate,
        htlcHash: stakeRecord.htlcHash,
        htlcStatus: stakeRecord.htlcStatus,
        btcAddress: stakeRecord.btcAddress,
        btcAmount: stakeRecord.btcAmount,
      },
      explorerUrl: `https://solscan.io/tx/${signature}?cluster=devnet`,
      htlcInfo: {
        message: "HTLC prepared for BTC locking",
        btcAddress: stakeRecord.btcAddress,
        btcAmount: stakeRecord.btcAmount,
        htlcHash: stakeRecord.htlcHash,
        instructions: [
          "Send BTC to the provided address",
          "Include the HTLC hash in the transaction",
          "BTC will be locked until GBPL stake matures or early redemption",
        ],
      },
    });
  } catch (error) {
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
      console.log(err);
      response.status(400).send(err.message);
    } else {
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

// Generate mock BTC address for HTLC
function generateMockBTCAddress(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let result = "1"; // Legacy address format

  for (let i = 0; i < 25; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

// Calculate required BTC amount based on GBPL staked (mock calculation)
function calculateRequiredBTCAmount(gbplAmountRaw: string): string {
  // Mock calculation: 1 BTC per 1000 GBPL (simplified)
  const gbplAmount = parseFloat(gbplAmountRaw) / 1e6; // Convert from raw to actual amount
  const btcAmount = gbplAmount / 1000;

  return btcAmount.toFixed(8);
}
