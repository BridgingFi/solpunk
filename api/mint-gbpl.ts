import type { VercelRequest, VercelResponse } from "@vercel/node";

import { Redis } from "@upstash/redis";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  address,
  type Signature,
} from "@solana/kit";
import { getGbplPriceData } from "../lib/price.js";
import { TOKEN_CONFIG } from "../lib/config.js";
import {
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
  getCreateAssociatedTokenInstructionAsync,
  getMintToCheckedInstruction,
  fetchMint,
} from "@solana-program/token-2022";
import {
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
    const { userAddress, signature, usdcAmountRaw } = request.body;

    if (!userAddress || !signature || !usdcAmountRaw) {
      response.status(400).json({ error: "Missing required fields" });
      return;
    }

    const expectedUsdcAmountRaw = BigInt(usdcAmountRaw);

    if (expectedUsdcAmountRaw <= 0) {
      response.status(400).json({ error: "Invalid USDC amount" });
      return;
    }

    // Sanitize signature to prevent injection
    const sanitizedSignature = signature.replace(/[^a-zA-Z0-9+/=]/g, "");
    if (sanitizedSignature !== signature) {
      response.status(400).json({ error: "Invalid signature format" });
      return;
    }

    // Check if this signature has already been processed
    const processed = await redis.get(`processed_tx:${sanitizedSignature}`);
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

    // Calculate GBPL amount from raw USDC amount using BigInt for precision
    const gbplDecimals = TOKEN_CONFIG.GBPL.DECIMALS; // GBPL has 9 decimals
    const usdcDecimals = TOKEN_CONFIG.USDC.DECIMALS; // USDC has 6 decimals

    // Convert USDC amount to GBPL amount with BigInt precision
    // usdcAmountRaw / (10^6) / price * (10^9)
    const usdcAmountScaled = expectedUsdcAmountRaw; // Already in raw units (6 decimals)
    const priceScaled = BigInt(
      Math.floor(priceData.price * 10 ** usdcDecimals),
    ); // Scale price to USDC decimals
    const gbplAmountRaw =
      (usdcAmountScaled * BigInt(10 ** gbplDecimals)) / priceScaled;

    // Verify the actual USDC transfer amount by checking the transaction
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

    // Get USDC vault token account address
    const USDC_VAULT_TOKEN_ACCOUNT = process.env.VITE_USDC_VAULT_TOKEN_ACCOUNT;
    if (!USDC_VAULT_TOKEN_ACCOUNT) {
      response.status(500).json({ error: "USDC vault address not configured" });
      return;
    }

    // Find vault account in transaction and verify transfer amount
    const accountKeys = txDetail.transaction.message.accountKeys;
    const vaultIndex = accountKeys.findIndex(
      (key: any) => key.toString() === USDC_VAULT_TOKEN_ACCOUNT,
    );

    if (vaultIndex === -1) {
      response.status(400).json({
        error: "Vault address not found in transaction",
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
    if (actualTransferAmount !== expectedUsdcAmountRaw) {
      response.status(400).json({
        error: `Transfer amount mismatch. Expected: ${expectedUsdcAmountRaw}, Actual: ${actualTransferAmount}`,
      });
      return;
    }

    // Get GBPL mint address
    const GBPL_MINT_ADDRESS = process.env.VITE_GBPL_MINT_ADDRESS;
    if (!GBPL_MINT_ADDRESS) {
      response.status(500).json({ error: "Configuration missing" });
      return;
    }

    // Mint GBPL to user
    const gbplMintAddress = address(GBPL_MINT_ADDRESS);
    const userAddressObj = address(userAddress);

    // Get authority from private key
    const authorityPrivateKey = process.env.AUTHORITY_PRIVATE_KEY;
    if (!authorityPrivateKey) {
      response.status(500).json({ error: "Authority key not configured" });
      return;
    }

    // Parse the private key from the environment variable
    const keyPairArray = JSON.parse(authorityPrivateKey);
    const keyPairBytes = new Uint8Array(keyPairArray);
    const authority = await createKeyPairSignerFromBytes(keyPairBytes);

    // Find associated token account
    const [associatedTokenAddress] = await findAssociatedTokenPda({
      owner: userAddressObj,
      mint: gbplMintAddress,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    // Check if token account exists
    const tokenAccountInfo = await rpc
      .getAccountInfo(associatedTokenAddress, { encoding: "base64" })
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

    // Create mint instruction
    const mintInstruction = getMintToCheckedInstruction({
      mint: gbplMintAddress,
      token: associatedTokenAddress,
      mintAuthority: authority,
      amount: gbplAmountRaw,
      decimals,
    });
    instructions.push(mintInstruction);

    // Get latest blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    // Create and send mint transaction
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(authority, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions(instructions, tx),
    );

    const signedTransaction =
      await signTransactionMessageWithSigners(transactionMessage);

    // Create RPC subscriptions for confirmation
    const rpcSubscriptions = createSolanaRpcSubscriptions(
      process.env.SOLANA_WS_URL || "wss://api.devnet.solana.com",
    );

    // Mark this signature as processed in Redis (no expiration)
    await redis.set(
      `processed_tx:${sanitizedSignature}`,
      Date.now().toString(),
    );

    await sendAndConfirmTransactionFactory({
      rpc,
      rpcSubscriptions,
    })(signedTransaction as any, { commitment: "confirmed" });

    const mintSignature = getSignatureFromTransaction(signedTransaction);

    response.status(200).json({
      confirmed: true,
      usdcAmountRaw: expectedUsdcAmountRaw.toString(),
      gbplAmountRaw: gbplAmountRaw.toString(),
      mintSignature: mintSignature.toString(),
      explorerUrl: `https://solscan.io/tx/${mintSignature.toString()}?cluster=devnet`,
    });
  } catch (error) {
    console.error("Error checking USDC transfer:", error);
    response.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
