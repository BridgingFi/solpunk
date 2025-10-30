import type { StakeRecord } from "../../../lib/stake-types";

import { forwardRef, useImperativeHandle } from "react";
import { Button, Card, CardBody, Image, Spinner } from "@heroui/react";
import { Refresh } from "iconoir-react";

import { TOKEN_CONFIG } from "../../../lib/config";

export type AwaitingStake = {
  id: string;
  owner: string;
  gbplAmount: number;
  createdAt: string;
  stakePeriod: string; // "3m" or "6m"
  aprBase: number; // percent
  aprBonus: number; // percent
};

interface AwaitingBTCListProps {
  onStakeGBPL: () => void;
  onLockBTC: (stake: AwaitingStake) => void;
  pendingStakes: StakeRecord[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
}

export interface AwaitingBTCListRef {
  refresh: () => Promise<void>;
}

export const AwaitingBTCList = forwardRef<
  AwaitingBTCListRef,
  AwaitingBTCListProps
>(
  (
    {
      onStakeGBPL: _onStakeGBPL,
      onLockBTC,
      pendingStakes,
      isLoading,
      error,
      onRefresh,
    },
    ref,
  ) => {
    // Convert API data to component format
    const awaiting: AwaitingStake[] = pendingStakes.map(
      (stake: StakeRecord) => {
        // Convert gbplAmountRaw (string) to number
        // GBPL has 9 decimals, so divide by 1e9
        const gbplAmount =
          parseFloat(stake.gbplAmountRaw) / 10 ** TOKEN_CONFIG.GBPL.DECIMALS;

        // Calculate APR based on stake period
        // Base APR: 5% for 3m, 6% for 6m
        // Bonus APR: 2% for 3m, 3% for 6m (when BTC is locked)
        const aprBase = stake.stakePeriod === "6m" ? 6 : 5;
        const aprBonus = stake.stakePeriod === "6m" ? 3 : 2;

        return {
          id: stake.id,
          owner: stake.userAddress,
          gbplAmount,
          createdAt: stake.createdAt,
          stakePeriod: stake.stakePeriod,
          aprBase,
          aprBonus,
        };
      },
    );

    // Expose refresh function via ref
    useImperativeHandle(ref, () => ({
      refresh: onRefresh,
    }));

    return (
      <Card>
        <CardBody className="p-6 md:p-8">
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-xl md:text-2xl font-bold">Awaiting BTC Lock</h4>
            <Button
              isDisabled={isLoading}
              isLoading={isLoading}
              size="sm"
              startContent={isLoading ? null : <Refresh />}
              variant="bordered"
              onPress={onRefresh}
            >
              Refresh
            </Button>
          </div>
          {isLoading ? (
            <Spinner variant="dots" />
          ) : error ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-danger-100 dark:bg-danger-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-danger text-2xl">⚠</span>
              </div>
              <p className="text-danger text-base mb-2">
                Failed to load stakes
              </p>
              <p className="text-default-500 text-sm">{error}</p>
            </div>
          ) : awaiting.length === 0 ? (
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
            <div>
              {awaiting.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4 even:bg-default-100/50"
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
                        {item.gbplAmount.toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 6,
                        })}{" "}
                        GBPL
                      </p>
                      <p className="text-sm text-default-500">
                        Lock period:{" "}
                        {item.stakePeriod === "6m" ? "6 months" : "3 months"}
                        <br />
                        Created: {new Date(item.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <Button size="md" onPress={() => onLockBTC(item)}>
                    Lock BTC
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    );
  },
);

AwaitingBTCList.displayName = "AwaitingBTCList";
