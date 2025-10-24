import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
} from "@solana/kit";
import {
  fetchMint,
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
  getCreateAssociatedTokenInstructionAsync,
  getMintToCheckedInstruction,
} from "@solana-program/token-2022";
import { authority, rpc, rpcSubscriptions } from "./helper";

// Parse command line arguments
// Usage: tsx scripts/mint.ts <amount> <wallet_address>
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error("Usage: npx tsx scripts/mint.ts <amount> <wallet_address>");
  process.exit(1);
}

const amount = Number(args[0]);
const receiptAddress = address(args[1]);

if (!process.env.VITE_GBPL_MINT_ADDRESS) {
  throw new Error("VITE_GBPL_MINT_ADDRESS is not set");
}

const mintAddress = address(process.env.VITE_GBPL_MINT_ADDRESS);

// Derive the associated token account address from wallet address
const [associatedTokenAddress] = await findAssociatedTokenPda({
  owner: receiptAddress,
  tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  mint: mintAddress,
});

console.log("Minting tokens...");
console.log("Mint Address:", mintAddress.toString());
console.log("Amount to mint (uiAmountString):", amount);
console.log("Wallet Address:", receiptAddress);
console.log("Token Account:", associatedTokenAddress.toString());

// Fetch mint info to get decimals
const mintData = await fetchMint(rpc, mintAddress);
const decimals = mintData.data.decimals;

console.log("Decimals:", decimals);

const amountRaw = BigInt(amount * 10 ** decimals);

console.log("Amount to mint (raw):", amountRaw);

// Build the instruction list
const instructions: Instruction[] = [];

// Check if the associated token account exists and log the result
const tokenAccountInfo = await rpc
  .getAccountInfo(associatedTokenAddress, { encoding: "base64" })
  .send();
if (!tokenAccountInfo.value) {
  console.log("Associated token account does not exist, creating...");
  const createTokenAccountInstruction =
    await getCreateAssociatedTokenInstructionAsync({
      payer: authority,
      mint: mintAddress,
      owner: receiptAddress,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
  instructions.push(createTokenAccountInstruction);
} else {
  console.log("\nChecking balance before minting...");
  try {
    const beforeBalance = await rpc
      .getTokenAccountBalance(associatedTokenAddress)
      .send();
    console.log(
      "Balance before (uiAmountString):",
      beforeBalance.value.uiAmountString,
    );
    console.log("\t\t(raw):", beforeBalance.value.amount);
  } catch (error) {
    console.log("Balance before: Account not found or has no balance", error);
  }
}

// Create mint instruction
const mintInstruction = getMintToCheckedInstruction({
  mint: mintAddress,
  token: associatedTokenAddress,
  mintAuthority: authority,
  amount: amountRaw,
  decimals: decimals,
});

instructions.push(mintInstruction);

// Get latest blockhash to include in transaction
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

// Create transaction message
const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(authority, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions(instructions, tx),
);

// Sign transaction message with all required signers
const signedTransaction =
  await signTransactionMessageWithSigners(transactionMessage);

console.log("Signed Transaction");

// Send and confirm transaction
await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedTransaction as any,
  { commitment: "confirmed", skipPreflight: true },
);

// Get transaction signature
const transactionSignature = getSignatureFromTransaction(signedTransaction);

console.log("\nSuccessfully minted tokens");
console.log("Amount:", amount.toString());
console.log("To:", associatedTokenAddress.toString());
console.log("Transaction Signature:", transactionSignature);

// Get balance after minting
console.log("\nChecking balance after minting...");
const afterBalance = await rpc
  .getTokenAccountBalance(associatedTokenAddress)
  .send();
console.log(
  "Balance after (uiAmountString):",
  afterBalance.value.uiAmountString,
);
console.log("\t\t(raw):", afterBalance.value.amount);
