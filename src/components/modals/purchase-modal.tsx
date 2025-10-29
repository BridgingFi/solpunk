"use client";

import { useState } from "react";
import { Button } from "@heroui/button";
import { Modal, ModalContent, ModalHeader, ModalBody } from "@heroui/modal";
import { addToast } from "@heroui/toast";
import { Link } from "@heroui/link";

import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import { type UiWalletAccount } from "@wallet-standard/react";
import { findAssociatedTokenPda } from "@solana-program/token-2022";
import {
  TOKEN_PROGRAM_ADDRESS,
  getTransferCheckedInstruction,
  fetchMint as fetchUsdcMint,
} from "@solana-program/token";
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

import { signatureToBase58 } from "@/utils/signature";

interface PurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  selectedAccount: UiWalletAccount;
  rpc: any;
  usdcAmount: string;
  gbplAmount: string;
  priceData: { price: number; apr: number } | null;
}

export function PurchaseModal({
  isOpen,
  onClose,
  onSuccess,
  selectedAccount,
  rpc,
  usdcAmount,
  gbplAmount,
  priceData,
}: PurchaseModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  // Get wallet transaction sending signer - guaranteed to have selectedAccount
  const signer = useWalletAccountTransactionSendingSigner(
    selectedAccount,
    "solana:devnet",
  );

  // Get configuration from env
  const USDC_MINT_ADDRESS = import.meta.env.VITE_USDC_MINT_ADDRESS || "";
  const USDC_VAULT_TOKEN_ACCOUNT =
    import.meta.env.VITE_USDC_VAULT_TOKEN_ACCOUNT || "";

  const handlePurchase = async () => {
    if (!usdcAmount || parseFloat(usdcAmount) <= 0) {
      addToast({
        title: "Invalid amount",
        description: "Please enter a valid USDC amount",
        color: "warning",
      });
      return;
    }

    if (!USDC_VAULT_TOKEN_ACCOUNT) {
      addToast({
        title: "Configuration error",
        description: "USDC vault address not configured",
        color: "danger",
      });
      return;
    }

    setIsProcessing(true);

    try {
      // 1. Create USDC transfer transaction
      addToast({
        title: "Preparing transaction...",
        description: "Please approve the transaction in your wallet",
        color: "primary",
      });

      const usdcAmountFloat = parseFloat(usdcAmount);
      const usdcMintAddress = address(USDC_MINT_ADDRESS);
      const vaultAddress = address(USDC_VAULT_TOKEN_ACCOUNT);

      // Fetch USDC mint to get decimals
      const usdcMint = await fetchUsdcMint(rpc, usdcMintAddress);
      const decimals = usdcMint.data.decimals;
      const usdcAmountRaw = BigInt(
        Math.floor(usdcAmountFloat * 10 ** decimals),
      );

      // Find user's USDC associated token account
      const [userUsdcTokenAccount] = await findAssociatedTokenPda({
        owner: signer.address,
        mint: usdcMintAddress,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });

      const instructions: any[] = [];

      // Create transfer instruction
      const transferInstruction = getTransferCheckedInstruction({
        source: userUsdcTokenAccount,
        destination: vaultAddress,
        authority: signer,
        mint: usdcMintAddress,
        amount: usdcAmountRaw,
        decimals,
      });

      instructions.push(transferInstruction);

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
        (tx) => appendTransactionMessageInstructions(instructions, tx),
      );

      // Assert that the transaction has a single sending signer
      assertIsTransactionMessageWithSingleSendingSigner(transactionMessage);

      // Sign and send the transaction using the wallet signer
      const signature =
        await signAndSendTransactionMessageWithSigners(transactionMessage);

      // Convert signature to base58 for API and explorer link
      const usdcTxSignature = signatureToBase58(signature);

      addToast({
        title: "Transaction sent",
        description: "Waiting for confirmation...",
        color: "primary",
        endContent: (
          <Link
            href={`https://solscan.io/tx/${usdcTxSignature}?cluster=devnet`}
            target="_blank"
            isExternal
            showAnchorIcon
          >
            View on Solscan
          </Link>
        ),
      });

      // 2. Call API to mint GBPL
      const checkResponse = await fetch("/api/mint-gbpl", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userAddress: selectedAccount.address,
          signature: usdcTxSignature,
          usdcAmountRaw: usdcAmountRaw.toString(),
        }),
      });

      const checkData = await checkResponse.json();

      if (!checkResponse.ok) {
        throw new Error(checkData.error || "Failed to mint GBPL");
      }

      if (checkData.alreadyProcessed) {
        addToast({
          title: "Already processed",
          description: "This transaction has already been processed",
          color: "warning",
        });
        onClose();
        return;
      }

      // 3. Show success with GBPL mint signature
      addToast({
        title: "Purchase successful!",
        description: `You received ${checkData.gbplAmount} GBPL.`,
        color: "success",
        endContent: (
          <Link
            href={checkData.explorerUrl}
            target="_blank"
            isExternal
            showAnchorIcon
          >
            View on Solscan
          </Link>
        ),
      });

      // Call onSuccess callback if provided
      if (onSuccess) {
        onSuccess();
      } else {
        // Fallback to onClose if no onSuccess callback
        onClose();
      }
    } catch (err) {
      console.error(err);
      addToast({
        title: "Transaction failed",
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
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">Purchase</ModalHeader>
            <ModalBody className="pb-6">
              <div className="flex flex-col gap-4">
                {/* Purchase Confirmation */}
                <div>
                  <p className="text-sm text-default-500 mb-4">
                    You are about to purchase:
                  </p>
                  <div className="flex items-center justify-between p-4 bg-default-100 rounded-lg mb-4">
                    <div>
                      <p className="text-2xl font-bold">{usdcAmount} USDC</p>
                      <p className="text-sm text-default-500">You will pay</p>
                    </div>
                    <div className="text-3xl">→</div>
                    <div className="text-right">
                      <p className="text-2xl font-bold">{gbplAmount} GBPL</p>
                      <p className="text-sm text-default-500">
                        You will receive
                      </p>
                    </div>
                  </div>

                  {priceData && (
                    <div className="text-xs text-default-500 text-center">
                      Price: 1 GBPL = ${priceData.price.toFixed(6)} USDC
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <Button
                    variant="bordered"
                    className="flex-1"
                    onPress={onClose}
                    disabled={isProcessing}
                  >
                    Cancel
                  </Button>
                  <Button
                    color="primary"
                    className="flex-1"
                    onPress={handlePurchase}
                    disabled={isProcessing}
                    isLoading={isProcessing}
                  >
                    {isProcessing ? "Processing..." : "Confirm Purchase"}
                  </Button>
                </div>
              </div>
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
