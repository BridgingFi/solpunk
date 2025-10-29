"use client";

import { useState } from "react";
import { Button } from "@heroui/button";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/modal";
import { Input } from "@heroui/input";

interface StakeGBPLModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onStake: (amount: number, period: string) => void;
}

export function StakeGBPLModal({
  isOpen,
  onOpenChange,
  onStake,
}: StakeGBPLModalProps) {
  const [stakeAmount, setStakeAmount] = useState("");
  const [stakePeriod, setStakePeriod] = useState("3m");

  const handleStake = () => {
    const amount = Number(stakeAmount);
    if (!amount || amount <= 0) return;

    onStake(amount, stakePeriod);
    setStakeAmount("");
    setStakePeriod("3m");
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              Stake GBPL
            </ModalHeader>
            <ModalBody>
              <Input
                type="number"
                label="Amount (GBPL)"
                placeholder="Enter amount"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={stakePeriod === "3m" ? "solid" : "flat"}
                  onPress={() => setStakePeriod("3m")}
                >
                  3 months
                </Button>
                <Button
                  variant={stakePeriod === "6m" ? "solid" : "flat"}
                  onPress={() => setStakePeriod("6m")}
                >
                  6 months
                </Button>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                Cancel
              </Button>
              <Button color="primary" onPress={handleStake}>
                Confirm Stake
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
