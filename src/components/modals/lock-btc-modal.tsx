"use client";

import { useState } from "react";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Input,
} from "@heroui/react";

import { DynamicBitcoinConnectButton } from "../wallet/dynamic-bitcoin-connect-button";

interface LockBTCModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onLock: (amount: number, period: string) => void;
  gbplAmount: number;
}

export function LockBTCModal({
  isOpen,
  onOpenChange,
  onLock,
  gbplAmount,
}: LockBTCModalProps) {
  const [btcAmount, setBtcAmount] = useState("");
  const [lockPeriod, setLockPeriod] = useState("3m");

  const handleLock = () => {
    const amount = Number(btcAmount);
    if (!amount || amount <= 0) return;

    onLock(amount, lockPeriod);
    setBtcAmount("");
    setLockPeriod("3m");
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
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
                    <strong>Suggested BTC:</strong>{" "}
                    {(gbplAmount / 20000).toFixed(4)} BTC
                  </p>
                </div>

                <Input
                  type="number"
                  label="BTC Amount to Lock"
                  placeholder="Enter BTC amount"
                  value={btcAmount}
                  onChange={(e) => setBtcAmount(e.target.value)}
                />

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={lockPeriod === "3m" ? "solid" : "flat"}
                    onPress={() => setLockPeriod("3m")}
                  >
                    3 months
                  </Button>
                  <Button
                    variant={lockPeriod === "6m" ? "solid" : "flat"}
                    onPress={() => setLockPeriod("6m")}
                  >
                    6 months
                  </Button>
                </div>

                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <p className="text-sm text-green-600 dark:text-green-400">
                    <strong>Expected Returns:</strong> +2% bonus APR for both
                    GBPL and BTC
                  </p>
                </div>

                <div className="border-t pt-4">
                  <p className="text-sm font-semibold mb-2">
                    Connect Bitcoin Wallet
                  </p>
                  <DynamicBitcoinConnectButton />
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                Cancel
              </Button>
              <Button color="warning" onPress={handleLock}>
                Lock BTC
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
