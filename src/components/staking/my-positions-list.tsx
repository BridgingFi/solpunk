import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Divider } from "@heroui/divider";
import { Image } from "@heroui/image";
import { WalletConnectButton } from "@/components/wallet/solana-connect-button";

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
  onRedeem: (id: string) => void;
}

export function MyPositionsList({ positions, onRedeem }: MyPositionsListProps) {
  const gbplPositions = positions.filter((p) => p.type === "GBPL");
  const btcPositions = positions.filter((p) => p.type === "BTC");

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
        {gbplPositions.length === 0 ? (
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
        ) : (
          <div className="space-y-4">
            {gbplPositions.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-default-200 dark:border-default-100/20 p-4"
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
                <Button size="md" variant="flat" onPress={() => onRedeem(p.id)}>
                  Redeem
                </Button>
              </div>
            ))}
          </div>
        )}

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
        {btcPositions.length === 0 ? (
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
        ) : (
          <div className="space-y-4">
            {btcPositions.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-default-200 dark:border-default-100/20 p-4"
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
                <Button size="md" variant="flat" onPress={() => onRedeem(p.id)}>
                  Unlock
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
