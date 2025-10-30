import type { VercelRequest, VercelResponse } from "@vercel/node";

import { Redis } from "@upstash/redis";
import { findAssociatedTokenPda } from "@solana-program/token-2022";
import {
  TOKEN_PROGRAM_ADDRESS,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  address,
  type Signature,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
  pipe,
  sendAndConfirmTransactionFactory,
  createKeyPairSignerFromBytes,
} from "@solana/kit";

import { TOKEN_CONFIG } from "../lib/config.js";
import { getGbplPriceData } from "../lib/price.js";
import { processedRedeemKey, STAKE_TOTAL_GBPL_KEY } from "../lib/redis-keys.js";

// Initialize Redis
const redis = Redis.fromEnv();

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { userAddress, signature, gbplAmountRaw } = request.body;

    if (!userAddress || !signature || !gbplAmountRaw) {
      response.status(400).json({ error: "Missing required fields" });

      return;
    }

    const expectedGbplAmountRaw = BigInt(gbplAmountRaw);

    if (expectedGbplAmountRaw <= 0) {
      response.status(400).json({ error: "Invalid GBPL amount" });

      return;
    }

    // Sanitize signature to prevent injection
    const sanitizedSignature = signature.replace(/[^a-zA-Z0-9+/=]/g, "");

    if (sanitizedSignature !== signature) {
      response.status(400).json({ error: "Invalid signature format" });

      return;
    }

    // Check if this signature has already been processed
    const processed = await redis.get(processedRedeemKey(sanitizedSignature));

    if (processed) {
      response.status(200).json({
        confirmed: true,
        alreadyProcessed: true,
        message: "This transaction has already been processed",
      });

      return;
    }

    // Initialize Solana RPC
    const rpcUrl =
      process.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const rpc = createSolanaRpc(rpcUrl);

    // Get current GBPL price data
    const priceData = getGbplPriceData();

    // Calculate USDC amount from raw GBPL amount using BigInt for precision
    const gbplDecimals = TOKEN_CONFIG.GBPL.DECIMALS; // GBPL has 9 decimals
    const usdcDecimals = TOKEN_CONFIG.USDC.DECIMALS; // USDC has 6 decimals

    // Convert GBPL amount to USDC amount with BigInt precision
    // gbplAmountRaw / (10^9) * price * (10^6)
    const gbplAmountScaled = expectedGbplAmountRaw; // Already in raw units (9 decimals)
    const priceScaled = BigInt(
      Math.floor(priceData.price * 10 ** usdcDecimals),
    ); // Scale price to USDC decimals
    const usdcAmountRaw =
      (gbplAmountScaled * priceScaled) / BigInt(10 ** gbplDecimals);

    // Verify the actual GBPL transfer amount by checking the transaction
    const signatureObj = sanitizedSignature as Signature;

    // Get transaction details to verify actual transfer amount
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

    // Get GBPL vault token account address
    const GBPL_VAULT_TOKEN_ACCOUNT = process.env.VITE_GBPL_VAULT_TOKEN_ACCOUNT;

    if (!GBPL_VAULT_TOKEN_ACCOUNT) {
      response.status(500).json({ error: "GBPL vault address not configured" });

      return;
    }

    // Find vault account in transaction and verify transfer amount
    const accountKeys = txDetail.transaction.message.accountKeys;
    const vaultIndex = accountKeys.findIndex(
      (key: any) => key.toString() === GBPL_VAULT_TOKEN_ACCOUNT,
    );

    if (vaultIndex === -1) {
      response.status(400).json({
        error: "GBPL vault address not found in transaction",
      });

      return;
    }

    // Check token balances instead of SOL balances
    const preTokenBalances = txDetail.meta.preTokenBalances || [];
    const postTokenBalances = txDetail.meta.postTokenBalances || [];

    // Find the vault's token balance change
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

    // Verify the actual transfer matches expected amount
    if (actualTransferAmount !== expectedGbplAmountRaw) {
      response.status(400).json({
        error: `Transfer amount mismatch. Expected: ${expectedGbplAmountRaw}, Actual: ${actualTransferAmount}`,
      });

      return;
    }

    // Get configuration
    const GBPL_MINT_ADDRESS = process.env.VITE_GBPL_MINT_ADDRESS;
    const USDC_MINT_ADDRESS = process.env.VITE_USDC_MINT_ADDRESS;
    const USDC_VAULT_TOKEN_ACCOUNT = process.env.VITE_USDC_VAULT_TOKEN_ACCOUNT;

    if (!GBPL_MINT_ADDRESS || !USDC_MINT_ADDRESS || !USDC_VAULT_TOKEN_ACCOUNT) {
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

    const usdcMintAddress = address(USDC_MINT_ADDRESS);
    const userAddressObj = address(userAddress);
    const vaultAddress = address(USDC_VAULT_TOKEN_ACCOUNT);

    // Note: usdcDecimals is already defined from TOKEN_CONFIG above

    // Find user's USDC token account
    const [userUsdcTokenAccount] = await findAssociatedTokenPda({
      owner: userAddressObj,
      mint: usdcMintAddress,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const instructions: any[] = [];

    // Instruction: Transfer USDC from vault to user
    // Note: This instruction needs to be signed by the vault authority, not the user
    // For now, we'll use the system authority as the vault authority
    const transferInstruction = getTransferCheckedInstruction({
      source: vaultAddress,
      destination: userUsdcTokenAccount,
      authority: authority,
      mint: usdcMintAddress,
      amount: usdcAmountRaw,
      decimals: usdcDecimals,
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

    // Mark this signature as processed in Redis (no expiration)
    await redis.set(
      processedRedeemKey(sanitizedSignature),
      Date.now().toString(),
    );

    await sendAndConfirmTransactionFactory({
      rpc,
      rpcSubscriptions,
    })(signedTransaction as any, { commitment: "confirmed" });

    const redeemSignature = getSignatureFromTransaction(signedTransaction);

    response.status(200).json({
      confirmed: true,
      gbplAmountRaw: expectedGbplAmountRaw.toString(),
      usdcAmountRaw: usdcAmountRaw.toString(),
      redeemSignature: redeemSignature.toString(),
      explorerUrl: `https://solscan.io/tx/${redeemSignature}?cluster=devnet`,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error processing GBPL redemption:", error);
    response.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
