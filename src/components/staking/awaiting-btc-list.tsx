import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Image } from "@heroui/image";

export type AwaitingStake = {
  id: string;
  owner: string;
  gbplAmount: number;
  createdAt: string;
  aprBase: number; // percent
  aprBonus: number; // percent
};

interface AwaitingBTCListProps {
  awaiting: AwaitingStake[];
  onStakeGBPL: () => void;
  onLockBTC: (id: string) => void;
}

export function AwaitingBTCList({
  awaiting,
  onStakeGBPL,
  onLockBTC,
}: AwaitingBTCListProps) {
  return (
    <Card>
      <CardBody className="p-6 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <h4 className="text-xl md:text-2xl font-bold">Awaiting BTC Lock</h4>
          <Button
            color="primary"
            size="sm"
            variant="flat"
            onPress={onStakeGBPL}
          >
            Stake GBPL
          </Button>
        </div>
        {awaiting.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Image
                alt="GBPL"
                className="w-8 h-8"
                radius="full"
                src="/tokens/gbpl.svg"
              />
            </div>
            <p className="text-default-500 text-base">
              No GBPL stakes awaiting BTC lock.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {awaiting.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg border border-default-200 dark:border-default-100/20 p-4"
              >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                    <Image
                      alt="GBPL"
                      className="w-6 h-6"
                      radius="full"
                      src="/tokens/gbpl.svg"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-base truncate">
                      {item.gbplAmount.toLocaleString()} GBPL
                    </p>
                    <p className="text-sm text-default-500">
                      Expected: +{item.aprBonus}% bonus APR •{" "}
                      {new Date(item.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Button
                  color="warning"
                  size="md"
                  onPress={() => onLockBTC(item.id)}
                >
                  Lock BTC
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
