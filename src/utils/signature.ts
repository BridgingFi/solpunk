import { getBase58Decoder } from "@solana/kit";

/**
 * Convert signature bytes to base58 string for Solscan explorer links
 */
export function signatureToBase58(signature: Uint8Array): string {
  const base58Decoder = getBase58Decoder();
  return base58Decoder.decode(signature);
}

/**
 * Convert signature bytes to base64 string for API calls
 */
export function signatureToBase64(signature: Uint8Array): string {
  return btoa(String.fromCharCode(...signature));
}
