import type { VercelRequest, VercelResponse } from "@vercel/node";

import { getGbplPriceData } from "../lib/price.js";

interface PriceResponse {
  price: number;
  apr: number;
  startDate: string;
  startPrice: number;
  daysElapsed: number;
}

export default function handler(
  _request: VercelRequest,
  response: VercelResponse,
) {
  try {
    const priceData = getGbplPriceData();

    const result: PriceResponse = {
      price: Math.round(priceData.price * 10000) / 10000, // Round to 4 decimal places
      apr: priceData.apr,
      startDate: priceData.startDate,
      startPrice: priceData.startPrice,
      daysElapsed: priceData.daysElapsed,
    };

    response.status(200).json(result);
  } catch (error) {
    response.status(500).json({
      error: "Failed to calculate GBPL price",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
