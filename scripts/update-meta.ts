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
  some,
  type Instruction,
} from "@solana/kit";
import {
  extension,
  getMintSize,
  getUpdateTokenMetadataFieldInstruction,
  tokenMetadataField,
  fetchMint,
} from "@solana-program/token-2022";
import { getTransferSolInstruction } from "@solana-program/system";
import { TOKEN_CONFIG } from "./config";
import { authority, rpc, rpcSubscriptions } from "./helper";

if (!process.env.VITE_GBPL_MINT_ADDRESS) {
  throw new Error("VITE_GBPL_MINT_ADDRESS is not set");
}

const mintAddress = address(process.env.VITE_GBPL_MINT_ADDRESS);

// Check current mint account balance
const mintAccount = await rpc
  .getAccountInfo(mintAddress, { encoding: "base64" })
  .send();
if (!mintAccount.value) {
  throw new Error("Mint account not found");
}

const currentBalance = mintAccount.value.lamports;
console.log(
  "Current mint account balance:",
  currentBalance.toString(),
  "lamports",
);

// Fetch and decode mint account to get extensions from chain
const mintData = await fetchMint(rpc, mintAddress);
console.log("Fetched mint account extensions:", mintData.data.extensions);

// Get existing extensions from the mint account (read from chain)
const existingExtensions =
  mintData.data.extensions.__option === "Some"
    ? mintData.data.extensions.value
    : [];
console.log(
  "Existing extensions count:",
  existingExtensions.length,
  "types:",
  existingExtensions.map((ext: any) => ext.__kind),
);

// Filter out any existing TokenMetadata extension to avoid duplicates
const otherExtensions = existingExtensions.filter(
  (ext: any) => ext.__kind !== "TokenMetadata",
);

console.log(
  "Other extensions count (after filtering TokenMetadata):",
  otherExtensions.length,
);

// Add the updated metadata extension
const metadataExtension = extension("TokenMetadata", {
  updateAuthority: some(authority.address),
  mint: mintAddress,
  name: TOKEN_CONFIG.name,
  symbol: TOKEN_CONFIG.symbol,
  uri: TOKEN_CONFIG.uri,
  additionalMetadata: new Map().set("description", TOKEN_CONFIG.description),
});

// Use existing extensions (excluding TokenMetadata) + updated metadata to calculate the required space
const allExtensions = [...otherExtensions, metadataExtension];

// Calculate total space required with all extensions
const requiredSpace = BigInt(getMintSize(allExtensions));

const requiredRent = await rpc
  .getMinimumBalanceForRentExemption(requiredSpace)
  .send();

console.log("Required rent:", requiredRent.toString(), "lamports");

// Calculate additional lamports needed
const additionalLamportsNeeded =
  requiredRent > currentBalance ? requiredRent - currentBalance : BigInt(0);

console.log("Additional lamports needed:", additionalLamportsNeeded.toString());

// Build the instruction list
const instructions: Instruction[] = [];

// Add transfer instruction if additional lamports are needed
if (additionalLamportsNeeded > 0) {
  console.log("Adding transfer instruction to top up rent...");
  instructions.push(
    getTransferSolInstruction({
      source: authority,
      destination: mintAddress,
      amount: additionalLamportsNeeded,
    }),
  );
}

// Add metadata update instructions
instructions.push(
  getUpdateTokenMetadataFieldInstruction({
    metadata: mintAddress, // Account address that holds the metadata
    updateAuthority: authority, // Authority that can update the metadata
    field: tokenMetadataField("Name"), // Field to update
    value: TOKEN_CONFIG.name, // New value
  }),
  getUpdateTokenMetadataFieldInstruction({
    metadata: mintAddress, // Account address that holds the metadata
    updateAuthority: authority, // Authority that can update the metadata
    field: tokenMetadataField("Key", ["description"]), // Field to update
    value: TOKEN_CONFIG.description, // New value
  }),
);

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

console.log("\nSuccessfully updated the token metadata");
console.log("Transaction Signature:", transactionSignature);
