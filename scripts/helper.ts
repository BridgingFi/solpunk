import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
} from '@solana/kit';
import * as dotenv from 'dotenv';
dotenv.config();

// Create Connection, default to devnet
export const rpc = createSolanaRpc(
  process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
);
export const rpcSubscriptions = createSolanaRpcSubscriptions(
  process.env.SOLANA_WS_URL || 'wss://api.devnet.solana.com'
);

// Get authority private key from environment variable
if (!process.env.AUTHORITY_PRIVATE_KEY) {
  throw new Error('AUTHORITY_PRIVATE_KEY is not set');
}

export const authority = await createKeyPairSignerFromBytes(
  new Uint8Array(JSON.parse(process.env.AUTHORITY_PRIVATE_KEY))
);
console.log('🔑 Authority address: %s', authority.address);

// Check authority balance
const balance = await rpc.getBalance(authority.address).send();
console.log('💰 Authority balance: %O lamports', balance.value);
