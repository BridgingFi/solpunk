import { PRICE_CONFIG } from "./config.js";

/**
 * Calculate GBPL price based on compound interest from start date
 * @param startDate Start date for price calculation (YYYY-MM-DD)
 * @param startPrice Starting price in USD
 * @param apr Annual percentage rate (e.g., 0.08 for 8%)
 * @returns Object with price and apr
 */
export function getGbplPriceData(
  startDate: string = PRICE_CONFIG.START_DATE,
  startPrice: number = PRICE_CONFIG.START_PRICE,
  apr: number = PRICE_CONFIG.APR,
) {
  const start = new Date(startDate);
  const now = new Date();

  // Calculate days since start
  const timeDiff = now.getTime() - start.getTime();
  const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));

  // Calculate compound interest: price = startPrice * (1 + apr/365)^days
  const dailyRate = apr / 365;
  const price = startPrice * Math.pow(1 + dailyRate, daysDiff);

  return {
    price: price,
    apr: apr * 100, // Convert to percentage
    startDate: startDate,
    startPrice: startPrice,
    daysElapsed: daysDiff,
  };
}
