"use client";

import { useState, useEffect, useRef } from "react";
import {
  cn,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Input,
  RadioGroup,
  Radio,
  addToast,
  Link,
  Image,
  Divider,
} from "@heroui/react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
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

import { WalletConnectButton } from "@/components/wallet/solana-connect-button";
import { useSolana } from "@/components/solana-provider";
import { signatureToBase58 } from "@/utils/signature";

// GBPL Token Mint Address
const GBPL_MINT_ADDRESS = import.meta.env.VITE_GBPL_MINT_ADDRESS || "";

interface StakeGBPLModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onStake: (amount: number, period: string) => void;
}

// Confirm button component that handles the signer
function StakeConfirmButton({
  stakeAmount,
  stakePeriod,
  onStake,
  onOpenChange,
}: {
  stakeAmount: string;
  stakePeriod: string;
  onStake: (amount: number, period: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { selectedAccount, rpc } = useSolana();
  const [isProcessing, setIsProcessing] = useState(false);

  // Get wallet transaction sending signer - only when this component is rendered (connected state)
  const signer = useWalletAccountTransactionSendingSigner(
    selectedAccount!,
    "solana:devnet",
  );

  // Get configuration from env
  const GBPL_VAULT_TOKEN_ACCOUNT =
    import.meta.env.VITE_GBPL_VAULT_TOKEN_ACCOUNT || "";

  const handleStake = async () => {
    if (!stakeAmount || parseFloat(stakeAmount) <= 0) {
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

      const gbplAmountFloat = parseFloat(stakeAmount);
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
        description: "Recording stake transaction...",
        color: "primary",
        endContent: (
          <Link
            isExternal
            showAnchorIcon
            href={`https://solscan.io/tx/${gbplTxSignature}?cluster=devnet`}
            target="_blank"
          >
            View on Solscan
          </Link>
        ),
      });

      // 2. Call API to record stake
      const stakeResponse = await fetch("/api/stake-gbpl", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userAddress: selectedAccount!.address,
          signature: gbplTxSignature,
          gbplAmountRaw: gbplAmountRaw.toString(),
          stakePeriod,
        }),
      });

      const stakeData = await stakeResponse.json();

      if (!stakeResponse.ok) {
        throw new Error(stakeData.error || "Failed to record stake");
      }

      // 3. Show success and call onStake callback
      addToast({
        title: "Stake successful!",
        description: `Staked ${stakeAmount} GBPL for ${stakePeriod}. HTLC prepared for BTC locking.`,
        color: "success",
        endContent: stakeData.htlcInfo ? (
          <div className="text-xs text-left">
            <p className="font-semibold">
              BTC Address: {stakeData.htlcInfo.btcAddress}
            </p>
            <p>Amount: {stakeData.htlcInfo.btcAmount} BTC</p>
            <p>HTLC Hash: {stakeData.htlcInfo.htlcHash.slice(0, 16)}...</p>
          </div>
        ) : undefined,
      });

      // Call onStake callback to update UI
      onStake(gbplAmountFloat, stakePeriod);
      onOpenChange(false);
    } catch (err) {
      addToast({
        title: "Stake failed",
        description: err instanceof Error ? err.message : String(err),
        color: "danger",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Button
      className="w-full"
      color="primary"
      disabled={isProcessing}
      isLoading={isProcessing}
      size="lg"
      onPress={handleStake}
    >
      {isProcessing ? "Processing..." : "Stake GBPL"}
    </Button>
  );
}

// Main modal component
export function StakeGBPLModal({
  isOpen,
  onOpenChange,
  onStake,
}: StakeGBPLModalProps) {
  const { isConnected, selectedAccount, rpc } = useSolana();
  const [stakeAmount, setStakeAmount] = useState("");
  const [stakePeriod, setStakePeriod] = useState("3m");
  const [gbplBalance, setGbplBalance] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const exceedsBalance =
    !!gbplBalance &&
    !!stakeAmount &&
    parseFloat(stakeAmount) > parseFloat(gbplBalance);

  // Fetch GBPL balance when connected
  useEffect(() => {
    if (!isConnected || !selectedAccount || !rpc) {
      setGbplBalance(null);

      return;
    }

    const fetchGbplBalance = async () => {
      if (!GBPL_MINT_ADDRESS) {
        setGbplBalance(null);

        return;
      }

      try {
        // Find associated token account
        const [associatedTokenAddress] = await findAssociatedTokenPda({
          owner: selectedAccount.address as any,
          mint: GBPL_MINT_ADDRESS,
          tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });

        // Check if token account exists
        const tokenAccountInfo = await rpc
          .getAccountInfo(associatedTokenAddress, { encoding: "base64" })
          .send();

        if (!tokenAccountInfo.value) {
          setGbplBalance("0");

          return;
        }

        // Get token balance
        const balanceResponse = await rpc
          .getTokenAccountBalance(associatedTokenAddress)
          .send();

        setGbplBalance(balanceResponse.value.uiAmountString || "0");
      } catch (err) {
        addToast({
          title: "Failed to fetch GBPL balance",
          description: err instanceof Error ? err.message : String(err),
          color: "warning",
        });
        setGbplBalance("0");
      }
    };

    fetchGbplBalance();
  }, [isConnected, selectedAccount, rpc]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStakeAmount("");
      setStakePeriod("3m");
    }
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="items-center gap-3">
              <Image
                alt="GBPL"
                classNames={{
                  wrapper:
                    "w-6 h-6 bg-gradient-to-b from-purple-500 to-purple-600 rounded-full",
                }}
                src="/tokens/gbpl.svg"
              />
              Stake GBPL
            </ModalHeader>
            <ModalBody>
              {/* Amount Input Section */}
              <Input
                ref={inputRef}
                description={
                  <span className="flex items-center gap-1">
                    <Wallet />
                    {isConnected ? gbplBalance || "0" : "---"} MAX
                  </span>
                }
                errorMessage={
                  exceedsBalance
                    ? "Amount exceeds available GBPL balance"
                    : undefined
                }
                isDisabled={!isConnected}
                isInvalid={exceedsBalance}
                placeholder="0.00"
                size="lg"
                type="number"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
              />

              <Divider />

              {/* Stake Period Selection */}
              <h4 className="text-default-500">Select Stake Period</h4>
              <RadioGroup
                isDisabled={!isConnected}
                orientation="horizontal"
                value={stakePeriod}
                onValueChange={setStakePeriod}
              >
                <Radio
                  classNames={{
                    base: cn(
                      "m-0 hover:bg-content2 flex-row-reverse cursor-pointer rounded-lg gap-4 p-4 border border-default-200 data-[selected=true]:border-primary",
                    ),
                  }}
                  value="3m"
                >
                  3 months
                </Radio>
                <Radio
                  classNames={{
                    base: cn(
                      "m-0 hover:bg-content2 flex-row-reverse cursor-pointer rounded-lg gap-4 p-4 border border-default-200 data-[selected=true]:border-primary",
                    ),
                  }}
                  value="6m"
                >
                  6 months
                </Radio>
              </RadioGroup>
            </ModalBody>
            <ModalFooter>
              {/* Action Button */}
              {!isConnected ? (
                <WalletConnectButton />
              ) : stakeAmount &&
                parseFloat(stakeAmount) > 0 &&
                !exceedsBalance ? (
                <StakeConfirmButton
                  stakeAmount={stakeAmount}
                  stakePeriod={stakePeriod}
                  onOpenChange={onOpenChange}
                  onStake={onStake}
                />
              ) : (
                <Button
                  isDisabled
                  className="w-full"
                  color={exceedsBalance ? "danger" : "primary"}
                  size="lg"
                  onPress={() => inputRef.current?.focus()}
                >
                  {exceedsBalance
                    ? "Amount exceeds balance"
                    : "Enter an amount"}
                </Button>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
