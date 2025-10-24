"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@heroui/button";
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
} from "@heroui/dropdown";
import { Image } from "@heroui/image";
import { Spinner } from "@heroui/spinner";
import {
  useConnect,
  useDisconnect,
  type UiWallet,
  type UiWalletAccount,
} from "@wallet-standard/react";
import { NavArrowDown, LogOut, Wallet } from "iconoir-react";
import { addToast } from "@heroui/toast";

import { useSolana } from "@/components/solana-provider";

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function WalletIcon({
  wallet,
  className,
}: {
  wallet: UiWallet;
  className?: string;
}) {
  return wallet.icon ? (
    <Image
      alt={`${wallet.name} icon`}
      className={className}
      src={wallet.icon}
    />
  ) : (
    <div className={`rounded-full overflow-hidden ${className || ""}`}>
      <div className="w-full h-full flex items-center justify-center bg-default-200 text-default-600 text-xs font-medium">
        {wallet.name.slice(0, 2).toUpperCase()}
      </div>
    </div>
  );
}

interface WalletConnectRef {
  connect: () => Promise<readonly UiWalletAccount[] | undefined>;
  isConnecting: boolean;
}

const WalletIconWithConnect = forwardRef<
  WalletConnectRef,
  { wallet: UiWallet }
>(function WalletIconWithConnect({ wallet }, ref) {
  const [isConnecting, connect] = useConnect(wallet);

  useImperativeHandle(
    ref,
    () => ({
      connect,
      isConnecting,
    }),
    [connect, isConnecting],
  );

  return isConnecting ? (
    <Spinner className="h-6 w-6" size="sm" />
  ) : (
    <WalletIcon className="h-6 w-6" wallet={wallet} />
  );
});

export function WalletConnectButton() {
  const {
    isConnected,
    selectedAccount,
    selectedWallet,
    setWalletAndAccount,
    wallets,
  } = useSolana();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const walletRefs = useRef(
    new Map<string, React.RefObject<WalletConnectRef>>(),
  );

  // Disconnect can be handled directly in parent component
  // Only call useDisconnect when there's a selected wallet
  const dummyWallet = wallets[0] || ({} as UiWallet);
  const [isDisconnecting, disconnect] = useDisconnect(
    selectedWallet ?? dummyWallet,
  );

  const triggerButton =
    wallets.length === 0 ? (
      <>
        <Wallet className="mr-2 h-4 w-4" />
        <span>No wallets detected</span>
      </>
    ) : (
      <Button className="min-w-[140px] justify-between" variant="bordered">
        {isConnected && selectedWallet && selectedAccount ? (
          <>
            <div className="flex items-center gap-2">
              <WalletIcon className="h-4 w-4" wallet={selectedWallet} />
              <span className="font-mono text-sm">
                {truncateAddress(selectedAccount.address)}
              </span>
            </div>
            <NavArrowDown className="ml-2 h-4 w-4" />
          </>
        ) : (
          <>
            <Wallet className="mr-2 h-4 w-4" />
            <span>Connect Wallet</span>
            <NavArrowDown className="ml-2 h-4 w-4" />
          </>
        )}
      </Button>
    );

  const handleWalletConnect = async (
    wallet: UiWallet,
    ref: React.RefObject<WalletConnectRef>,
  ) => {
    const impl = ref.current;

    if (!impl || impl.isConnecting) return;

    try {
      const accounts = await impl.connect();

      if (accounts && accounts.length > 0) {
        const account = accounts[0];

        setWalletAndAccount(wallet, account);
        setDropdownOpen(false);
      }
    } catch (err) {
      addToast({
        title: `Failed to connect ${wallet.name}`,
        description: err instanceof Error ? err.message : String(err),
        color: "warning",
      });
    }
  };

  const handleDisconnect = async () => {
    if (isDisconnecting || !selectedWallet) return;

    try {
      await disconnect();
      setWalletAndAccount(null, null);
      setDropdownOpen(false);
    } catch (err) {
      addToast({
        title: "Failed to disconnect wallet",
        description: err instanceof Error ? err.message : String(err),
        color: "warning",
      });
    }
  };

  return (
    <Dropdown
      isOpen={dropdownOpen}
      placement="bottom-end"
      onOpenChange={setDropdownOpen}
    >
      <DropdownTrigger>{triggerButton}</DropdownTrigger>
      <DropdownMenu aria-label="Wallet menu">
        {!isConnected ? (
          <DropdownSection
            showDivider
            items={wallets}
            title="Available Wallets"
          >
            {(wallet) => {
              // Get or create ref for this wallet
              let r = walletRefs.current.get(wallet.name);

              if (!r) {
                r = { current: null };
                walletRefs.current.set(wallet.name, r);
              }

              return (
                <DropdownItem
                  key={wallet.name}
                  startContent={
                    <WalletIconWithConnect ref={r} wallet={wallet} />
                  }
                  onPress={() => handleWalletConnect(wallet, r)}
                >
                  {wallet.name}
                </DropdownItem>
              );
            }}
          </DropdownSection>
        ) : selectedWallet && selectedAccount ? (
          <>
            <DropdownItem
              key="disconnect"
              className="text-danger"
              isDisabled={isDisconnecting}
              startContent={
                isDisconnecting ? (
                  <Spinner className="h-4 w-4" size="sm" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )
              }
              onPress={handleDisconnect}
            >
              Disconnect
            </DropdownItem>
          </>
        ) : null}
      </DropdownMenu>
    </Dropdown>
  );
}
