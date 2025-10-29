import { useMemo, useState } from "react";
import { Card, CardBody } from "@heroui/card";
import { Button } from "@heroui/button";
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { BitcoinWalletConnectors } from "@dynamic-labs/bitcoin";

import DefaultLayout from "@/layouts/default";
import { StakeGBPLModal } from "@/components/modals/stake-gbpl-modal";
import { LockBTCModal } from "@/components/modals/lock-btc-modal";
import {
  AwaitingBTCList,
  type AwaitingStake,
} from "@/components/staking/awaiting-btc-list";
import {
  MyPositionsList,
  type MyPosition,
} from "@/components/staking/my-positions-list";

function BTCPageContent() {
  // Mock state
  const [awaiting, setAwaiting] = useState<AwaitingStake[]>([
    {
      id: "G-1001",
      owner: "0xA1...B3",
      gbplAmount: 1200,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      aprBase: 8.5,
      aprBonus: 2,
    },
    {
      id: "G-1002",
      owner: "0xC9...D2",
      gbplAmount: 3500,
      createdAt: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
      aprBase: 8.5,
      aprBonus: 2,
    },
  ]);
  const [myPositions, setMyPositions] = useState<MyPosition[]>([
    {
      id: "P-5001",
      type: "GBPL",
      amount: 1000,
      status: "active",
      maturity: new Date(Date.now() + 90 * 86400000).toISOString(),
      bonusApr: 2,
    },
    {
      id: "P-7001",
      type: "BTC",
      amount: 0.12,
      status: "active",
      maturity: new Date(Date.now() + 180 * 86400000).toISOString(),
      bonusApr: 2,
    },
  ]);

  const totalGbplStaked = useMemo(
    () =>
      awaiting.reduce((sum, a) => sum + a.gbplAmount, 0) +
      myPositions
        .filter((p) => p.type === "GBPL")
        .reduce((s, p) => s + p.amount, 0),
    [awaiting, myPositions],
  );
  const totalBtcLocked = useMemo(
    () =>
      myPositions
        .filter((p) => p.type === "BTC")
        .reduce((s, p) => s + p.amount, 0),
    [myPositions],
  );

  // Stake modal state
  const [stakeOpen, setStakeOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [selectedStake, setSelectedStake] = useState<AwaitingStake | null>(
    null,
  );

  const handleCreateStake = (amount: number) => {
    const newItem: AwaitingStake = {
      id: `G-${Math.floor(Math.random() * 9000 + 1000)}`,
      owner: "me",
      gbplAmount: amount,
      createdAt: new Date().toISOString(),
      aprBase: 8.5,
      aprBonus: 2,
    };

    setAwaiting((prev) => [newItem, ...prev]);
  };

  const handleLockBtc = (id: string) => {
    const item = awaiting.find((a) => a.id === id);

    if (!item) return;

    setSelectedStake(item);
    setLockOpen(true);
  };

  const handleConfirmLock = (btcAmount: number, period: string) => {
    if (!selectedStake) return;

    const days = period === "6m" ? 180 : 90;

    setAwaiting((prev) => prev.filter((a) => a.id !== selectedStake.id));
    setMyPositions((prev) => [
      ...prev,
      {
        id: `P-${selectedStake.id}-G`,
        type: "GBPL",
        amount: selectedStake.gbplAmount,
        status: "active",
        maturity: new Date(Date.now() + days * 86400000).toISOString(),
        bonusApr: selectedStake.aprBonus,
      },
      {
        id: `P-${selectedStake.id}-B`,
        type: "BTC",
        amount: btcAmount,
        status: "active",
        maturity: new Date(Date.now() + days * 86400000).toISOString(),
        bonusApr: selectedStake.aprBonus,
      },
    ]);
    setSelectedStake(null);
  };

  const handleRedeem = (id: string) => {
    setMyPositions((prev) => prev.filter((p) => p.id !== id));
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
                  <div className="relative w-14 h-14 md:w-16 md:h-16 flex-shrink-0">
                    <img
                      alt="GBPL"
                      className="w-10 h-10 md:w-12 md:h-12"
                      src="/tokens/gbpl.svg"
                    />
                    <img
                      alt="BTC"
                      className="absolute left-7 top-3 md:left-9 md:top-4 w-10 h-10 md:w-12 md:h-12"
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
                        {totalGbplStaked.toLocaleString()} GBPL
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
              awaiting={awaiting}
              onLockBTC={handleLockBtc}
              onStakeGBPL={() => setStakeOpen(true)}
            />
            <MyPositionsList positions={myPositions} onRedeem={handleRedeem} />
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
        appName: "BridgingFi",
        appLogoUrl: "/logo.png",
      }}
      theme={"dark"}
    >
      <BTCPageContent />
    </DynamicContextProvider>
  );
}
