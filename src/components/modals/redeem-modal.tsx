"use client";

import { useState, useEffect } from "react";
import {
  Button,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  addToast,
  Link,
  Image,
} from "@heroui/react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import { type UiWalletAccount } from "@wallet-standard/react";
import { findAssociatedTokenPda } from "@solana-program/token-2022";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  getTransferCheckedInstruction,
  fetchMint as fetchGbplMint,
} from "@solana-program/token-2022";
import {
  address,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  pipe,
  signAndSendTransactionMessageWithSigners,
  assertIsTransactionMessageWithSingleSendingSigner,
} from "@solana/kit";
import { Wallet } from "iconoir-react";

import { signatureToBase58 } from "@/utils/signature";

interface RedeemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  selectedAccount: UiWalletAccount;
  rpc: any;
  gbplBalance: string | null;
  priceData: { price: number; apr: number } | null;
}

export function RedeemModal({
  isOpen,
  onClose,
  onSuccess,
  selectedAccount,
  rpc,
  gbplBalance,
  priceData,
}: RedeemModalProps) {
  const [redeemAmount, setRedeemAmount] = useState<string>("");
  const [usdcAmount, setUsdcAmount] = useState<string>("0.00");
  const [isProcessing, setIsProcessing] = useState(false);

  // Get wallet transaction sending signer
  const signer = useWalletAccountTransactionSendingSigner(
    selectedAccount,
    "solana:devnet",
  );

  // Get configuration from env
  const GBPL_MINT_ADDRESS = import.meta.env.VITE_GBPL_MINT_ADDRESS || "";
  const GBPL_VAULT_TOKEN_ACCOUNT =
    import.meta.env.VITE_GBPL_VAULT_TOKEN_ACCOUNT || "";

  // Calculate USDC amount for redemption
  useEffect(() => {
    if (redeemAmount && priceData) {
      const gbpl = parseFloat(redeemAmount);
      if (!isNaN(gbpl) && gbpl > 0) {
        const usdc = gbpl * priceData.price;
        setUsdcAmount(usdc.toFixed(6));
      } else {
        setUsdcAmount("0.00");
      }
    } else {
      setUsdcAmount("0.00");
    }
  }, [redeemAmount, priceData]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setRedeemAmount("");
      setUsdcAmount("0.00");
    }
  }, [isOpen]);

  const handleRedeem = async () => {
    if (!redeemAmount || parseFloat(redeemAmount) <= 0) {
      addToast({
        title: "Invalid amount",
        description: "Please enter a valid amount",
        color: "warning",
      });
      return;
    }

    setIsProcessing(true);

    try {
      // 1. Create GBPL transfer transaction
      addToast({
        title: "Preparing transaction...",
        description: "Please approve the transaction in your wallet",
        color: "primary",
      });

      const gbplAmountFloat = parseFloat(redeemAmount);
      const gbplMintAddress = address(GBPL_MINT_ADDRESS);
      const vaultAddress = address(GBPL_VAULT_TOKEN_ACCOUNT);

      // Fetch GBPL mint to get decimals
      const gbplMint = await fetchGbplMint(rpc, gbplMintAddress);
      const decimals = gbplMint.data.decimals;
      const gbplAmountRaw = BigInt(
        Math.floor(gbplAmountFloat * 10 ** decimals),
      );

      // Find user's GBPL associated token account
      const [userGbplTokenAccount] = await findAssociatedTokenPda({
        owner: signer.address,
        mint: gbplMintAddress,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });

      // Instruction: Transfer GBPL from user to vault
      const transferInstruction = getTransferCheckedInstruction({
        source: userGbplTokenAccount,
        destination: vaultAddress,
        authority: signer,
        mint: gbplMintAddress,
        amount: gbplAmountRaw,
        decimals,
      });

      // Get latest blockhash
      const { value: latestBlockhash } = await rpc
        .getLatestBlockhash({ commitment: "confirmed" })
        .send();

      // Create transaction message with signer
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(signer, tx),
        (tx) =>
          setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
      );

      // Assert that the transaction has a single sending signer
      assertIsTransactionMessageWithSingleSendingSigner(transactionMessage);

      // Sign and send the transaction using the wallet signer
      const signature =
        await signAndSendTransactionMessageWithSigners(transactionMessage);

      // Convert signature to base58 for API and explorer link
      const gbplTxSignature = signatureToBase58(signature);

      addToast({
        title: "GBPL transferred successfully",
        description: "Waiting for USDC redemption...",
        color: "primary",
        endContent: (
          <Link
            href={`https://solscan.io/tx/${gbplTxSignature}?cluster=devnet`}
            target="_blank"
            isExternal
            showAnchorIcon
          >
            View on Solscan
          </Link>
        ),
      });

      // 2. Call API to redeem USDC
      const redeemResponse = await fetch("/api/redeem-gbpl", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userAddress: selectedAccount.address,
          signature: gbplTxSignature,
          gbplAmountRaw: gbplAmountRaw.toString(),
        }),
      });

      const redeemData = await redeemResponse.json();

      if (!redeemResponse.ok) {
        throw new Error(redeemData.error || "Failed to redeem USDC");
      }

      if (redeemData.alreadyProcessed) {
        addToast({
          title: "Already processed",
          description: "This transaction has already been processed",
          color: "warning",
        });
        if (onSuccess) {
          onSuccess();
        }
        onClose();
        return;
      }

      // 3. Show success
      addToast({
        title: "Redeem successful!",
        description: `You received ${redeemData.usdcAmount} USDC.`,
        color: "success",
        endContent: (
          <Link
            href={redeemData.explorerUrl}
            target="_blank"
            isExternal
            showAnchorIcon
          >
            View on Solscan
          </Link>
        ),
      });

      // Call onSuccess callback to refresh balances
      if (onSuccess) {
        onSuccess();
      }

      onClose();
    } catch (err) {
      addToast({
        title: "Redeem failed",
        description: err instanceof Error ? err.message : String(err),
        color: "danger",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      placement="center"
      size="lg"
      classNames={{
        backdrop:
          "bg-gradient-to-t from-zinc-900 to-zinc-900/10 backdrop-opacity-20",
      }}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1">Redeem</ModalHeader>
            <ModalBody className="pb-6">
              <div className="flex flex-col gap-4">
                {/* Redeem From Section */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full flex items-center justify-center overflow-hidden">
                      <Image
                        src="/tokens/gbpl.svg"
                        alt="GBPL"
                        className="w-full h-full"
                      />
                    </div>
                    <span className="font-semibold text-xl">GBPL</span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm text-default-500 flex items-center gap-1">
                      <Wallet />
                      {gbplBalance || "0"} MAX
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={redeemAmount}
                        onChange={(e) => setRedeemAmount(e.target.value)}
                        placeholder="0.00"
                        size="lg"
                        classNames={{
                          input: "text-right text-lg",
                          inputWrapper: "w-32",
                        }}
                      />
                    </div>
                  </div>
                  {priceData && (
                    <p className="text-xs text-default-500">
                      Price {priceData.price.toFixed(6)} USDC
                    </p>
                  )}
                </div>

                {/* Divider */}
                <div className="h-px bg-default-200"></div>

                {/* Redeem To Section */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center overflow-hidden">
                      <Image
                        src="/tokens/usdc.svg"
                        alt="USDC"
                        className="w-full h-full"
                      />
                    </div>
                    <span className="font-semibold text-xl">USDC</span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-default-500">
                      Estimated receiving
                    </p>
                    <p className="text-lg font-semibold">{usdcAmount} USDC</p>
                  </div>
                </div>

                {/* Action Button */}
                <div className="mt-4">
                  {redeemAmount && parseFloat(redeemAmount) > 0 ? (
                    <Button
                      color="primary"
                      size="lg"
                      className="w-full"
                      onClick={handleRedeem}
                      disabled={isProcessing}
                      isLoading={isProcessing}
                    >
                      {isProcessing ? "Processing..." : "Redeem GBPL"}
                    </Button>
                  ) : (
                    <Button
                      color="primary"
                      size="lg"
                      className="w-full"
                      disabled
                    >
                      Enter an amount
                    </Button>
                  )}
                </div>

                {/* Fee Notice */}
                <p className="text-center text-xs text-default-500">
                  Redeem fee: 1% (Waived for first redemption only)
                </p>
              </div>
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
