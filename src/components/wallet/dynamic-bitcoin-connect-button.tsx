"use client";

import { Button, addToast } from "@heroui/react";
import { Wallet } from "iconoir-react";
import { useMemo } from "react";
import { getAddressInfo } from "bitcoin-address-validation";
import {
  DynamicWidget,
  useDynamicContext,
  useIsLoggedIn,
} from "@dynamic-labs/sdk-react-core";

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function getNetworkDisplayName(chain: string): string {
  switch (chain) {
    case "bitcoin":
    case "bitcoin-mainnet":
    case "BTC":
    case "btc":
    case "mainnet":
    case "livenet":
      return "Bitcoin Mainnet";
    case "bitcoin-testnet":
    case "testnet":
      return "Bitcoin Testnet";
    case "bitcoin-signet":
    case "signet":
      return "Bitcoin Signet";
    default:
      return chain;
  }
}

function getNetworkColor(chain: string): string {
  switch (chain) {
    case "bitcoin":
    case "bitcoin-mainnet":
    case "BTC":
    case "btc":
    case "mainnet":
    case "livenet":
      return "text-orange-500";
    case "bitcoin-testnet":
    case "testnet":
      return "text-blue-500";
    case "bitcoin-signet":
    case "signet":
      return "text-purple-500";
    default:
      return "text-gray-500";
  }
}

export function DynamicBitcoinConnectButton() {
  const { primaryWallet, setShowAuthFlow } = useDynamicContext();
  const isLoggedIn = useIsLoggedIn();

  // Get Bitcoin wallet info from primary wallet
  const bitcoinWalletInfo = useMemo(() => {
    if (!primaryWallet) {
      return null;
    }

    // Check if primary wallet is Bitcoin
    const isBitcoinWallet =
      primaryWallet.chain === "bitcoin" ||
      primaryWallet.chain === "bitcoin-mainnet" ||
      primaryWallet.chain === "bitcoin-testnet" ||
      primaryWallet.chain === "bitcoin-signet" ||
      primaryWallet.chain === "BTC" ||
      primaryWallet.chain === "btc" ||
      primaryWallet.chain === "signet";

    if (!isBitcoinWallet) {
      return null;
    }

    // Determine network using bitcoin-address-validation
    let detectedNetwork = primaryWallet.chain;
    let isTestnet = false;

    if (primaryWallet.address) {
      try {
        const addressInfo = getAddressInfo(primaryWallet.address);

        isTestnet = addressInfo.network === "testnet";

        detectedNetwork = isTestnet ? "testnet" : "mainnet";
      } catch {
        // Invalid address format
        return null;
      }
    }

    // Show toast if not testnet
    if (!isTestnet && primaryWallet.address) {
      addToast({
        title: "Warning: Mainnet Detected",
        description:
          "You're connected to Bitcoin Mainnet. Please switch to testnet for testing.",
        color: "warning",
      });
    }

    return {
      address: primaryWallet.address,
      chain: primaryWallet.chain,
      network: detectedNetwork,
      isTestnet,
      connectorName: primaryWallet.connector?.name || "Unknown",
    };
  }, [primaryWallet]);

  return (
    <div className="w-full">
      {!isLoggedIn ? (
        <Button
          className="w-full py-4 text-lg font-semibold"
          color="primary"
          startContent={<Wallet className="mr-2 h-5 w-5" />}
          variant="solid"
          onPress={() => setShowAuthFlow(true)}
        >
          Connect Bitcoin Wallet
        </Button>
      ) : (
        <div className="text-center">
          <div className="text-green-600 mb-4">
            <p className="font-semibold">Bitcoin Wallet Connected</p>
            {bitcoinWalletInfo && (
              <div className="mt-2">
                <p className="text-sm text-default-500">
                  Wallet: {bitcoinWalletInfo.connectorName}
                </p>
                <p
                  className={`text-sm font-semibold ${getNetworkColor(bitcoinWalletInfo.network)}`}
                >
                  Network: {getNetworkDisplayName(bitcoinWalletInfo.network)}
                </p>
                <p className="text-sm text-default-500 font-mono">
                  Address: {truncateAddress(bitcoinWalletInfo.address)}
                </p>
                {!bitcoinWalletInfo.isTestnet && (
                  <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                    <p className="text-xs text-yellow-600 dark:text-yellow-400">
                      ⚠️ Connected to Mainnet - Switch to testnet for testing
                    </p>
                  </div>
                )}
              </div>
            )}
            {!bitcoinWalletInfo && (
              <div className="mt-2 text-yellow-600">
                <p className="text-sm">No Bitcoin wallet info available</p>
              </div>
            )}
            <p className="text-sm text-default-500 mt-2">
              Ready for BTC lending when available
            </p>
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-xs text-blue-600 dark:text-blue-400">
                💡 To connect to Bitcoin Signet testnet, switch your wallet to
                Signet network before connecting
              </p>
            </div>
            <DynamicWidget />
          </div>
        </div>
      )}
    </div>
  );
}
