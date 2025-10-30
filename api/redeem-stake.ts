import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { StakeRecord } from "../lib/stake-types";

import { Redis } from "@upstash/redis";
import {
  address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getPublicKeyFromAddress,
  signatureBytes,
  verifySignature as verifySignatureKit,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
  getCreateAssociatedTokenInstructionAsync,
  fetchMint,
  getTransferCheckedInstruction,
} from "@solana-program/token-2022";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";

import { assembleRedeemMessage } from "../lib/message-signature";

// Initialize Redis
const redis = Redis.fromEnv();

// Redis key for pending BTC deposit stakes (global index - using Set)
const STAKE_PENDING_BTC_KEY = "stake:pending:btc";

// Verify signature using Solana Kit's verifySignature function
async function verifySignature(
  message: string,
  signatureBase64: string,
  publicKeyBase58: string,
): Promise<boolean> {
  try {
    // Decode signature from base64 to bytes
    const signatureBytesDecoded = Uint8Array.from(atob(signatureBase64), (c) =>
      c.charCodeAt(0),
    );

    // Validate signature is 64 bytes (Ed25519 signature length)
    if (signatureBytesDecoded.length !== 64) {
      // eslint-disable-next-line no-console
      console.error(
        `Invalid signature length: ${signatureBytesDecoded.length} (expected 64)`,
      );

      return false;
    }

    // Convert to SignatureBytes type
    const signatureBytesTyped = signatureBytes(signatureBytesDecoded);

    // Validate and get address object from base58 string
    const addressObj = address(publicKeyBase58);

    // Get public key CryptoKey from address
    const publicKeyCrypto = await getPublicKeyFromAddress(addressObj);

    // Encode message (must match frontend)
    const messageBytes = new TextEncoder().encode(message);

    // Use Solana Kit's verifySignature function
    const isValid = await verifySignatureKit(
      publicKeyCrypto,
      signatureBytesTyped,
      messageBytes,
    );

    return isValid;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Signature verification error:", error);

    return false;
  }
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });

    return;
  }

  try {
    const { stakeId, userAddress, signature, message, timestamp } =
      request.body;

    if (!stakeId || !userAddress || !signature || !message) {
      response.status(400).json({ error: "Missing required fields" });

      return;
    }

    // Verify timestamp is recent (within 5 minutes) to prevent replay attacks
    if (timestamp) {
      const timestampAge = Date.now() - timestamp;
      const maxAge = 5 * 60 * 1000; // 5 minutes

      if (timestampAge > maxAge || timestampAge < 0) {
        response.status(400).json({
          error: "Signature expired or invalid timestamp",
        });

        return;
      }
    }

    // Verify message format
    const expectedMessage = assembleRedeemMessage(
      stakeId,
      userAddress,
      timestamp,
    );

    if (message !== expectedMessage) {
      response.status(400).json({
        error: "Invalid message format",
      });

      return;
    }

    // Verify signature
    const isValidSignature = await verifySignature(
      message,
      signature,
      userAddress,
    );

    if (!isValidSignature) {
      response.status(401).json({
        error: "Invalid signature",
      });

      return;
    }

    // Sanitize stakeId to prevent injection
    const sanitizedStakeId = stakeId.replace(/[^a-zA-Z0-9+/=]/g, "");

    if (sanitizedStakeId !== stakeId) {
      response.status(400).json({ error: "Invalid stake ID format" });

      return;
    }

    // Get stake record from Redis
    const stakeKey = `stake:record:${sanitizedStakeId}`;
    const stakeRecordData = await redis.get(stakeKey);

    if (!stakeRecordData) {
      response.status(404).json({ error: "Stake record not found" });

      return;
    }

    // Handle case where Redis returns parsed object or string
    const stakeRecord: StakeRecord =
      typeof stakeRecordData === "string"
        ? (JSON.parse(stakeRecordData) as StakeRecord)
        : (stakeRecordData as StakeRecord);

    // Verify user owns this stake
    if (stakeRecord.userAddress !== userAddress) {
      response
        .status(403)
        .json({ error: "Unauthorized: User does not own this stake" });

      return;
    }

    // Verify stake is in a valid state for redemption
    if (stakeRecord.status !== "active" && stakeRecord.status !== "pending") {
      response.status(400).json({
        error: `Cannot redeem stake in ${stakeRecord.status} status`,
      });

      return;
    }

    // Get configuration
    const GBPL_MINT_ADDRESS = process.env.VITE_GBPL_MINT_ADDRESS;
    const GBPL_VAULT_TOKEN_ACCOUNT = process.env.VITE_GBPL_VAULT_TOKEN_ACCOUNT;

    if (!GBPL_MINT_ADDRESS || !GBPL_VAULT_TOKEN_ACCOUNT) {
      response.status(500).json({ error: "Configuration missing" });

      return;
    }

    // Get authority from private key
    const authorityPrivateKey = process.env.AUTHORITY_PRIVATE_KEY;

    if (!authorityPrivateKey) {
      response.status(500).json({ error: "Authority key not configured" });

      return;
    }

    const keyPairArray = JSON.parse(authorityPrivateKey);
    const keyPairBytes = new Uint8Array(keyPairArray);
    const authority = await createKeyPairSignerFromBytes(keyPairBytes);

    // Initialize Solana RPC
    const rpcUrl =
      process.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const rpc = createSolanaRpc(rpcUrl);

    const gbplMintAddress = address(GBPL_MINT_ADDRESS);
    const userAddressObj = address(userAddress);
    const vaultAddress = address(GBPL_VAULT_TOKEN_ACCOUNT);

    // Convert gbplAmountRaw (string) to BigInt
    const gbplAmountRaw = BigInt(stakeRecord.gbplAmountRaw);

    // Find user's GBPL associated token account
    const [userGbplTokenAccount] = await findAssociatedTokenPda({
      owner: userAddressObj,
      mint: gbplMintAddress,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    // Check if token account exists, create if needed
    const tokenAccountInfo = await rpc
      .getAccountInfo(userGbplTokenAccount, { encoding: "base64" })
      .send();

    const instructions: any[] = [];

    if (!tokenAccountInfo.value) {
      // Create associated token account
      const createTokenAccountInstruction =
        await getCreateAssociatedTokenInstructionAsync({
          payer: authority,
          mint: gbplMintAddress,
          owner: userAddressObj,
          tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });

      instructions.push(createTokenAccountInstruction);
    }

    // Fetch GBPL mint to get decimals
    const gbplMint = await fetchMint(rpc, gbplMintAddress);
    const decimals = gbplMint.data.decimals;

    // Instruction: Transfer GBPL from vault to user
    const transferInstruction = getTransferCheckedInstruction({
      amount: gbplAmountRaw,
      authority: authority,
      decimals,
      destination: userGbplTokenAccount,
      mint: gbplMintAddress,
      source: vaultAddress,
    });

    instructions.push(transferInstruction);

    // Get latest blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    // Create transaction message
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx: any) => setTransactionMessageFeePayerSigner(authority, tx),
      (tx: any) =>
        setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx: any) => appendTransactionMessageInstructions(instructions, tx),
    );

    const signedTransaction = await signTransactionMessageWithSigners(
      transactionMessage as any,
    );

    // Create RPC subscriptions for confirmation
    const rpcSubscriptions = createSolanaRpcSubscriptions(
      process.env.SOLANA_WS_URL || "wss://api.devnet.solana.com",
    );

    // Send and confirm transaction
    await sendAndConfirmTransactionFactory({
      rpc,
      rpcSubscriptions,
    })(signedTransaction as any, { commitment: "confirmed" });

    const transferSignature = getSignatureFromTransaction(signedTransaction);

    // Update stake record status to completed
    const updatedStakeRecord: StakeRecord = {
      ...stakeRecord,
      status: "completed",
    };

    // Update Redis stake record
    await redis.set(stakeKey, JSON.stringify(updatedStakeRecord));

    // Remove from user's stake index
    const userStakesKey = `stake:user:${userAddress}`;

    await redis.srem(userStakesKey, stakeKey);

    // Remove from pending BTC list if it exists
    await redis.srem(STAKE_PENDING_BTC_KEY, stakeKey);

    // Note: We don't update the total GBPL staked counter here
    // because the GBPL is being returned to the user, not removed from the system

    response.status(200).json({
      success: true,
      stakeId: sanitizedStakeId,
      gbplAmountRaw: gbplAmountRaw.toString(),
      transferSignature: transferSignature.toString(),
      explorerUrl: `https://solscan.io/tx/${transferSignature.toString()}?cluster=devnet`,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error redeeming stake:", error);

    response.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
