import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  some,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  extension,
  getInitializeMintInstruction,
  getInitializeMetadataPointerInstruction,
  getMintSize,
  TOKEN_2022_PROGRAM_ADDRESS,
  getInitializeTokenMetadataInstruction,
  getInitializeInterestBearingMintInstruction,
  getInitializeMintCloseAuthorityInstruction,
} from '@solana-program/token-2022';
import { rpc, authority, rpcSubscriptions } from './helper';
import { TOKEN_CONFIG, INTEREST_CONFIG } from './config';

// Generate keypair to use as address of mint
const mint = await generateKeyPairSigner();

// Enable Metadata and Metadata Pointer extensions
const metadataExtension = extension('TokenMetadata', {
  updateAuthority: some(authority.address),
  mint: mint.address,
  name: TOKEN_CONFIG.name,
  symbol: TOKEN_CONFIG.symbol,
  uri: TOKEN_CONFIG.uri,
  additionalMetadata: new Map().set('description', TOKEN_CONFIG.description),
});

const metadataPointerExtension = extension('MetadataPointer', {
  authority: authority.address,
  metadataAddress: mint.address, // can also point to another account if desired
});

// config for interest bearing extension
const timestampNow = BigInt(Math.floor(new Date().getTime() / 1000));
const interestBearingMintExtension = extension('InterestBearingConfig', {
  rateAuthority: authority.address,
  initializationTimestamp: timestampNow,
  lastUpdateTimestamp: timestampNow,
  preUpdateAverageRate: INTEREST_CONFIG.rate,
  currentRate: INTEREST_CONFIG.rate,
});

// And a mint close authority extension.
const mintCloseAuthorityExtension = extension('MintCloseAuthority', {
  closeAuthority: authority.address,
});

// Get mint account size with the metadata pointer extension alone
const spaceWithoutTokenMetadataExtension = BigInt(
  getMintSize([
    interestBearingMintExtension,
    metadataPointerExtension,
    mintCloseAuthorityExtension,
  ])
);

// Get mint account size with all extensions(metadata && metadataPointer)
const spaceWithAllExtensions = BigInt(
  getMintSize([
    interestBearingMintExtension,
    metadataPointerExtension,
    mintCloseAuthorityExtension,
    metadataExtension,
  ])
);

// Get minimum balance for rent exemption
const rent = await rpc
  .getMinimumBalanceForRentExemption(spaceWithAllExtensions)
  .send();

// Instruction to create new account for mint (token program)
// Invokes the system program
const createMintAccountInstruction = getCreateAccountInstruction({
  payer: authority,
  newAccount: mint,
  lamports: rent,
  space: spaceWithoutTokenMetadataExtension,
  programAddress: TOKEN_2022_PROGRAM_ADDRESS,
});

// Initialize metadata extension
const initializeMetadataInstruction = getInitializeTokenMetadataInstruction({
  metadata: mint.address, // Account address that holds the metadata
  updateAuthority: authority.address, // Authority that can update the metadata
  mint: mint.address, // Mint Account address
  mintAuthority: authority, // Designated Mint Authority
  name: TOKEN_CONFIG.name,
  symbol: TOKEN_CONFIG.symbol,
  uri: TOKEN_CONFIG.uri,
});

// Initialize metadata pointer extension
const initializeMetadataPointerInstruction =
  getInitializeMetadataPointerInstruction({
    mint: mint.address,
    authority: authority.address,
    metadataAddress: mint.address,
  });

// Instruction to initialize interest bearing config extension
const initializeInterestBearingConfigInstruction =
  getInitializeInterestBearingMintInstruction({
    mint: mint.address,
    rateAuthority: authority.address,
    rate: INTEREST_CONFIG.rate, // in basis points
  });

// Instruction to initialize the close mint authority extension
const initializeCloseMintInstruction =
  getInitializeMintCloseAuthorityInstruction({
    mint: mint.address,
    closeAuthority: mintCloseAuthorityExtension.closeAuthority,
  });

// Initialize mint account data
const initializeMintInstruction = getInitializeMintInstruction({
  mint: mint.address,
  decimals: TOKEN_CONFIG.decimals,
  mintAuthority: authority.address,
  freezeAuthority: authority.address,
});

// Build the instruction list
const instructions = [
  createMintAccountInstruction,
  initializeInterestBearingConfigInstruction,
  initializeMetadataPointerInstruction,
  initializeCloseMintInstruction,
  initializeMintInstruction,
  initializeMetadataInstruction,
];

// Get latest blockhash to include in transaction
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

// Create transaction message
const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(authority, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  (tx) => appendTransactionMessageInstructions(instructions, tx)
);

// Sign transaction message with all required signers
const signedTransaction = await signTransactionMessageWithSigners(
  transactionMessage
);

// Send and confirm transaction
await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(
  signedTransaction as any,
  { commitment: 'confirmed', skipPreflight: true }
);

// Get transaction signature
const transactionSignature = getSignatureFromTransaction(signedTransaction);

console.log('Mint Address:', mint.address.toString());
console.log('Transaction Signature:', transactionSignature);
