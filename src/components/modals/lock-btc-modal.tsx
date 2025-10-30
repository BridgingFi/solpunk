"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import * as btc from "@scure/btc-signer";
import { hex, base64 } from "@scure/base";

import { DynamicBitcoinConnectButton } from "../wallet/dynamic-bitcoin-connect-button";
import {
  buildInitialDepositAddressP2TR,
  buildInitialDepositAddressP2WSHLegacy,
  buildFinalLockAddressP2WSH,
  formatFinalLockWitnessScript,
  formatInitialDepositWitnessScript,
  getBtcNetwork,
} from "../../../lib/bitcoin-lock";

interface LockBTCModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onLock: (amount: number) => void;
  gbplAmount: number;
  stakePeriod: string;
  stakeId: string;
  htlcHash: string;
}

export function LockBTCModal({
  isOpen,
  onOpenChange,
  onLock: _onLock,
  gbplAmount,
  stakePeriod,
  stakeId,
  htlcHash,
}: LockBTCModalProps) {
  const isLoggedIn = useIsLoggedIn();
  const { primaryWallet } = useDynamicContext();
  const [gbplPrice, setGbplPrice] = useState<number | null>(null);
  const [isPriceLoading, setIsPriceLoading] = useState(false);
  const [coordPubkeyHex, setCoordPubkeyHex] = useState<string | null>(null);
  const [userPubkeyHex, setUserPubkeyHex] = useState<string | null>(null);
  const [userSigningAddress, setUserSigningAddress] = useState<string | null>(
    null,
  );
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [depositAddressLegacy, setDepositAddressLegacy] = useState<
    string | null
  >(null);
  const [isSendingDeposit, setIsSendingDeposit] = useState(false);
  const [depositTxId, setDepositTxId] = useState<string | null>(null);
  const [confirmations, setConfirmations] = useState<number>(0);
  const [expanded, setExpanded] = useState<string[]>(["step1"]);
  const [isBuildingFinalLock, setIsBuildingFinalLock] = useState(false);
  const [finalizeTxId, setFinalizeTxId] = useState<string | null>(null);
  const [finalLockAddress, setFinalLockAddress] = useState<string | null>(null);

  // Timer ref for confirmations polling so we can cancel across effects when stakeId changes
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Loading indicators for coordinator pubkey and restored txid
  const [isTxidLoading, setIsTxidLoading] = useState(false);

  const BTC_NETWORK = (
    import.meta.env.VITE_BTC_NETWORK || "testnet4"
  ).toLowerCase();
  // BTC/USD price used for conversion; default to 110,000 if not provided
  const BTC_USD_PRICE = Number(import.meta.env.VITE_BTC_USD_PRICE || "110000");

  // initial default timeout blocks is 10, here use 1 for testing purpose.
  // const initialTimeoutBlocks = 10;
  const initialTimeoutBlocks = 1;

  // Derive approximate CSV blocks from period (10 min/block), here use 2 for testing purpose.
  // const finalCsvBlocks = stakePeriod === "6m" ? 6 * 30 * 24 * 6 : 3 * 30 * 24 * 6;
  const finalCsvBlocks = 2;

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
          <Link isExternal showAnchorIcon href={txUrl} size="sm">
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

  const handleWithdraw = async () => {
    try {
      if (!primaryWallet || !isBitcoinWallet(primaryWallet)) {
        addToast({
          title: "Unsupported wallet",
          description: "Please switch to a Bitcoin wallet",
          color: "warning",
        });

        return;
      }

      if (!depositAddressLegacy) {
        addToast({
          title: "No deposit address",
          description: "Please generate the initial deposit address first",
          color: "warning",
        });

        return;
      }

      const csvBlocks = initialTimeoutBlocks;

      const p2tr = buildInitialDepositAddressP2TR(
        hex.decode(userPubkeyHex!),
        hex.decode(coordPubkeyHex!),
        csvBlocks,
        BTC_NETWORK,
      ).p2tr;

      const tx = new btc.Transaction();

      tx.addInput({
        ...p2tr,
        txid: depositTxId!,
        index: 0,
        sequence: csvBlocks,
        witnessUtxo: {
          script: p2tr.script,
          amount: requiredSats!,
        },
      });
      tx.addOutputAddress(
        primaryWallet.address,
        requiredSats! - 200n,
        getBtcNetwork(BTC_NETWORK),
      );

      const psbt = await primaryWallet.signPsbt({
        unsignedPsbtBase64: base64.encode(tx.toPSBT()),
        allowedSighash: [btc.SigHash.SINGLE_ANYONECANPAY],
        signature: [
          {
            address: userSigningAddress!,
            signingIndexes: [0],
            disableAddressValidation: true,
          },
        ],
      });

      if (!psbt?.signedPsbt) {
        throw new Error("Failed to get signed PSBT");
      }

      const tx2 = btc.Transaction.fromPSBT(base64.decode(psbt.signedPsbt), {
        allowUnknownInputs: true,
      });

      tx2.finalize();
      const res = await fetch("https://mempool.space/testnet4/api/tx", {
        method: "POST",
        body: hex.encode(tx2.extract()),
      });

      if (res.status != 200) {
        let text = await res.text();

        if (text.includes("non-BIP68-final")) text += ", timelock not passed";
        throw new Error(text);
      }

      const txid = await res.text();

      addToast({
        title: "Withdraw successful",
        description: `TXID: ${txid}`,
        endContent: (
          <Link
            isExternal
            showAnchorIcon
            href={`https://mempool.space/testnet4/tx/${txid}`}
            size="sm"
          >
            View on mempool.space
          </Link>
        ),
        color: "success",
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      addToast({
        title: "Withdraw failed",
        description: err instanceof Error ? err.message : "Unknown error",
        color: "danger",
      });
    }
  };

  // Phase 2: Build initial deposit prerequisites (coordinator pubkey + deposit address) and restore saved txid
  useEffect(() => {
    if (!isOpen || !isLoggedIn) {
      setCoordPubkeyHex(null);
      setUserPubkeyHex(null);
      setDepositAddress(null);
      setDepositAddressLegacy(null);
      setFinalLockAddress(null);
      setFinalizeTxId(null);
      setDepositTxId(null);
      setConfirmations(0);

      return;
    }

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
            setUserSigningAddress(chosen?.address);
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
        setIsTxidLoading(true);
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
        if (data?.finalTxid) {
          setFinalizeTxId(data.finalTxid as string);
        } else {
          setFinalizeTxId(null);
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
      } finally {
        setIsTxidLoading(false);
      }
    };

    const buildLockAddress = async (
      userPubkeyHex: string | null,
      coordinatorPubkeyHex?: string | null,
    ) => {
      if (!userPubkeyHex || !coordinatorPubkeyHex) {
        setDepositAddress(null);
        setFinalLockAddress(null);

        return;
      }
      try {
        // Phase 2: P2TR initial deposit on testnet
        const dep = buildInitialDepositAddressP2TR(
          hex.decode(userPubkeyHex),
          hex.decode(coordinatorPubkeyHex),
          initialTimeoutBlocks,
          BTC_NETWORK,
        );

        setDepositAddress(dep.address);
        setDepositAddressLegacy(
          buildInitialDepositAddressP2WSHLegacy(
            hex.decode(userPubkeyHex),
            hex.decode(coordinatorPubkeyHex),
            10,
            BTC_NETWORK,
          ).address,
        );
        // Build final P2WSH preview when hash available

        // Also prepare final P2WSH script (requires HTLC hash)
        // htlcHash prop may be undefined; only set when valid
        if (htlcHash && htlcHash.length === 64) {
          const final = buildFinalLockAddressP2WSH(
            hex.decode(userPubkeyHex),
            htlcHash,
            finalCsvBlocks,
            BTC_NETWORK,
          );

          setFinalLockAddress(final.address);
        } else {
          setFinalLockAddress(null);
        }
      } catch (err) {
        setDepositAddress(null);
        setFinalLockAddress(null);
        addToast({
          title: "Failed to build address",
          description: err instanceof Error ? err.message : "Unknown error",
          color: "warning",
        });
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
  }, [isOpen, isLoggedIn, primaryWallet, finalCsvBlocks, stakeId]);

  // Poll BTC confirmations when txid exists
  useEffect(() => {
    if (!depositTxId) {
      setConfirmations(0);

      return;
    }

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
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(fetchConfs, 180000);
      }
    };

    fetchConfs();

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [depositTxId, BTC_NETWORK]);

  // Reset cached state and cancel timers when switching to a different stake
  useEffect(() => {
    // Cancel any pending confirmations polling
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    // Reset modal-specific cached state
    setConfirmations(0);
    setExpanded(["step1"]);
    setFinalizeTxId(null);
    setDepositTxId(null);
    setFinalLockAddress(null);
    // Keep coordinator and user key info; they are wallet/global scoped and rarely change across stakes
    setIsSendingDeposit(false);
    setIsBuildingFinalLock(false);
    // Price can be retained; rebuild effects will fetch needed data based on new stakeId
  }, [stakeId]);

  const handleBuildAndSubmitPsbt = async () => {
    try {
      if (
        !depositTxId ||
        !userPubkeyHex ||
        !coordPubkeyHex ||
        !finalLockAddress ||
        !depositTxId ||
        !requiredSats ||
        !primaryWallet ||
        !isBitcoinWallet(primaryWallet)
      ) {
        addToast({
          title: "Missing data",
          description: "Deposit txid or pubkeys not ready",
          color: "warning",
        });

        return;
      }

      setIsBuildingFinalLock(true);

      const csvBlocks = finalCsvBlocks;

      // Ask server to assemble full PSBT and partially sign coordinator inputs
      const assembleRes = await fetch("/api/assemble-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stakeId,
          userPubkeyHex,
          htlcHash,
          depositTxId,
          csvBlocks,
          network: BTC_NETWORK,
        }),
      });
      const assembleData = await assembleRes.json();

      if (!assembleRes.ok || !assembleData?.psbtBase64) {
        throw new Error(assembleData?.error || "Failed to assemble PSBT");
      }

      // Let wallet sign input 0
      const psbt = await primaryWallet.signPsbt({
        unsignedPsbtBase64: assembleData.psbtBase64,
        allowedSighash: [1],
        signature: [
          {
            address: userSigningAddress!,
            signingIndexes: [0],
            disableAddressValidation: true,
          },
        ],
      });

      if (!psbt?.signedPsbt) {
        throw new Error("Failed to get signed PSBT");
      }

      const res = await fetch("/api/finalize-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stakeId,
          depositTxId,
          psbt: psbt.signedPsbt,
          network: BTC_NETWORK,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Finalize failed");
      }

      setFinalizeTxId(data.txid as string);
      addToast({
        title: "Final lock broadcasted",
        description: `${String(data.txid).slice(0, 12)}...`,
        color: "success",
      });
    } catch (err) {
      addToast({
        title: "PSBT build/submit failed",
        description: err instanceof Error ? err.message : "Unknown error",
        color: "danger",
      });
    } finally {
      setIsBuildingFinalLock(false);
    }
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
                    depositTxId && (
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
                    )
                  }
                  title="Step 1: Send BTC to Initial Deposit Address"
                >
                  <div className="text-xs">
                    <p className="text-default-600">
                      Deposit Address (testnet P2TR):
                    </p>
                    <p className="font-mono break-all">
                      {isLoggedIn
                        ? depositAddress || <Spinner size="sm" variant="dots" />
                        : "-"}
                    </p>
                    {/*<p className="text-default-600 mt-2">
                      Deposit Address (testnet P2WSH Legacy):
                    </p>
                    <p className="font-mono break-all">
                      {depositAddressLegacy}
                    </p> */}
                    <p className="text-default-600 mt-2">Witness Script:</p>
                    {isLoggedIn ? (
                      coordPubkeyHex && userPubkeyHex ? (
                        <Code className="text-xs overflow-x-scroll w-full">
                          <pre>
                            {formatInitialDepositWitnessScript(
                              userPubkeyHex,
                              coordPubkeyHex,
                              initialTimeoutBlocks,
                            )}
                          </pre>
                        </Code>
                      ) : (
                        <Spinner size="sm" variant="dots" />
                      )
                    ) : (
                      "-"
                    )}
                    <p className="text-default-600 mb-2">
                      You can withdraw after timeout if needed.
                    </p>
                    {!depositTxId ? (
                      <Button
                        color="primary"
                        isDisabled={!depositAddress || requiredSats === null}
                        isLoading={isSendingDeposit || isTxidLoading}
                        size="sm"
                        onPress={handleSendDeposit}
                      >
                        Send BTC
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" onPress={handleWithdraw}>
                          Withdraw
                        </Button>
                        <Link
                          isExternal
                          showAnchorIcon
                          className="text-xs ml-2"
                          size="sm"
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
                      </>
                    )}
                  </div>
                </AccordionItem>

                <AccordionItem
                  key="step2"
                  aria-label="Step 2"
                  title="Step 2: Final Lock Output"
                >
                  <p className="text-xs text-default-500">
                    Final Witness Script (P2WSH):
                  </p>
                  {coordPubkeyHex && userPubkeyHex ? (
                    <Code className="mt-2 w-full text-xs overflow-x-scroll">
                      <pre>
                        {formatFinalLockWitnessScript(
                          userPubkeyHex,
                          htlcHash,
                          finalCsvBlocks,
                        )}
                      </pre>
                    </Code>
                  ) : (
                    <Spinner size="sm" variant="dots" />
                  )}
                  <p className="text-xs text-default-600 mt-2">
                    Final Lock Address (P2WSH):
                  </p>
                  {finalLockAddress ? (
                    <p className="text-xs font-mono break-all">
                      {finalLockAddress}
                    </p>
                  ) : (
                    <Spinner size="sm" variant="dots" />
                  )}
                  <div className="mt-3 flex items-center gap-3">
                    {!finalizeTxId ? (
                      <Button
                        color="primary"
                        isDisabled={!depositTxId || Boolean(finalizeTxId)}
                        isLoading={isBuildingFinalLock}
                        size="sm"
                        onPress={handleBuildAndSubmitPsbt}
                      >
                        Lock with yield
                      </Button>
                    ) : (
                      <Link
                        isExternal
                        showAnchorIcon
                        href={`${
                          BTC_NETWORK === "signet"
                            ? "https://mempool.space/signet/tx/"
                            : BTC_NETWORK === "testnet4"
                              ? "https://mempool.space/testnet4/tx/"
                              : "https://mempool.space/testnet/tx/"
                        }${finalizeTxId}`}
                      >
                        Final TX: {finalizeTxId.slice(0, 12)}...
                      </Link>
                    )}
                  </div>
                </AccordionItem>
              </Accordion>
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
