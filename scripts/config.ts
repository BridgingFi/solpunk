// GBPL Token Configuration
export const TOKEN_CONFIG = {
  name: '[Devnet] Governance Bridging Products - Loan',
  symbol: 'GBPL',
  uri: 'https://raw.githubusercontent.com/solana-developers/opos-asset/main/assets/DeveloperPortal/metadata.json',
  description:
    '[Devnet] BridgingFi yield-bearing token backed by UK real estate bridging loans',
  decimals: 9,
} as const;

// Interest rate configuration (in basis points)
export const INTEREST_CONFIG = {
  rate: 500, // 5.00% annualized interest
} as const;
