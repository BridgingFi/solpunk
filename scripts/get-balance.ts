import { address } from "@solana/kit";
import {
  fetchMint,
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { rpc } from "./helper";

// Parse command line arguments
// Usage: tsx scripts/get-balance.ts <wallet_address>
const args = process.argv.slice(2);

if (args.length < 1) {
  console.error("Usage: npx tsx scripts/get-balance.ts <wallet_address>");
  process.exit(1);
}

const receiptAddress = address(args[0]);

if (!process.env.VITE_GBPL_MINT_ADDRESS) {
  throw new Error("VITE_GBPL_MINT_ADDRESS is not set");
}

const mintAddress = address(process.env.VITE_GBPL_MINT_ADDRESS);

console.log("Mint Address:", mintAddress.toString());
console.log("Wallet Address:", receiptAddress);

// Fetch mint info to get decimals
const mintData = await fetchMint(rpc, mintAddress);
const decimals = mintData.data.decimals;

console.log("Decimals:", decimals);

// Derive the associated token account address from wallet address
const [associatedTokenAddress] = await findAssociatedTokenPda({
  owner: receiptAddress,
  tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  mint: mintAddress,
});
console.log("Token Account:", associatedTokenAddress.toString());

// Check if the associated token account exists and log the result
const tokenAccountInfo = await rpc
  .getAccountInfo(associatedTokenAddress, { encoding: "base64" })
  .send();
if (!tokenAccountInfo.value) {
  console.log("Associated token account does not exist");
} else {
  try {
    const balance = await rpc
      .getTokenAccountBalance(associatedTokenAddress)
      .send();
    console.log("Balance(uiAmountString):", balance.value.uiAmountString);
    console.log("\t(raw):", balance.value.amount);
  } catch (error) {
    console.log("Balance: Account not found or has no balance", error);
  }
}
