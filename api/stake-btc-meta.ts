import type { VercelRequest, VercelResponse } from "@vercel/node";

import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory } from "bip32";
import { Redis } from "@upstash/redis";
import { hex } from "@scure/base";

import {
  stakeBtcDepositTxMapKey,
  stakeBtcFinalTxKey,
  userStakesSetKey,
} from "../lib/redis-keys.js";

const bip32 = BIP32Factory(ecc);
const redis = Redis.fromEnv();

type GetQuery = {
  stakeId?: string;
  btcPubkey?: string;
};

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  try {
    switch (request.method) {
      case "GET":
        return getHandler(request, response);
      case "POST":
        return postHandler(request, response);
      default:
        response.status(405).json({ error: "Method not allowed" });

        return;
    }
  } catch (err) {
    if (err instanceof Error) {
      response.status(400).send(err.message);
    } else {
      response.status(500).send("unknown error");
    }

    return;
  }
}

async function getHandler(request: VercelRequest, response: VercelResponse) {
  try {
    if (!process.env.BITCOIN_KEY) {
      return response
        .status(500)
        .json({ error: "Server misconfigured: BITCOIN_KEY missing" });
    }

    const { stakeId, btcPubkey } = request.query as GetQuery;

    const hdKey = bip32.fromSeed(hex.decode(process.env.BITCOIN_KEY as string));
    const rootPubkeyHex = Buffer.from(hdKey.publicKey).toString("hex");

    let txid: string | undefined;
    let finalTxid: string | undefined;

    if (stakeId) {
      const mapKey = stakeBtcDepositTxMapKey(stakeId);
      if (btcPubkey) {
        const depByPk = await redis.hget<string>(mapKey, btcPubkey);
        txid = typeof depByPk === "string" ? depByPk : undefined;
      }
      if (txid) {
        const finalByDep = await redis.get<string>(stakeBtcFinalTxKey(txid));
        if (typeof finalByDep === "string") finalTxid = finalByDep;
      }
    }

    return response.status(200).json({
      success: true,
      pubkeyHex: rootPubkeyHex,
      hasTx: Boolean(txid),
      txid,
      finalTxid,
    });
  } catch (error) {
    return response.status(500).json({
      error: "Failed to provide stake BTC meta",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

async function postHandler(request: VercelRequest, response: VercelResponse) {
  try {
    const { stakeId, btcPubkey, txid } = (request.body || {}) as {
      stakeId?: string;
      btcPubkey?: string;
      txid?: string;
    };

    if (!stakeId || !btcPubkey || !txid) {
      response.status(400).json({ error: "Missing required fields" });

      return;
    }

    // Basic sanity checks
    if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
      // mempool.space uses hex txid (64 hex chars)
      response.status(400).json({ error: "Invalid txid format" });

      return;
    }

    const stakeKey = userStakesSetKey(btcPubkey);

    await redis.sadd(stakeKey, txid);

    const mapKey = stakeBtcDepositTxMapKey(stakeId);

    await redis.hset(mapKey, { [btcPubkey]: txid });

    return response.status(200).json({ success: true });
  } catch (error) {
    return response.status(500).json({
      error: "Failed to save BTC deposit txid",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
