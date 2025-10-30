// Centralized Redis keys and key builders

// Global totals and indexes
export const STAKE_TOTAL_GBPL_KEY = "stake:total:gbpl";
export const STAKE_PENDING_BTC_SET_KEY = "stake:pending:btc";

// Dynamic keys/builders
export const stakeRecordKey = (signature: string) =>
  `stake:record:${signature}`;
export const userStakesSetKey = (userAddress: string) =>
  `stake:user:${userAddress}`;
export const processedRedeemKey = (signature: string) =>
  `processed_redeem:${signature}`;

// Map of BTC deposit txids per stake, keyed by btc pubkey (hex)
export const stakeBtcDepositTxMapKey = (stakeId: string) =>
  `stake:btc-deposit-tx:${stakeId}`;
