import type { VercelRequest, VercelResponse } from "@vercel/node";

import { Redis } from "@upstash/redis";
import * as btc from "@scure/btc-signer";
import { hex, base64 } from "@scure/base";
import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory } from "bip32";

import {
  STAKE_PENDING_BTC_SET_KEY,
  stakeBtcFinalTxKey,
  stakeRecordKey,
} from "../lib/redis-keys.js";

const bip32 = BIP32Factory(ecc);

const redis = Redis.fromEnv();

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  try {
    if (request.method !== "POST") {
      response.status(405).json({ error: "Method not allowed" });

      return;
    }

    const { stakeId, depositTxId, psbt, network } = (request.body || {}) as {
      stakeId?: string;
      depositTxId?: string;
      psbt?: string;
      network?: string;
    };

    if (!stakeId || !depositTxId || !psbt) {
      response.status(400).json({ error: "Missing required fields" });

      return;
    }

    if (!process.env.BITCOIN_KEY) {
      response
        .status(500)
        .json({ error: "Server misconfigured: BITCOIN_KEY missing" });

      return;
    }

    const hdKey = bip32.fromSeed(hex.decode(process.env.BITCOIN_KEY as string));

    const net = (
      network ||
      process.env.VITE_BTC_NETWORK ||
      "testnet4"
    ).toLowerCase();
    const mempoolUrlBase =
      net === "signet"
        ? "https://mempool.space/signet"
        : net === "testnet4"
          ? "https://mempool.space/testnet4"
          : "https://mempool.space/testnet";

    // Load client-provided PSBT and finalize (server may add missing sigs)
    const tx = btc.Transaction.fromPSBT(base64.decode(psbt), {
      allowUnknownInputs: true,
    });

    // Coordinator signs its inputs (not the user input 0)
    const signed = tx.sign(hdKey.privateKey!);

    if (signed !== tx.inputsLength) {
      response.status(400).json({ error: "Failed to sign all inputs" });

      return;
    }

    if (!tx.isFinal) tx.finalize();

    const raw = hex.encode(tx.extract());
    const res = await fetch(`${mempoolUrlBase}/api/tx`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: raw,
    });

    if (!res.ok) {
      const text = await res.text();

      response.status(400).json({ error: `Broadcast failed: ${text}` });

      return;
    }

    const finalTxid = await res.text();

    // Save final txid by deposit txid
    await redis.set(stakeBtcFinalTxKey(depositTxId), finalTxid);
    await redis.srem(STAKE_PENDING_BTC_SET_KEY, stakeRecordKey(stakeId));

    response.status(200).json({ success: true, txid: finalTxid });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    response.status(500).json({
      error: "Failed to finalize lock",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
