"use client";

import {
  Button,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  addToast,
} from "@heroui/react";
import { Wallet, LogOut, NavArrowDown } from "iconoir-react";
import { useMemo, useState } from "react";
import { getAddressInfo } from "bitcoin-address-validation";
import { useDynamicContext, useIsLoggedIn } from "@dynamic-labs/sdk-react-core";
import { WalletIcon } from "@dynamic-labs/wallet-book";

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function DynamicBitcoinConnectButton({
  fullWidth = true,
}: {
  fullWidth?: boolean;
}) {
  const { primaryWallet, setShowAuthFlow, handleLogOut } = useDynamicContext();
  const isLoggedIn = useIsLoggedIn();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

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
    let isTestnet = false;

    if (primaryWallet.address) {
      try {
        const addressInfo = getAddressInfo(primaryWallet.address);

        isTestnet = addressInfo.network === "testnet";
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
      isTestnet,
      connectorName: primaryWallet.connector?.name || "Unknown",
    };
  }, [primaryWallet]);

  const handleButtonClick = () => {
    if (!isLoggedIn) {
      setShowAuthFlow(true);
    }
  };

  const handleDisconnect = async () => {
    try {
      await handleLogOut();
      setIsDropdownOpen(false);
    } catch (err) {
      addToast({
        title: "Failed to disconnect wallet",
        description: err instanceof Error ? err.message : String(err),
        color: "warning",
      });
    }
  };

  if (!isLoggedIn || !bitcoinWalletInfo) {
    return (
      <Button
        className={`${fullWidth ? "w-full py-4 text-lg font-semibold" : "px-3 py-2 text-sm"}`}
        color="primary"
        startContent={<Wallet />}
        variant="solid"
        onPress={handleButtonClick}
      >
        Connect Wallet
      </Button>
    );
  }

  return (
    <Dropdown isOpen={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
      <DropdownTrigger>
        <Button
          className={`${fullWidth ? "w-full py-4 text-lg font-semibold" : "px-3 py-2 text-sm"} justify-between font-mono`}
          color="primary"
          endContent={<NavArrowDown />}
          startContent={
            primaryWallet ? (
              <WalletIcon className="h-5 w-5" walletKey={primaryWallet.key} />
            ) : (
              <Wallet />
            )
          }
          variant="bordered"
        >
          {truncateAddress(bitcoinWalletInfo.address)}
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label="Bitcoin wallet actions">
        <DropdownItem
          key="disconnect"
          className="text-danger"
          startContent={<LogOut />}
          onPress={handleDisconnect}
        >
          Disconnect
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
  );
}
