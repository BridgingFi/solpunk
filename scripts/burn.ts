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
  getBurnCheckedInstruction,
  getCloseAccountInstruction,
} from "@solana-program/token-2022";
import { authority, rpc, rpcSubscriptions } from "./helper";

// Parse command line arguments
// Usage: tsx scripts/burn.ts <amount>
const args = process.argv.slice(2);

if (args.length < 1) {
  console.error("Usage: npx tsx scripts/burn.ts <amount>");
  process.exit(1);
}

const amount = Number(args[0]);

if (!process.env.VITE_GBPL_MINT_ADDRESS) {
  throw new Error("VITE_GBPL_MINT_ADDRESS is not set");
}

const mintAddress = address(process.env.VITE_GBPL_MINT_ADDRESS);

// Derive the associated token account address from authority wallet address
const [associatedTokenAddress] = await findAssociatedTokenPda({
  owner: authority.address,
  tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  mint: mintAddress,
});

console.log("Burning tokens...");
console.log("Mint Address:", mintAddress.toString());
console.log("Amount to burn (uiAmountString):", amount);
console.log("Authority Address:", authority.address);
console.log("Token Account:", associatedTokenAddress.toString());

// Fetch mint info to get decimals
const mintData = await fetchMint(rpc, mintAddress);
const decimals = mintData.data.decimals;

console.log("Decimals:", decimals);

const amountRaw = BigInt(amount * 10 ** decimals);

console.log("Amount to burn (raw):", amountRaw);

// Build the instruction list
const instructions: Instruction[] = [];

// Check if the associated token account exists and log the result
const tokenAccountInfo = await rpc
  .getAccountInfo(associatedTokenAddress, { encoding: "base64" })
  .send();
if (!tokenAccountInfo.value) {
  throw new Error("Token account does not exist. Cannot burn tokens.");
}

console.log("\nChecking balance before burning...");
let beforeBalance;
try {
  beforeBalance = await rpc
    .getTokenAccountBalance(associatedTokenAddress)
    .send();
  console.log(
    "Balance before (uiAmountString):",
    beforeBalance.value.uiAmountString,
  );
  console.log("\t\t(raw):", beforeBalance.value.amount);

  // Check if we have enough balance to burn
  const balanceRaw = BigInt(beforeBalance.value.amount);
  if (balanceRaw < amountRaw) {
    throw new Error(
      `Insufficient balance. Have ${balanceRaw}, trying to burn ${amountRaw}`,
    );
  }
} catch (error) {
  console.log("Error checking balance:", error);
  throw error;
}

// Create burn instruction
const burnInstruction = getBurnCheckedInstruction({
  account: associatedTokenAddress,
  mint: mintAddress,
  authority,
  amount: amountRaw,
  decimals: decimals,
});

instructions.push(burnInstruction);

// Check if we should close the token account (if balance after burn would be 0)
const beforeBalanceRaw = BigInt(beforeBalance.value.amount);
const willHaveZeroBalance = beforeBalanceRaw === amountRaw;

if (willHaveZeroBalance) {
  console.log(
    "\nWill have zero balance after burn. Adding close account instruction...",
  );

  // Close the token account
  const closeInstruction = getCloseAccountInstruction({
    account: associatedTokenAddress,
    destination: authority.address,
    owner: authority,
  });

  instructions.push(closeInstruction);
}

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

console.log("\nSuccessfully burned tokens");
console.log("Amount:", amount.toString());
console.log("From:", associatedTokenAddress.toString());
console.log("Transaction Signature:", transactionSignature);

if (willHaveZeroBalance) {
  console.log("\nToken account has been closed.");
} else {
  // Get balance after burning
  console.log("\nChecking balance after burning...");
  try {
    const afterBalance = await rpc
      .getTokenAccountBalance(associatedTokenAddress)
      .send();
    console.log(
      "Balance after (uiAmountString):",
      afterBalance.value.uiAmountString,
    );
    console.log("\t\t(raw):", afterBalance.value.amount);
  } catch (error) {
    console.log(
      "Could not fetch balance after burn (account may be closed):",
      error,
    );
  }
}
