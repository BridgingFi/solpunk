import type { VercelRequest, VercelResponse } from "@vercel/node";

import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory } from "bip32";
import * as btc from "@scure/btc-signer";
import { hex, base64 } from "@scure/base";

import {
  buildInitialDepositAddressP2TR,
  buildFinalLockAddressP2WSH,
  getBtcNetwork,
} from "../lib/bitcoin-lock.js";

const bip32 = BIP32Factory(ecc);

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  try {
    if (request.method !== "POST") {
      response.status(405).json({ error: "Method not allowed" });

      return;
    }

    const {
      stakeId,
      userPubkeyHex,
      htlcHash,
      depositTxId,
      csvBlocks,
      network,
    } = (request.body || {}) as {
      stakeId?: string;
      userPubkeyHex?: string;
      htlcHash?: string;
      depositTxId?: string;
      csvBlocks?: number;
      network?: string;
    };

    if (!stakeId || !userPubkeyHex || !htlcHash || !depositTxId) {
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
    const coordPubkey = hdKey.publicKey as Uint8Array;
    const netName = (
      network ||
      process.env.VITE_BTC_NETWORK ||
      "testnet4"
    ).toLowerCase();
    const btcNet = getBtcNetwork(netName);

    // Recreate initial deposit address in order to identify vout
    const dep = buildInitialDepositAddressP2TR(
      hex.decode(userPubkeyHex),
      coordPubkey,
      1,
      netName,
    );

    const base =
      netName === "signet"
        ? "https://mempool.space/signet"
        : netName === "testnet4"
          ? "https://mempool.space/testnet4"
          : "https://mempool.space/testnet";
    const txJson = await (await fetch(`${base}/api/tx/${depositTxId}`)).json();
    const vouts: any[] = txJson?.vout || [];
    const voutIndex = vouts.findIndex(
      (o: any) => o.scriptpubkey_address === dep.address,
    );

    if (voutIndex === -1) {
      response.status(400).json({ error: "Deposit output not found" });

      return;
    }

    const inputAmount = BigInt(vouts[voutIndex].value);

    const final = buildFinalLockAddressP2WSH(
      hex.decode(userPubkeyHex),
      htlcHash,
      csvBlocks || 0,
      netName,
    );

    // Build PSBT: user input (un-signed), coordinator fee inputs, outputs (final + change)
    const tx = new btc.Transaction({ allowUnknownInputs: true });

    tx.addInput({
      ...dep.p2tr,
      txid: depositTxId,
      index: voutIndex,
      witnessUtxo: { script: dep.p2tr.script, amount: inputAmount },
    });

    const outAmount = inputAmount + 1500n;

    tx.addOutputAddress(final.address, outAmount, btcNet);

    // Coordinator funding (P2WPKH) for fees
    const p2wpkh = btc.p2wpkh(coordPubkey, btcNet);
    const utxos = (await (
      await fetch(`${base}/api/address/${p2wpkh.address}/utxo`)
    ).json()) as Array<{
      txid: string;
      vout: number;
      value: number;
      status: { confirmed: boolean };
    }>;

    let need = 1500n + 300n; // fee buffer, final precise fee after sign

    for (const u of utxos) {
      tx.addInput({
        ...p2wpkh,
        txid: u.txid,
        index: u.vout,
        witnessUtxo: { script: p2wpkh.script, amount: BigInt(u.value) },
        witnessScript: p2wpkh.script,
      });
      need -= BigInt(u.value);
      if (need <= 0n) break;
    }

    if (need > 0n) {
      response
        .status(400)
        .json({ error: "Insufficient coordinator funds to assemble PSBT" });

      return;
    }

    const change = -need;

    if (change > 546n) {
      tx.addOutputAddress(p2wpkh.address, change, btcNet);
    }

    // // Coordinator signs its inputs (not the user input 0)
    // const signed = tx.sign(hdKey.privateKey!);

    // if (signed !== tx.inputsLength) {
    //   response.status(400).json({ error: "Failed to sign all inputs" });

    //   return;
    // }

    // Return PSBT (base64) for client to add user's signature on input 0
    const psbtBase64 = base64.encode(tx.toPSBT());

    response.status(200).json({ success: true, psbtBase64 });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    response.status(500).json({
      error: "Failed to assemble PSBT",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
