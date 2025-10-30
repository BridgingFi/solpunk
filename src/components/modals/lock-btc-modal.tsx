"use client";

import { useEffect, useMemo, useState } from "react";
import { useDynamicContext, useIsLoggedIn } from "@dynamic-labs/sdk-react-core";
import { isBitcoinWallet } from "@dynamic-labs/bitcoin";
import {
  Accordion,
  AccordionItem,
  Button,
  Chip,
  Code,
  Link,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  addToast,
} from "@heroui/react";
import { hex } from "@scure/base";

import { DynamicBitcoinConnectButton } from "../wallet/dynamic-bitcoin-connect-button";
import {
  buildInitialDepositAddressP2WSH,
  buildTaprootTimelockAddress,
} from "../../../lib/bitcoin-lock";

interface LockBTCModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onLock: (amount: number) => void;
  gbplAmount: number;
  stakePeriod: string;
  stakeId: string;
}

export function LockBTCModal({
  isOpen,
  onOpenChange,
  onLock: _onLock,
  gbplAmount,
  stakePeriod,
  stakeId,
}: LockBTCModalProps) {
  const isLoggedIn = useIsLoggedIn();
  const { primaryWallet } = useDynamicContext();
  const [gbplPrice, setGbplPrice] = useState<number | null>(null);
  const [isPriceLoading, setIsPriceLoading] = useState(false);
  const [coordPubkeyHex, setCoordPubkeyHex] = useState<string | null>(null);
  const [userPubkeyHex, setUserPubkeyHex] = useState<string | null>(null);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [lockAddress, setLockAddress] = useState<string | null>(null);
  const [lockScriptAsm, setLockScriptAsm] = useState<string | null>(null);
  const [isLockBuildLoading, setIsLockBuildLoading] = useState(false);
  const [isSendingDeposit, setIsSendingDeposit] = useState(false);
  const [depositTxId, setDepositTxId] = useState<string | null>(null);
  const [confirmations, setConfirmations] = useState<number>(0);
  const [expanded, setExpanded] = useState<string[]>(["step1"]);
  const BTC_NETWORK = (
    import.meta.env.VITE_BTC_NETWORK || "testnet4"
  ).toLowerCase();
  // BTC/USD price used for conversion; default to 110,000 if not provided
  const BTC_USD_PRICE = Number(import.meta.env.VITE_BTC_USD_PRICE || "110000");

  // Fetch current GBPL price (USDC) when modal opens
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const fetchPrice = async () => {
      setIsPriceLoading(true);
      try {
        const res = await fetch("/api/gbpl-price");
        const data = await res.json();

        if (data && typeof data.price === "number") {
          setGbplPrice(data.price);
        } else {
          setGbplPrice(null);
          addToast({
            title: "Failed to load GBPL price",
            description: "Missing price in response",
            color: "danger",
          });
        }
      } catch (err) {
        setGbplPrice(null);
        addToast({
          title: "Failed to load GBPL price",
          description: err instanceof Error ? err.message : "Network error",
          color: "danger",
        });
      } finally {
        setIsPriceLoading(false);
      }
    };

    fetchPrice();
  }, [isOpen]);

  // Required BTC in sats (BigInt) to avoid precision loss
  const requiredSats = useMemo(() => {
    if (gbplPrice === null) {
      return null as bigint | null;
    }

    const usdValue = gbplAmount * gbplPrice; // number
    const btcValue = usdValue / BTC_USD_PRICE; // number BTC
    let sats = BigInt(Math.floor(btcValue * 1e8));

    // Minimum 1500 sats
    if (sats < 1500n) sats = 1500n;

    return sats;
  }, [gbplAmount, gbplPrice, BTC_USD_PRICE]);

  const requiredBtcDisplay = useMemo(() => {
    if (requiredSats === null) return "—";

    return (Number(requiredSats) / 1e8).toFixed(8);
  }, [requiredSats]);

  // Lock action handled in later iteration (Phase 3 transaction builder)

  const handleSendDeposit = async () => {
    try {
      if (!primaryWallet || !isBitcoinWallet(primaryWallet)) {
        addToast({
          title: "Unsupported wallet",
          description: "Please switch to a Bitcoin wallet",
          color: "warning",
        });

        return;
      }

      if (!depositAddress) {
        addToast({
          title: "No deposit address",
          description: "Please generate the initial deposit address first",
          color: "warning",
        });

        return;
      }

      if (requiredSats === null || requiredSats <= 0n) {
        addToast({
          title: "Invalid amount",
          description: "Required BTC is not available",
          color: "warning",
        });

        return;
      }

      setIsSendingDeposit(true);
      const sats = requiredSats;
      const txid = await primaryWallet.sendBitcoin({
        amount: sats,
        recipientAddress: depositAddress,
      });

      if (txid && userPubkeyHex) {
        setDepositTxId(String(txid));
        // Persist to server KV
        try {
          await fetch("/api/stake-btc-meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stakeId,
              btcPubkey: userPubkeyHex,
              txid: String(txid),
            }),
          });
        } catch {}

        // Collapse step 1 and expand step 2
        setExpanded(["step2"]);
      }

      // Build mempool explorer link
      const mempoolBase =
        BTC_NETWORK === "signet"
          ? "https://mempool.space/signet/tx/"
          : BTC_NETWORK === "testnet4"
            ? "https://mempool.space/testnet4/tx/"
            : "https://mempool.space/testnet/tx/";
      const txUrl = txid ? `${mempoolBase}${txid}` : undefined;

      addToast({
        title: "Deposit sent",
        description: txid
          ? `TXID: ${String(txid).slice(0, 16)}...`
          : "Submitted",
        color: "success",
        endContent: txUrl ? (
          <Link isExternal showAnchorIcon href={txUrl}>
            View on mempool.space
          </Link>
        ) : undefined,
      });
    } catch (err) {
      addToast({
        title: "Send failed",
        description: err instanceof Error ? err.message : "Unknown error",
        color: "danger",
      });
    } finally {
      setIsSendingDeposit(false);
    }
  };

  // Derive approximate CSV blocks from period (10 min/block)
  const csvBlocks = stakePeriod === "6m" ? 6 * 30 * 24 * 6 : 3 * 30 * 24 * 6;

  // Phase 2: Build initial deposit prerequisites (coordinator pubkey + deposit address) and restore saved txid
  useEffect(() => {
    if (!isOpen) return;
    if (!isLoggedIn) return;

    // Resolve user BTC pubkey robustly from Dynamic
    const resolveUserPubkeyHex = async (): Promise<string | null> => {
      try {
        if (!primaryWallet || !isBitcoinWallet(primaryWallet)) return null;

        // 0) Prefer reading from additionalAddresses: payment -> ordinals -> first
        const addrs = primaryWallet.additionalAddresses;

        if (Array.isArray(addrs) && addrs.length > 0) {
          const payment = addrs.find((a) => a.type === "payment");
          const ordinals = addrs.find((a) => a.type === "ordinals");
          const chosen = payment || ordinals || addrs[0];
          const fromAdditional = chosen?.publicKey;

          if (typeof fromAdditional === "string") {
            setUserPubkeyHex(fromAdditional);

            return fromAdditional;
          }
        }

        return null;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[BTC] resolveUserPubkeyHex failed", e);

        return null;
      }
    };

    const fetchMeta = async (
      stakeIdParam: string | null,
      btcPubkeyHex: string | null,
    ): Promise<string | null> => {
      try {
        const query = new URLSearchParams();

        if (stakeIdParam) query.set("stakeId", stakeIdParam);
        if (btcPubkeyHex) query.set("btcPubkey", btcPubkeyHex);
        const res = await fetch(`/api/stake-btc-meta?${query.toString()}`);
        const data = await res.json();

        if (!res.ok || !data?.pubkeyHex) {
          throw new Error(data?.error || "Failed to fetch coordinator pubkey");
        }
        setCoordPubkeyHex(data.pubkeyHex);
        if (data?.txid) {
          setDepositTxId(data.txid as string);
          setExpanded(["step2"]);
        } else {
          setDepositTxId(null);
          setExpanded(["step1"]);
        }

        return data.pubkeyHex as string;
      } catch (err) {
        setCoordPubkeyHex(null);
        addToast({
          title: "Coordinator pubkey unavailable",
          description: err instanceof Error ? err.message : "Unknown error",
          color: "warning",
        });

        return null;
      }
    };

    const buildLockAddress = async (
      userPubkeyHex: string | null,
      coordinatorPubkeyHex?: string | null,
    ) => {
      if (!userPubkeyHex || !coordinatorPubkeyHex) {
        setDepositAddress(null);
        setLockAddress(null);
        setLockScriptAsm(null);

        return;
      }
      try {
        setIsLockBuildLoading(true);
        // Phase 2: P2WSH initial deposit on testnet
        const dep = buildInitialDepositAddressP2WSH(
          hex.decode(userPubkeyHex),
          hex.decode(coordinatorPubkeyHex),
          10,
          BTC_NETWORK,
        );

        setDepositAddress(dep.address);

        const { address, scriptAsm } = buildTaprootTimelockAddress(
          hex.decode(userPubkeyHex),
          hex.decode(coordinatorPubkeyHex),
          csvBlocks,
        );

        setLockAddress(address);
        setLockScriptAsm(scriptAsm);
      } catch (err) {
        setDepositAddress(null);
        setLockAddress(null);
        setLockScriptAsm(null);
        addToast({
          title: "Failed to build address",
          description: err instanceof Error ? err.message : "Unknown error",
          color: "warning",
        });
      } finally {
        setIsLockBuildLoading(false);
      }
    };

    (async () => {
      const userPubkeyHex = await resolveUserPubkeyHex();

      if (!userPubkeyHex) {
        addToast({
          title: "Bitcoin wallet public key unavailable",
          description:
            "Connect a supported Bitcoin wallet that exposes a public key.",
          color: "warning",
        });
      }
      const coord = await fetchMeta(stakeId, userPubkeyHex);

      await buildLockAddress(userPubkeyHex, coord);
    })();
  }, [isOpen, isLoggedIn, primaryWallet, csvBlocks, stakeId]);

  // Poll BTC confirmations when txid exists
  useEffect(() => {
    if (!depositTxId) {
      setConfirmations(0);

      return;
    }

    let timer: any;

    const fetchConfs = async () => {
      try {
        const base =
          BTC_NETWORK === "signet"
            ? "https://mempool.space/signet"
            : BTC_NETWORK === "testnet4"
              ? "https://mempool.space/testnet4"
              : "https://mempool.space/testnet";
        const [txRes, tipRes] = await Promise.all([
          fetch(`${base}/api/tx/${depositTxId}`),
          fetch(`${base}/api/blocks/tip/height`),
        ]);
        const tx = await txRes.json();
        const tipHeight = Number(await tipRes.text());
        if (
          tx?.status?.confirmed &&
          typeof tx?.status?.block_height === "number"
        ) {
          const confs = Math.max(0, tipHeight - tx.status.block_height + 1);
          setConfirmations(confs);
        } else {
          setConfirmations(0);
        }
      } catch {
        // ignore
      } finally {
        timer = setTimeout(fetchConfs, 15000);
      }
    };

    fetchConfs();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [depositTxId, BTC_NETWORK]);

  const renderDepositScript = () => {
    if (!userPubkeyHex || !coordPubkeyHex) {
      return "";
    }

    return [
      "# Short-timeout refund OR 2-of-2 multisig spend",
      "OP_IF",
      "  # Short timeout for refund",
      `  ${10}`,
      "  OP_CHECKSEQUENCEVERIFY",
      "  OP_DROP",
      "  # User single signature path",
      `  ${userPubkeyHex}`,
      "  OP_CHECKSIG",
      "OP_ELSE",
      "  # 2-of-2 multisig path (Coordinator + User)",
      "  2",
      `  ${coordPubkeyHex}`,
      `  ${userPubkeyHex}`,
      "  2",
      "  OP_CHECKMULTISIG",
      "OP_ENDIF",
    ].join("\n");
  };

  return (
    <Modal
      isDismissable={false}
      isOpen={isOpen}
      scrollBehavior="inside"
      size="lg"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader>
              Lock BTC Against {gbplAmount.toLocaleString()} GBPL For{" "}
              {stakePeriod === "6m" ? "6 months" : "3 months"}
            </ModalHeader>
            <ModalBody>
              <div className="p-4 bg-default-100/50 rounded-lg">
                {isPriceLoading ? (
                  <div className="flex items-center gap-2 text-xs text-default-600">
                    <Spinner size="sm" />
                    <span>Calculating required BTC...</span>
                  </div>
                ) : (
                  <>
                    <p className="text-sm mt-1">
                      <strong>Required BTC:</strong> {requiredBtcDisplay} BTC
                    </p>
                    <p className="text-xs text-default-600">
                      (GBPL Amount x GBPL Price) ÷ BTC/USD Price
                    </p>
                    <p className="text-xs text-default-600">
                      = ({gbplAmount.toLocaleString()} x $
                      {gbplPrice !== null ? Number(gbplPrice).toFixed(6) : "—"})
                      ÷ ${BTC_USD_PRICE.toLocaleString()} (minimum 1500 sats)
                    </p>
                  </>
                )}
              </div>

              <Accordion
                selectedKeys={new Set(expanded)}
                variant="splitted"
                onSelectionChange={(keys) =>
                  setExpanded(Array.from(keys as Set<string>) as string[])
                }
              >
                <AccordionItem
                  key="step1"
                  aria-label="Step 1"
                  subtitle={
                    depositTxId ? (
                      <span className="text-xs">
                        TXID:{" "}
                        <span className="font-mono">
                          {depositTxId.slice(0, 10)}...
                        </span>{" "}
                        <Chip
                          color={confirmations > 0 ? "success" : "warning"}
                          size="sm"
                          variant="flat"
                        >
                          {confirmations} conf
                        </Chip>
                      </span>
                    ) : undefined
                  }
                  title="Step 1: Send BTC to Initial Deposit Address"
                >
                  {isLockBuildLoading ? (
                    <div className="flex items-center gap-2 text-xs text-default-600">
                      <Spinner size="sm" />
                      <span>Generating initial deposit address...</span>
                    </div>
                  ) : depositAddress ? (
                    <div className="text-xs">
                      <p className="text-default-600">
                        Deposit Address (testnet P2WSH):
                      </p>
                      <p className="font-mono break-all">{depositAddress}</p>
                      {coordPubkeyHex && userPubkeyHex && (
                        <>
                          <p className="text-default-600 mt-2">
                            Witness Script:
                          </p>
                          <Code className="text-xs overflow-x-scroll w-full">
                            {<pre>{renderDepositScript()}</pre>}
                          </Code>
                          {!depositTxId && (
                            <Button
                              className="mt-3"
                              color="primary"
                              isDisabled={
                                !depositAddress || requiredSats === null
                              }
                              isLoading={isSendingDeposit}
                              size="sm"
                              onPress={handleSendDeposit}
                            >
                              Send BTC
                            </Button>
                          )}
                          {depositTxId && (
                            <div className="mt-3 text-xs">
                              <p className="text-default-600">
                                Deposit submitted. You can withdraw after
                                timeout if needed.
                              </p>
                              <Link
                                isExternal
                                showAnchorIcon
                                href={`${
                                  BTC_NETWORK === "signet"
                                    ? "https://mempool.space/signet/tx/"
                                    : BTC_NETWORK === "testnet4"
                                      ? "https://mempool.space/testnet4/tx/"
                                      : "https://mempool.space/testnet/tx/"
                                }${depositTxId}`}
                              >
                                View on mempool.space
                              </Link>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-default-500">
                      Address unavailable. Connect a Bitcoin wallet that exposes
                      a public key.
                    </p>
                  )}
                </AccordionItem>

                <AccordionItem
                  key="step2"
                  aria-label="Step 2"
                  title="Step 2: Final Lock Output"
                >
                  {lockScriptAsm ? (
                    <Code className="mt-2 w-full text-xs">{lockScriptAsm}</Code>
                  ) : (
                    <p className="text-xs text-default-500">
                      Script preview will appear after address generation.
                    </p>
                  )}
                  {lockAddress && (
                    <p className="text-xs text-default-600 mt-2">
                      Lock Address (Taproot):{" "}
                      <span className="font-mono break-all">{lockAddress}</span>
                    </p>
                  )}
                </AccordionItem>
              </Accordion>
              <DynamicBitcoinConnectButton />
            </ModalBody>
            {!isLoggedIn && (
              <ModalFooter>
                <DynamicBitcoinConnectButton />
              </ModalFooter>
            )}
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
