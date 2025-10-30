import {
  Button,
  Card,
  CardBody,
  Divider,
  Image,
  Spinner,
  addToast,
  Link,
} from "@heroui/react";
import { useSignMessage } from "@solana/react";
import { useState } from "react";

import { assembleRedeemMessage } from "../../../lib/message-signature";

import { signatureToBase64 } from "@/utils/signature";
import { useSolana } from "@/components/solana-provider";
import { WalletConnectButton } from "@/components/wallet/solana-connect-button";

// Redeem button component that handles the signer
function RedeemButton({
  stakeId,
  onRedeemSuccess,
  label = "Redeem",
}: {
  stakeId: string;
  onRedeemSuccess?: () => Promise<void> | void;
  label?: string;
}) {
  const { selectedAccount } = useSolana();
  const [isProcessing, setIsProcessing] = useState(false);

  // useSignMessage hook - only called when this component is rendered (connected state)
  const signMessageFn = useSignMessage(selectedAccount!);

  const handleRedeem = async () => {
    if (!selectedAccount) {
      addToast({
        title: "Wallet not connected",
        description: "Please connect your wallet to redeem",
        color: "warning",
      });

      return;
    }

    setIsProcessing(true);

    try {
      // Create message to sign
      const timestamp = Date.now();
      const message = assembleRedeemMessage(
        stakeId,
        selectedAccount.address,
        timestamp,
      );

      addToast({
        title: "Please sign the message",
        description: "Confirm the signature in your wallet",
        color: "primary",
      });

      // Encode message for signing
      const messageBytes = new TextEncoder().encode(message);

      // Sign message with wallet using useSignMessage hook
      let signature: string;

      try {
        const { signature: signatureBytes } = await signMessageFn({
          message: messageBytes,
        });

        // Convert signature to base64
        signature = signatureToBase64(signatureBytes);
      } catch (signError) {
        addToast({
          title: "Signature failed",
          description:
            signError instanceof Error
              ? signError.message
              : "Failed to sign message",
          color: "danger",
        });

        return;
      }

      addToast({
        title: "Processing redeem...",
        description: "Transferring GBPL from vault...",
        color: "primary",
      });

      const redeemResponse = await fetch("/api/redeem-stake", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stakeId,
          userAddress: selectedAccount.address,
          signature,
          message,
          timestamp,
        }),
      });

      const redeemData = await redeemResponse.json();

      if (!redeemResponse.ok) {
        throw new Error(redeemData.error || "Failed to redeem stake");
      }

      addToast({
        title: "Redeem successful!",
        description: "GBPL has been transferred to your wallet",
        color: "success",
        endContent: redeemData.explorerUrl ? (
          <Link
            isExternal
            showAnchorIcon
            href={redeemData.explorerUrl}
            target="_blank"
          >
            View on Solscan
          </Link>
        ) : undefined,
      });

      // Call success callback to refresh data if provided
      if (onRedeemSuccess) {
        await onRedeemSuccess();
      }
    } catch (err) {
      addToast({
        title: "Redeem failed",
        description:
          err instanceof Error ? err.message : "Unknown error occurred",
        color: "danger",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Button
      isLoading={isProcessing}
      size="md"
      variant="flat"
      onPress={handleRedeem}
    >
      {label}
    </Button>
  );
}

export type MyPosition = {
  id: string;
  type: "GBPL" | "BTC";
  amount: number; // GBPL or BTC
  status: "active" | "awaitingLock" | "matured";
  maturity: string; // ISO date
  bonusApr: number; // percent
};

interface MyPositionsListProps {
  positions: MyPosition[];
  isLoading?: boolean;
  error?: string | null;
  onRedeemSuccess?: () => Promise<void> | void;
}

export function MyPositionsList({
  positions,
  isLoading = false,
  error = null,
  onRedeemSuccess,
}: MyPositionsListProps) {
  const { selectedAccount } = useSolana();
  const gbplPositions = positions.filter((p) => p.type === "GBPL");
  const btcPositions = positions.filter((p) => p.type === "BTC");

  const renderGBPLSection = () => {
    if (isLoading) {
      return (
        <div className="flex justify-center py-8">
          <Spinner variant="dots" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-danger-100 dark:bg-danger-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-danger text-2xl">⚠</span>
          </div>
          <p className="text-danger text-base mb-2">Failed to load positions</p>
          <p className="text-default-500 text-sm">{error}</p>
        </div>
      );
    }

    if (gbplPositions.length === 0) {
      return (
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Image
              alt="GBPL"
              className="w-8 h-8"
              radius="full"
              src="/tokens/gbpl.svg"
            />
          </div>
          <p className="text-default-500 text-base">No GBPL stakes</p>
        </div>
      );
    }

    return (
      <div>
        {gbplPositions.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between p-4 even:bg-default-100/50"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-base">
                {p.amount.toLocaleString()} GBPL
              </p>
              <p className="text-sm text-default-500">
                Expected: +{p.bonusApr}% bonus APR
              </p>
              <p className="text-sm text-default-500">
                Matures: {new Date(p.maturity).toLocaleDateString()}
              </p>
            </div>
            {selectedAccount ? (
              <RedeemButton
                label="Redeem"
                stakeId={p.id}
                onRedeemSuccess={onRedeemSuccess}
              />
            ) : (
              <Button isDisabled size="md" variant="flat">
                Redeem
              </Button>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderBTCSection = () => {
    if (isLoading) {
      return (
        <div className="flex justify-center py-8">
          <Spinner variant="dots" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-danger-100 dark:bg-danger-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-danger text-2xl">⚠</span>
          </div>
          <p className="text-danger text-base mb-2">Failed to load positions</p>
          <p className="text-default-500 text-sm">{error}</p>
        </div>
      );
    }

    if (btcPositions.length === 0) {
      return (
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Image
              alt="BTC"
              className="w-8 h-8"
              radius="full"
              src="/tokens/btc.svg"
            />
          </div>
          <p className="text-default-500 text-base">No BTC locks</p>
        </div>
      );
    }

    return (
      <div>
        {btcPositions.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between p-4 even:bg-default-100/50"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-base">{p.amount} BTC</p>
              <p className="text-sm text-default-500">
                Expected: +{p.bonusApr}% bonus APR
              </p>
              <p className="text-sm text-default-500">
                Matures: {new Date(p.maturity).toLocaleDateString()}
              </p>
            </div>
            {selectedAccount ? (
              <RedeemButton
                label="Unlock"
                stakeId={p.id}
                onRedeemSuccess={onRedeemSuccess}
              />
            ) : (
              <Button isDisabled size="md" variant="flat">
                Unlock
              </Button>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardBody className="p-6 md:p-8">
        {/* GBPL section */}
        <div className="flex items-center justify-between mb-6">
          <h4 className="text-xl md:text-2xl font-bold flex items-center gap-3">
            <Image
              alt="GBPL"
              className="w-6 h-6 md:w-7 md:h-7"
              radius="full"
              src="/tokens/gbpl.svg"
            />
            My GBPL Stakes
          </h4>
          <WalletConnectButton fullWidth={false} />
        </div>
        {renderGBPLSection()}

        <Divider className="my-6 md:my-8" />

        {/* BTC section */}
        <div className="flex items-center justify-between mb-6">
          <h4 className="text-xl md:text-2xl font-bold flex items-center gap-3">
            <Image
              alt="BTC"
              className="w-6 h-6 md:w-7 md:h-7"
              radius="full"
              src="/tokens/btc.svg"
            />
            My BTC Locks
          </h4>
          <Button size="sm" variant="flat">
            Connect BTC Wallet
          </Button>
        </div>
        {renderBTCSection()}
      </CardBody>
    </Card>
  );
}
