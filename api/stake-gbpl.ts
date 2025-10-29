import { NextRequest, NextResponse } from "next/server";

interface StakeRequest {
  userAddress: string;
  signature: string;
  gbplAmountRaw: string;
  stakePeriod: string;
}

interface StakeRecord {
  id: string;
  userAddress: string;
  signature: string;
  gbplAmountRaw: string;
  stakePeriod: string;
  status: "pending" | "active" | "completed" | "cancelled";
  createdAt: string;
  maturityDate: string;
  htlcPreimage?: string;
  htlcHash?: string;
  htlcStatus?: "waiting" | "locked" | "unlocked" | "expired";
  btcAddress?: string;
  btcAmount?: string;
}

// In-memory storage for demo purposes
// In production, this would be stored in a database
const stakeRecords: Map<string, StakeRecord> = new Map();

export async function POST(request: NextRequest) {
  try {
    const body: StakeRequest = await request.json();
    const { userAddress, signature, gbplAmountRaw, stakePeriod } = body;

    // Validate required fields
    if (!userAddress || !signature || !gbplAmountRaw || !stakePeriod) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Check if transaction already processed
    if (stakeRecords.has(signature)) {
      return NextResponse.json(
        {
          alreadyProcessed: true,
          stakeRecord: stakeRecords.get(signature),
        },
        { status: 200 },
      );
    }

    // Calculate maturity date based on stake period
    const now = new Date();
    const days = stakePeriod === "6m" ? 180 : 90;
    const maturityDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // Generate HTLC preimage and hash for future BTC locking
    const htlcPreimage = generateRandomPreimage();
    const htlcHash = await generateHTLCHash(htlcPreimage);

    // Create stake record
    const stakeRecord: StakeRecord = {
      id: `stake-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userAddress,
      signature,
      gbplAmountRaw,
      stakePeriod,
      status: "active",
      createdAt: now.toISOString(),
      maturityDate: maturityDate.toISOString(),
      htlcPreimage,
      htlcHash,
      htlcStatus: "waiting", // Waiting for BTC to be locked
      btcAddress: generateMockBTCAddress(),
      btcAmount: calculateRequiredBTCAmount(gbplAmountRaw),
    };

    // Store the stake record
    stakeRecords.set(signature, stakeRecord);

    // Log the stake for debugging
    console.log("New stake recorded:", {
      id: stakeRecord.id,
      userAddress,
      gbplAmount: gbplAmountRaw,
      stakePeriod,
      htlcHash,
    });

    // Return success response
    return NextResponse.json({
      success: true,
      stakeRecord: {
        id: stakeRecord.id,
        status: stakeRecord.status,
        maturityDate: stakeRecord.maturityDate,
        htlcHash: stakeRecord.htlcHash,
        htlcStatus: stakeRecord.htlcStatus,
        btcAddress: stakeRecord.btcAddress,
        btcAmount: stakeRecord.btcAmount,
      },
      explorerUrl: `https://solscan.io/tx/${signature}?cluster=devnet`,
      htlcInfo: {
        message: "HTLC prepared for BTC locking",
        btcAddress: stakeRecord.btcAddress,
        btcAmount: stakeRecord.btcAmount,
        htlcHash: stakeRecord.htlcHash,
        instructions: [
          "Send BTC to the provided address",
          "Include the HTLC hash in the transaction",
          "BTC will be locked until GBPL stake matures or early redemption",
        ],
      },
    });
  } catch (error) {
    console.error("Error processing stake:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Generate a random preimage for HTLC
function generateRandomPreimage(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

// Generate HTLC hash from preimage
async function generateHTLCHash(preimage: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(preimage);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Generate mock BTC address for HTLC
function generateMockBTCAddress(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let result = "1"; // Legacy address format
  for (let i = 0; i < 25; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Calculate required BTC amount based on GBPL staked (mock calculation)
function calculateRequiredBTCAmount(gbplAmountRaw: string): string {
  // Mock calculation: 1 BTC per 1000 GBPL (simplified)
  const gbplAmount = parseFloat(gbplAmountRaw) / 1e6; // Convert from raw to actual amount
  const btcAmount = gbplAmount / 1000;
  return btcAmount.toFixed(8);
}

// GET endpoint to retrieve stake records (for debugging)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userAddress = searchParams.get("userAddress");

  if (userAddress) {
    const userStakes = Array.from(stakeRecords.values()).filter(
      (stake) => stake.userAddress === userAddress,
    );
    return NextResponse.json({ stakes: userStakes });
  }

  return NextResponse.json({
    stakes: Array.from(stakeRecords.values()),
    total: stakeRecords.size,
  });
}
