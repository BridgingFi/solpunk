import * as btc from "@scure/btc-signer";

function toXOnlyU8(pubkey: Uint8Array): Uint8Array {
  if (pubkey.length === 33) return pubkey.slice(1);
  if (pubkey.length === 32) return pubkey;
  throw new Error("Invalid public key length");
}

export function scriptTLSC(
  coordinatorKey: Uint8Array,
  userKey: Uint8Array,
  blocks = 1,
): Uint8Array {
  if (!userKey.length) throw new Error("user key is empty");
  if (!coordinatorKey.length) throw new Error("coordinator key is empty");

  return btc.Script.encode([
    "DEPTH",
    "1SUB",
    "IF",
    toXOnlyU8(coordinatorKey),
    "CHECKSIGVERIFY",
    "ELSE",
    blocks,
    "CHECKSEQUENCEVERIFY",
    "DROP",
    "ENDIF",
    toXOnlyU8(userKey),
    "CHECKSIG",
  ]);
}

export function getBtcNetwork(network?: string) {
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

export function buildTaprootTimelockAddress(
  userPubkey: Uint8Array,
  coordinatorPubkey: Uint8Array,
  blocks = 1,
  network?: string,
) {
  const script = scriptTLSC(coordinatorPubkey, userPubkey, blocks);
  const net = getBtcNetwork(network);
  const p2tr = (btc as any).p2tr(undefined, { script }, net, true);

  const scriptAsm = btc.Script.decode(script)
    .map((x) => (typeof x === "number" ? x : x))
    .join(" ");

  return {
    address: p2tr.address,
    script,
    scriptAsm,
  };
}

// Phase 2 initial deposit address builder (P2WSH):
// Two paths: IF (short timeout + single-sig refund by user), ELSE (2-of-2 multisig by user+coordinator)
export function buildInitialDepositAddressP2WSH(
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
    address: p2wsh.address,
    scriptHex: Buffer.from(witnessScript).toString("hex"),
  };
}
