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
} from "@solana/kit";
import { getCloseAccountInstruction } from "@solana-program/token-2022";
import { rpc, authority, rpcSubscriptions } from "./helper";

if (!process.env.VITE_GBPL_MINT_ADDRESS) {
  throw new Error("VITE_GBPL_MINT_ADDRESS is not set");
}
const mintAddress = address(process.env.VITE_GBPL_MINT_ADDRESS);

// Get a fresh blockhash for the close transaction
const { value: closeBlockhash } = await rpc.getLatestBlockhash().send();

// Create instruction to close the token account
const closeAccountInstruction = getCloseAccountInstruction({
  account: mintAddress,
  destination: authority.address,
  owner: authority,
});

// Create transaction message for closing
const closeTxMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(authority, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(closeBlockhash, tx),
  (tx) => appendTransactionMessageInstructions([closeAccountInstruction], tx),
);

// Sign transaction message with all required signers
const signedCloseTx = await signTransactionMessageWithSigners(closeTxMessage);

// Send and confirm transaction
await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedCloseTx as any,
  { commitment: "confirmed" },
);

// Get transaction signature
const transactionSignature2 = getSignatureFromTransaction(signedCloseTx);

console.log("\nSuccessfully closed the token account");
console.log("Transaction Signature:", transactionSignature2);
