export interface StakeRequest {
  userAddress: string;
  btcPubkey: string;
  signature: string;
  stakePeriod: string;
}

export interface StakeRecord {
  id: string; // Transaction signature (unique identifier)
  userAddress: string;
  gbplAmountRaw: string;
  stakePeriod: string;
  status: "pending" | "active" | "completed" | "cancelled";
  createdAt: string;
  htlcHash?: string;
  htlcStatus?: "waiting" | "locked" | "unlocked" | "expired";
}

export interface StakeApiResponse {
  success: boolean;
  stakes: StakeRecord[];
  count: number;
  totalGbplStaked?: string; // Total GBPL staked across all users (raw value as string)
  userStakes?: StakeRecord[]; // User's stakes (if userAddress provided)
  userStakesCount?: number; // Count of user's stakes
  btcStakes?: string[]; // BTC stakes (if btcPubkey provided)
  btcStakesCount?: number; // Count of BTC stakes
  error?: string;
}
