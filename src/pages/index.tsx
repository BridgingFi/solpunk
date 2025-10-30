import { useEffect, useState } from "react";
import {
  addToast,
  Card,
  CardBody,
  Divider,
  Button,
  Input,
  Image,
  useDisclosure,
} from "@heroui/react";
import {
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { Address } from "@solana/kit";

import DefaultLayout from "@/layouts/default";
import { WalletConnectButton } from "@/components/wallet/solana-connect-button";
import { RedeemModal } from "@/components/modals/redeem-modal";
import { PurchaseModal } from "@/components/modals/purchase-modal";
import { useSolana } from "@/components/solana-provider";

// GBPL Token Mint Address (should be set from env or config)
const GBPL_MINT_ADDRESS = import.meta.env.VITE_GBPL_MINT_ADDRESS || "";
const USDC_MINT_ADDRESS = import.meta.env.VITE_USDC_MINT_ADDRESS || "";

interface PriceData {
  price: number;
  apr: number;
  startDate: string;
  startPrice: number;
  daysElapsed: number;
}

export default function IndexPage() {
  const { isConnected, selectedAccount, rpc } = useSolana();
  const [gbplBalance, setGbplBalance] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [usdcAmount, setUsdcAmount] = useState<string>("");
  const [gbplAmount, setGbplAmount] = useState<string>("");

  const redeemModal = useDisclosure();
  const purchaseModal = useDisclosure();

  // Fetch price data from API
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const response = await fetch("/api/gbpl-price");
        const data = await response.json();

        setPriceData(data);
      } catch (err) {
        addToast({
          title: "Failed to fetch GBPL price",
          description: err instanceof Error ? err.message : String(err),
          color: "warning",
        });
      }
    };

    fetchPrice();
  }, []);

  // Calculate GBPL amount based on USDC input
  useEffect(() => {
    if (usdcAmount && priceData) {
      const usdc = parseFloat(usdcAmount);
      if (!isNaN(usdc) && usdc > 0) {
        const gbpl = usdc / priceData.price;
        setGbplAmount(gbpl.toFixed(4));
      } else {
        setGbplAmount("");
      }
    } else {
      setGbplAmount("");
    }
  }, [usdcAmount, priceData]);

  useEffect(() => {
    if (!isConnected || !selectedAccount) {
      setGbplBalance(null);
      setUsdcBalance(null);

      return;
    }

    // Generic function to fetch token balance
    const fetchTokenBalance = async (
      mintAddress: Address,
      tokenProgram: Address,
      setBalance: (value: string | null) => void,
      errorTitle: string,
    ) => {
      if (!mintAddress) {
        setBalance(null);

        return;
      }

      try {
        // Find associated token account
        const [associatedTokenAddress] = await findAssociatedTokenPda({
          owner: selectedAccount.address as any,
          mint: mintAddress,
          tokenProgram,
        });

        // Check if token account exists
        const tokenAccountInfo = await rpc
          .getAccountInfo(associatedTokenAddress, { encoding: "base64" })
          .send();

        if (!tokenAccountInfo.value) {
          setBalance("0");

          return;
        }

        // Get token balance
        const balanceResponse = await rpc
          .getTokenAccountBalance(associatedTokenAddress)
          .send();

        setBalance(balanceResponse.value.uiAmountString || "0");
      } catch (err) {
        addToast({
          title: errorTitle,
          description: err instanceof Error ? err.message : String(err),
          color: "warning",
        });
        setBalance("0");
      }
    };

    // Fetch GBPL balance
    const fetchGbplBalance = () =>
      fetchTokenBalance(
        GBPL_MINT_ADDRESS,
        TOKEN_2022_PROGRAM_ADDRESS,
        setGbplBalance,
        "Failed to fetch GBPL balance",
      );

    // Fetch USDC balance
    const fetchUsdcBalance = () =>
      fetchTokenBalance(
        USDC_MINT_ADDRESS,
        TOKEN_PROGRAM_ADDRESS,
        setUsdcBalance,
        "Failed to fetch USDC balance",
      );

    fetchGbplBalance();
    fetchUsdcBalance();
  }, [isConnected, selectedAccount, rpc]);

  // Function to refresh balances
  const refreshBalances = async () => {
    if (!isConnected || !selectedAccount) return;

    const fetchGbplBalance = async () => {
      try {
        const [associatedTokenAddress] = await findAssociatedTokenPda({
          owner: selectedAccount.address as any,
          mint: GBPL_MINT_ADDRESS,
          tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });

        const tokenAccountInfo = await rpc
          .getAccountInfo(associatedTokenAddress, { encoding: "base64" })
          .send();

        if (!tokenAccountInfo.value) {
          setGbplBalance("0");
          return;
        }

        const balanceResponse = await rpc
          .getTokenAccountBalance(associatedTokenAddress)
          .send();

        setGbplBalance(balanceResponse.value.uiAmountString || "0");
      } catch (err) {
        console.error("Failed to fetch GBPL balance:", err);
      }
    };

    const fetchUsdcBalance = async () => {
      try {
        const [associatedTokenAddress] = await findAssociatedTokenPda({
          owner: selectedAccount.address as any,
          mint: USDC_MINT_ADDRESS,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        const tokenAccountInfo = await rpc
          .getAccountInfo(associatedTokenAddress, { encoding: "base64" })
          .send();

        if (!tokenAccountInfo.value) {
          setUsdcBalance("0");
          return;
        }

        const balanceResponse = await rpc
          .getTokenAccountBalance(associatedTokenAddress)
          .send();

        setUsdcBalance(balanceResponse.value.uiAmountString || "0");
      } catch (err) {
        console.error("Failed to fetch USDC balance:", err);
      }
    };

    await Promise.all([fetchGbplBalance(), fetchUsdcBalance()]);
  };

  const handleBuyClick = () => {
    if (!isConnected || !selectedAccount) {
      addToast({
        title: "Wallet not connected",
        description: "Please connect your wallet first",
        color: "warning",
      });
      return;
    }

    if (!usdcAmount || parseFloat(usdcAmount) <= 0) {
      addToast({
        title: "Invalid amount",
        description: "Please enter a valid USDC amount",
        color: "warning",
      });
      return;
    }

    // Open the purchase modal
    purchaseModal.onOpen();
  };

  // Handle modal close - reset form
  const handlePurchaseClose = () => {
    purchaseModal.onClose();
    setUsdcAmount("");
    setGbplAmount("");
  };

  // Handle purchase success - refresh balances
  const handlePurchaseSuccess = async () => {
    purchaseModal.onClose();
    setUsdcAmount("");
    setGbplAmount("");
    // Refresh balances after successful purchase
    await refreshBalances();
  };

  // Handle redeem success - refresh balances
  const handleRedeemSuccess = async () => {
    redeemModal.onClose();
    // Refresh balances after successful redeem
    await refreshBalances();
  };

  return (
    <DefaultLayout>
      <section className="flex flex-col items-center gap-8 py-8 md:py-10">
        <div className="w-full max-w-2xl">
          {/* Price Display - Reference Design */}
          <Card className="mb-8">
            <CardBody className="p-4">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
                  <Image
                    src="/tokens/gbpl.svg"
                    alt="GBPL"
                    className="w-full h-full"
                  />
                </div>
                <div className="flex-1">
                  <h3 className="text-3xl font-bold mb-1">GBPL</h3>
                  <div
                    className="h-px my-2"
                    style={{ background: "#3e415267" }}
                  ></div>
                  <div className="text-sm text-default-600 font-medium mb-2">
                    Token rates
                  </div>
                  {priceData ? (
                    <div className="flex flex-col gap-1 text-sm">
                      <div className="flex items-baseline gap-1 text-foreground">
                        <span className="font-semibold">1GBPL</span>
                        <span className="text-default-500">≈</span>
                        <span className="font-semibold">
                          {priceData.price.toFixed(6)} USDC
                        </span>
                        <span className="text-default-500">
                          (${priceData.price.toFixed(4)})
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1 text-foreground">
                        <span className="font-semibold">1USDC</span>
                        <span className="text-default-500">≈</span>
                        <span className="font-semibold">
                          {(1 / priceData.price).toFixed(8)} GBPL
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1 text-sm">
                      <div className="flex items-baseline gap-1">
                        <span className="font-semibold animate-pulse">
                          Loading...
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Redeem Modal */}
          {isConnected && selectedAccount && (
            <RedeemModal
              isOpen={redeemModal.isOpen}
              onClose={redeemModal.onClose}
              onSuccess={handleRedeemSuccess}
              selectedAccount={selectedAccount}
              rpc={rpc}
              gbplBalance={gbplBalance}
              priceData={priceData}
            />
          )}

          {/* Trade Interface */}
          <Card>
            <CardBody className="p-6">
              <div className="flex flex-col gap-2">
                {/* Amount Input Display */}
                <div className="relative mb-2">
                  <Input
                    id="usdc-amount-input"
                    type="number"
                    value={isConnected && selectedAccount ? usdcAmount : "0"}
                    onChange={(e) => setUsdcAmount(e.target.value)}
                    placeholder="0"
                    isDisabled={!isConnected || !selectedAccount}
                    classNames={{
                      base: "max-w-full",
                      mainWrapper: "h-full",
                      input: "text-7xl font-semibold leading-none",
                      inputWrapper:
                        "h-full bg-transparent shadow-none border-none after:border-none",
                    }}
                    endContent={
                      <span className="text-3xl text-default-500">USDC</span>
                    }
                  />
                </div>

                <Divider className="mb-4" />

                {/* Available Balance */}
                <div className="text-sm text-default-500 mb-4">
                  {isConnected && selectedAccount ? usdcBalance || "0" : "0"}{" "}
                  USDC Available
                </div>

                {/* MAX Button */}
                <div className="mb-6">
                  {isConnected && selectedAccount ? (
                    <Button
                      size="sm"
                      variant="bordered"
                      onClick={() => setUsdcAmount(usdcBalance || "0")}
                      className="px-4 h-8 rounded-full"
                    >
                      MAX
                    </Button>
                  ) : (
                    <Button
                      className="px-4 h-8 rounded-full"
                      size="sm"
                      variant="bordered"
                    >
                      MAX
                    </Button>
                  )}
                </div>

                {/* Est.Receive */}
                <div className="flex justify-between items-center mt-6">
                  <span className="text-sm font-normal text-default-600">
                    Est.Receive
                  </span>
                  <span className="text-sm font-normal">
                    {isConnected && selectedAccount ? gbplAmount || "0" : "0"}{" "}
                    GBPL
                  </span>
                </div>

                {/* Action Button */}
                <div className="mt-6">
                  {!isConnected || !selectedAccount ? (
                    <WalletConnectButton />
                  ) : usdcAmount && parseFloat(usdcAmount) > 0 ? (
                    <Button
                      className="w-full py-4 text-lg font-semibold"
                      color="primary"
                      size="lg"
                      onClick={handleBuyClick}
                    >
                      Buy
                    </Button>
                  ) : (
                    <Button
                      className="w-full py-4 text-lg font-semibold"
                      color="primary"
                      size="lg"
                      onClick={() => {
                        const input =
                          document.getElementById("usdc-amount-input");
                        if (input) {
                          input.focus();
                          input.click();
                        }
                      }}
                    >
                      Enter an amount
                    </Button>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Balance Display */}
          <Card>
            <CardBody className="p-6">
              <div className="flex flex-col gap-3">
                <p className="text-lg font-semibold mb-2">Balance</p>
                {isConnected && selectedAccount && gbplBalance !== null ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-3xl font-bold">{gbplBalance} GBPL</p>
                    <p className="text-sm text-default-500">
                      Estimate earnings today+ $
                      {priceData && gbplBalance
                        ? (
                            parseFloat(gbplBalance) *
                            priceData.price *
                            (priceData.apr / 100 / 365)
                          ).toFixed(6)
                        : "0.00"}
                    </p>
                    <div className="mt-4">
                      <Button
                        color="primary"
                        variant="bordered"
                        onClick={redeemModal.onOpen}
                        className="w-full"
                      >
                        Redeem
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-3xl font-bold text-default-400">
                    0.00 GBPL
                  </p>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Purchase Modal */}
          {isConnected && selectedAccount && (
            <PurchaseModal
              isOpen={purchaseModal.isOpen}
              onClose={handlePurchaseClose}
              onSuccess={handlePurchaseSuccess}
              selectedAccount={selectedAccount}
              rpc={rpc}
              usdcAmount={usdcAmount}
              gbplAmount={gbplAmount}
              priceData={priceData}
            />
          )}
        </div>
      </section>
    </DefaultLayout>
  );
}
