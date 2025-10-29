/**
 * Shared message signature utilities for API and UI
 */

/**
 * Assemble redeem message from stake ID, address, and timestamp
 */
export function assembleRedeemMessage(
  stakeId: string,
  address: string,
  timestamp: number,
): string {
  return `Redeem stake: ${stakeId}\nAddress: ${address}\nTimestamp: ${timestamp}`;
}
