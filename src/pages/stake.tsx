import type { StakeApiResponse, StakeRecord } from "../../lib/stake-types";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DynamicContextProvider,
  useDynamicContext,
} from "@dynamic-labs/sdk-react-core";
import {
  BitcoinWalletConnectors,
  isBitcoinWallet,
} from "@dynamic-labs/bitcoin";
import { Button, Card, CardBody } from "@heroui/react";

import { TOKEN_CONFIG } from "../../lib/config";

import { SolanaProvider, useSolana } from "@/components/solana-provider";
import { LockBTCModal } from "@/components/modals/lock-btc-modal";
import { StakeGBPLModal } from "@/components/modals/stake-gbpl-modal";
import {
  AwaitingBTCList,
  type AwaitingBTCListRef,
  type AwaitingStake,
} from "@/components/staking/awaiting-btc-list";
import { MyPositionsList } from "@/components/staking/my-positions-list";
import DefaultLayout from "@/layouts/default";

function BTCPageContent() {
  const { selectedAccount } = useSolana();
  const { primaryWallet } = useDynamicContext();
  const [userPubkeyHex, setUserPubkeyHex] = useState<string | null>(null);
  const awaitingBTCListRef = useRef<AwaitingBTCListRef>(null);
  const [selectedStake, setSelectedStake] = useState<AwaitingStake | null>(
    null,
  );
  const [userStakes, setUserStakes] = useState<StakeRecord[]>([]);
  const [btcStakes, setBtcStakes] = useState<string[]>([]);
  const [totalGbplStakedRaw, setTotalGbplStakedRaw] = useState<string | null>(
    null,
  );
  const [pendingStakes, setPendingStakes] = useState<StakeRecord[]>([]);
  const [isLoadingAwaiting, setIsLoadingAwaiting] = useState(true);
  const [awaitingError, setAwaitingError] = useState<string | null>(null);

  useEffect(() => {
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

    resolveUserPubkeyHex();
  }, [primaryWallet]);

  // Fetch awaiting stakes and total GBPL staked from API (combined call)
  // If wallet is connected, also fetch user's stakes in the same call
  const fetchAwaitingStakesAndTotal = async () => {
    try {
      setIsLoadingAwaiting(true);
      setAwaitingError(null);

      // Build URL with userAddress if wallet is connected
      let search = new URLSearchParams();

      if (selectedAccount?.address) {
        search.set("userAddress", selectedAccount.address);
      }
      if (userPubkeyHex) {
        search.set("btcPubkey", userPubkeyHex);
      }
      const response = await fetch(`/api/stake-gbpl?${search.toString()}`);
      const data = (await response.json()) as StakeApiResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to fetch pending stakes");
      }

      // Update pending stakes
      setPendingStakes(data.stakes);

      // Update total GBPL staked if provided
      if (data.totalGbplStaked) {
        setTotalGbplStakedRaw(data.totalGbplStaked);
      }

      // Update user's stakes if provided (when wallet is connected)
      if (data.userStakes) {
        setUserStakes(data.userStakes);
      } else {
        // Clear user stakes if wallet is disconnected
        setUserStakes([]);
      }

      if (data.btcStakes) {
        setBtcStakes(data.btcStakes);
      } else {
        setBtcStakes([]);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Error fetching awaiting stakes:", err);
      setAwaitingError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoadingAwaiting(false);
    }
  };

  // Fetch awaiting stakes and total on mount and when wallet changes
  useEffect(() => {
    fetchAwaitingStakesAndTotal();
  }, [selectedAccount?.address]);

  // Convert userStakes to MyPosition format for display
  const myPositionsFromApi = useMemo(() => {
    return [
      ...btcStakes.map((stake) => {
        const status: "active" | "awaitingLock" | "matured" = "active";

        return {
          id: stake,
          type: "BTC" as const,
          amount: 0,
          status,
          maturity: new Date(
            Date.now() + 1000 * 60 * 60 * 24 * 30,
          ).toISOString(),
          bonusApr: 0,
        };
      }),
      ...userStakes.map((stake) => {
        const gbplAmount =
          parseFloat(stake.gbplAmountRaw) / 10 ** TOKEN_CONFIG.GBPL.DECIMALS;
        const aprBonus = stake.stakePeriod === "6m" ? 3 : 2;
        const status: "active" | "awaitingLock" | "matured" =
          stake.htlcStatus === "waiting" ? "awaitingLock" : "active";

        // Compute maturity from createdAt + stakePeriod (client-side)
        const createdAt = new Date(stake.createdAt);
        const days = stake.stakePeriod === "6m" ? 180 : 90;
        const maturity = new Date(
          createdAt.getTime() + days * 24 * 60 * 60 * 1000,
        ).toISOString();

        return {
          id: stake.id,
          type: "GBPL" as const,
          amount: gbplAmount,
          status,
          maturity,
          bonusApr: aprBonus,
        };
      }),
    ];
  }, [userStakes]);

  // Calculate total GBPL staked from cached API value (all users, all statuses)
  const totalGbplStaked = useMemo(() => {
    if (totalGbplStakedRaw === null) {
      return null; // Still loading
    }

    // Convert raw value (with 9 decimals) to display value
    const totalRaw = BigInt(totalGbplStakedRaw || "0");
    const totalDisplay = Number(totalRaw) / 10 ** TOKEN_CONFIG.GBPL.DECIMALS;

    return totalDisplay;
  }, [totalGbplStakedRaw]);
  const totalBtcLocked = useMemo(() => {
    // BTC locks are not tracked in API yet, return 0 for now
    // TODO: Implement BTC lock tracking in API
    return 0;
  }, []);

  // Stake modal state
  const [stakeOpen, setStakeOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);

  const handleCreateStake = async (_amount: number, _period: string) => {
    // Refresh awaiting stakes, total GBPL staked, and user stakes (combined call)
    await fetchAwaitingStakesAndTotal();
  };

  const handleLockBtc = (stake: AwaitingStake) => {
    setSelectedStake(stake);
    setLockOpen(true);
  };

  const handleConfirmLock = async (_btcAmount: number) => {
    if (!selectedStake) return;

    // Refresh awaiting stakes and user stakes to remove the locked stake
    await fetchAwaitingStakesAndTotal();

    setSelectedStake(null);
  };

  return (
    <DefaultLayout>
      <section className="flex flex-col items-center gap-6 py-6 md:gap-8 md:py-10">
        <div className="w-full max-w-6xl px-4 md:px-6">
          {/* Summary */}
          <Card className="mb-6 md:mb-8">
            <CardBody className="p-6 md:p-8">
              <div className="flex flex-col gap-6 md:gap-8">
                {/* Header with icons and title */}
                <div className="flex items-center gap-4">
                  <div className="relative w-17 h-14 md:w-20 md:h-16 flex-shrink-0">
                    <img
                      alt="GBPL"
                      className="w-10 h-10 md:w-12 md:h-12"
                      src="/tokens/gbpl.svg"
                    />
                    <img
                      alt="BTC"
                      className="absolute left-7 top-3 md:left-8 md:top-4 w-10 h-10 md:w-12 md:h-12"
                      src="/tokens/btc.svg"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-2xl md:text-3xl font-bold">
                      BTC Dual Staking
                    </h3>
                    <p className="text-default-600 text-base md:text-lg">
                      Stake GBPL and lock BTC for +2% bonus APR each
                    </p>
                  </div>
                </div>

                {/* Stats and button */}
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
                  <div className="grid grid-cols-2 gap-6 md:gap-12">
                    <div className="text-center lg:text-left">
                      <p className="text-sm text-default-500 mb-2">
                        Total GBPL Staked
                      </p>
                      <p className="text-xl md:text-2xl font-bold">
                        {totalGbplStaked === null
                          ? "---"
                          : totalGbplStaked.toLocaleString()}{" "}
                        GBPL
                      </p>
                    </div>
                    <div className="text-center lg:text-left">
                      <p className="text-sm text-default-500 mb-2">
                        Total BTC Locked
                      </p>
                      <p className="text-xl md:text-2xl font-bold">
                        {totalBtcLocked.toLocaleString()} BTC
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-center lg:justify-end">
                    <Button
                      className="w-full lg:w-auto px-8 md:px-12"
                      color="primary"
                      size="lg"
                      variant="solid"
                      onPress={() => setStakeOpen(true)}
                    >
                      Stake GBPL
                    </Button>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Awaiting + Positions (responsive two-column) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 mb-8">
            <AwaitingBTCList
              ref={awaitingBTCListRef}
              error={awaitingError}
              isLoading={isLoadingAwaiting}
              pendingStakes={pendingStakes}
              onLockBTC={handleLockBtc}
              onRefresh={fetchAwaitingStakesAndTotal}
              onStakeGBPL={() => setStakeOpen(true)}
            />
            <MyPositionsList
              error={awaitingError}
              isLoading={isLoadingAwaiting}
              positions={myPositionsFromApi}
              onRedeemSuccess={fetchAwaitingStakesAndTotal}
            />
          </div>

          {/* Risk Management */}
          <Card className="mb-8">
            <CardBody className="p-6 md:p-8">
              <h4 className="text-xl md:text-2xl font-bold mb-6">
                Risk Management
              </h4>
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h5 className="font-semibold text-orange-600 text-lg">
                    Early GBPL Redemption
                  </h5>
                  <ul className="text-base text-default-600 space-y-3">
                    <li>• GBPL holder loses +2% bonus APR</li>
                    <li>• BTC holder can unlock BTC immediately</li>
                    <li>• No penalty for BTC holder</li>
                  </ul>
                </div>
                <div className="space-y-4">
                  <h5 className="font-semibold text-green-600 text-lg">
                    Normal Maturity
                  </h5>
                  <ul className="text-base text-default-600 space-y-3">
                    <li>• Both parties receive full +2% bonus APR</li>
                    <li>• BTC automatically unlocks at maturity</li>
                    <li>• GBPL can be redeemed normally</li>
                  </ul>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </section>

      {/* Modals */}
      <StakeGBPLModal
        isOpen={stakeOpen}
        onOpenChange={setStakeOpen}
        onStake={handleCreateStake}
      />

      {selectedStake && (
        <LockBTCModal
          gbplAmount={selectedStake.gbplAmount}
          isOpen={lockOpen}
          stakeId={selectedStake.id}
          htlcHash={selectedStake.htlcHash}
          stakePeriod={selectedStake.stakePeriod}
          onLock={handleConfirmLock}
          onOpenChange={setLockOpen}
        />
      )}
    </DefaultLayout>
  );
}

export default function StakePage() {
  const DYNAMIC_ENVIRONMENT_ID =
    import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID || "demo";

  return (
    <DynamicContextProvider
      settings={{
        environmentId: DYNAMIC_ENVIRONMENT_ID,
        initialAuthenticationMode: "connect-only",
        enableVisitTrackingOnConnectOnly: false,
        walletConnectors: [BitcoinWalletConnectors],
        walletsFilter: (wallets) =>
          wallets.filter(
            (wallet) =>
              // No testnet, exclude these wallets
              !["okxwalletbtc", "phantombtc", "magicedenbtc"].includes(
                wallet.key,
              ),
          ),
        appName: "BridgingFi",
        appLogoUrl: "/logo.png",
      }}
      theme={"dark"}
    >
      <SolanaProvider>
        <BTCPageContent />
      </SolanaProvider>
    </DynamicContextProvider>
  );
}
