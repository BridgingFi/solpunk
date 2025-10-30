import * as btc from "@scure/btc-signer";
import { hex } from "@scure/base";

export function getBtcNetwork(network?: string): typeof btc.NETWORK {
  switch (network) {
    case "signet":
    case "testnet":
    case "testnet4":
      return btc.TEST_NETWORK;
    case "mainnet":
    case "bitcoin":
    default:
      return btc.NETWORK;
  }
}

export function toXOnlyU8(pubKey: Uint8Array): Uint8Array {
  return pubKey.length === 32 ? pubKey : pubKey.slice(1, 33);
}

export function formatInitialDepositWitnessScript(
  userPubkeyHex: string,
  coordinatorPubkeyHex: string,
  timeoutBlocks: number,
): string {
  return [
    "# Short-timeout refund OR 2-of-2 multisig spend (selector = DEPTH)",
    "OP_DEPTH",
    "OP_1SUB",
    "OP_IF",
    "  # Coordinator signature here",
    `  ${hex.encode(toXOnlyU8(hex.decode(coordinatorPubkeyHex)))}`,
    "  OP_CHECKSIGVERIFY",
    "OP_ELSE",
    `  # Short timeout for refund (${timeoutBlocks} blocks)`,
    `  ${timeoutBlocks}`,
    "  OP_CHECKSEQUENCEVERIFY",
    "  OP_DROP",
    "OP_ENDIF",
    "# User signature here",
    hex.encode(toXOnlyU8(hex.decode(userPubkeyHex))),
    "OP_CHECKSIG",
  ].join("\n");
}

// Phase 2 initial deposit address builder (P2TR):
// Two paths: IF (short timeout + single-sig refund by user), ELSE (2-of-2 multisig by user+coordinator)
export function buildInitialDepositAddressP2TR(
  userPubkey: Uint8Array,
  coordinatorPubkey: Uint8Array,
  timeoutBlocks = 10, // short timeout for refund
  network: string = "testnet",
) {
  if (!userPubkey.length) throw new Error("user key is empty");
  if (!coordinatorPubkey.length) throw new Error("coordinator key is empty");

  const witnessScript = btc.Script.encode([
    "DEPTH",
    "1SUB",
    "IF",
    toXOnlyU8(coordinatorPubkey),
    "CHECKSIGVERIFY",
    "ELSE",
    timeoutBlocks,
    "CHECKSEQUENCEVERIFY",
    "DROP",
    "ENDIF",
    toXOnlyU8(userPubkey),
    "CHECKSIG",
  ]);

  const net = getBtcNetwork(network);
  const p2tr = (btc as any).p2tr(
    undefined,
    { script: witnessScript },
    net,
    true,
  );

  return {
    p2tr,
    address: p2tr.address,
    scriptHex: Buffer.from(witnessScript).toString("hex"),
  };
}

export function formatFinalLockWitnessScript(
  userPubkeyHex: string,
  sha256HashHex: string,
  csvBlocks: number,
): string {
  return [
    "# HTLC preimage OR CSV timelock (user single-sig)",
    "OP_DEPTH",
    "OP_1SUB",
    "OP_IF",
    "  # HTLC preimage path",
    "  OP_SHA256",
    `  ${sha256HashHex}`,
    "  OP_EQUALVERIFY",
    "OP_ELSE",
    "  # CSV timelock path",
    `  ${csvBlocks}`,
    "  OP_CHECKSEQUENCEVERIFY",
    "  OP_DROP",
    "OP_ENDIF",
    "# User pubkey",
    `${userPubkeyHex}`,
    "OP_CHECKSIG",
  ].join("\n");
}

// Step 2 final lock output: user can spend with single signature if
// - Preimage is provided before expiry (HTLC style), OR
// - CSV expiry reached (timelock)
// Uses SHA256 for hash, consistent with server-side HTLC hash generation
export function buildFinalLockAddressP2WSH(
  userPubkey: Uint8Array,
  sha256HashHex: string,
  csvBlocks: number,
  network?: string,
) {
  if (!userPubkey.length) throw new Error("user key is empty");

  const witnessScript = btc.Script.encode([
    "DEPTH",
    "1SUB",
    "IF",
    "SHA256",
    hex.decode(sha256HashHex),
    "EQUALVERIFY",
    "ELSE",
    csvBlocks,
    "CHECKSEQUENCEVERIFY",
    "DROP",
    "ENDIF",
    userPubkey,
    "CHECKSIG",
  ]);

  const net = getBtcNetwork(network);
  const p2wsh = btc.p2wsh({ script: witnessScript, type: "wsh" }, net);

  return {
    p2wsh,
    address: p2wsh.address as string,
    script: witnessScript,
  };
}

export function buildInitialDepositAddressP2WSHLegacy(
  userPubkey: Uint8Array,
  coordinatorPubkey: Uint8Array,
  timeoutBlocks = 10, // short timeout for refund
  network: string = "testnet",
) {
  if (!userPubkey.length) throw new Error("user key is empty");
  if (!coordinatorPubkey.length) throw new Error("coordinator key is empty");

  const witnessScript = btc.Script.encode([
    "IF",
    timeoutBlocks,
    "CHECKSEQUENCEVERIFY",
    "DROP",
    userPubkey,
    "CHECKSIG",
    "ELSE",
    2,
    coordinatorPubkey,
    userPubkey,
    2,
    "CHECKMULTISIG",
    "ENDIF",
  ]);

  const net = getBtcNetwork(network);
  const p2wsh = (btc as any).p2wsh({ script: witnessScript }, net);

  return {
    p2wsh,
    address: p2wsh.address,
    scriptHex: Buffer.from(witnessScript).toString("hex"),
  };
}
