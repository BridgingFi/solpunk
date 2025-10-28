/**
 * Token configuration constants
 */
export const TOKEN_CONFIG = {
  USDC: {
    DECIMALS: 6,
    SYMBOL: "USDC",
  },
  GBPL: {
    DECIMALS: 9,
    SYMBOL: "GBPL",
  },
} as const;

/**
 * Price calculation configuration
 */
export const PRICE_CONFIG = {
  START_DATE: "2025-01-01",
  START_PRICE: 1.0,
  APR: 0.08, // 8%
} as const;
