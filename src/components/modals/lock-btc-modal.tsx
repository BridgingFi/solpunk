"use client";

import { useEffect, useMemo, useState } from "react";
import { useIsLoggedIn } from "@dynamic-labs/sdk-react-core";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  addToast,
} from "@heroui/react";

import { DynamicBitcoinConnectButton } from "../wallet/dynamic-bitcoin-connect-button";

interface LockBTCModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onLock: (amount: number) => void;
  gbplAmount: number;
  stakePeriod: string;
}

export function LockBTCModal({
  isOpen,
  onOpenChange,
  onLock,
  gbplAmount,
  stakePeriod,
}: LockBTCModalProps) {
  const isLoggedIn = useIsLoggedIn();
  const [gbplPrice, setGbplPrice] = useState<number | null>(null);
  const [isPriceLoading, setIsPriceLoading] = useState(false);
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

  // Required BTC so that BTC value equals GBPL value at current price
  const requiredBtc = useMemo(() => {
    if (gbplPrice === null) {
      return null;
    }

    return (gbplAmount * gbplPrice) / BTC_USD_PRICE;
  }, [gbplAmount, gbplPrice, BTC_USD_PRICE]);

  const handleLock = () => {
    if (requiredBtc === null) {
      addToast({
        title: "Price unavailable",
        description: "Unable to lock BTC without GBPL price",
        color: "danger",
      });

      return;
    }

    const amount = requiredBtc;

    if (!amount || amount <= 0) {
      return;
    }
    onLock(amount);
    onOpenChange(false);
  };

  return (
    <Modal
      isDismissable={false}
      isOpen={isOpen}
      size="lg"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              Lock BTC Against {gbplAmount.toLocaleString()} GBPL
            </ModalHeader>
            <ModalBody>
              <div className="space-y-4">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <p className="text-sm text-blue-600 dark:text-blue-400">
                    <strong>Staked GBPL:</strong> {gbplAmount.toLocaleString()}{" "}
                    GBPL
                  </p>
                  <p className="text-sm text-blue-600 dark:text-blue-400">
                    <strong>Stake Period:</strong>{" "}
                    {stakePeriod === "6m" ? "6 months" : "3 months"}
                  </p>
                </div>

                <div className="p-4 bg-default-100/60 dark:bg-default-100/10 rounded-lg">
                  {isPriceLoading ? (
                    <div className="flex items-center gap-2 text-xs text-default-600">
                      <Spinner size="sm" />
                      <span>Calculating required BTC...</span>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-default-600">
                        BTC Price Used: ${BTC_USD_PRICE.toLocaleString()} per
                        BTC
                      </p>
                      <p className="text-xs text-default-600">
                        GBPL Price Used: $
                        {gbplPrice !== null
                          ? Number(gbplPrice).toFixed(6)
                          : "—"}{" "}
                        per GBPL
                      </p>
                      <p className="text-xs text-default-600">
                        Formula: Required BTC = (GBPL Amount × GBPL Price) ÷
                        BTC/USD Price
                      </p>
                      <p className="text-xs text-default-600">
                        = ({gbplAmount.toLocaleString()} × $
                        {gbplPrice !== null
                          ? Number(gbplPrice).toFixed(6)
                          : "—"}
                        ) ÷ ${BTC_USD_PRICE.toLocaleString()}
                      </p>
                      <p className="text-sm mt-1">
                        <strong>Required BTC:</strong>{" "}
                        {requiredBtc !== null ? requiredBtc.toFixed(8) : "—"}{" "}
                        BTC
                      </p>
                    </>
                  )}
                </div>

                {/* Footer handles connect/confirm */}
              </div>
            </ModalBody>
            <ModalFooter>
              {!isLoggedIn ? (
                <DynamicBitcoinConnectButton />
              ) : (
                <Button
                  onPress={handleLock}
                  isDisabled={isPriceLoading || requiredBtc === null}
                  isLoading={isPriceLoading}
                  className="w-full"
                  color="warning"
                >
                  Lock BTC
                </Button>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
