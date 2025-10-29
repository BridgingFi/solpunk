"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { Button } from "@heroui/button";
import { Modal, ModalContent, ModalBody, useDisclosure } from "@heroui/modal";
import { Listbox, ListboxItem } from "@heroui/listbox";
import { Image } from "@heroui/image";
import { Spinner } from "@heroui/spinner";
import {
  useConnect,
  useDisconnect,
  type UiWallet,
  type UiWalletAccount,
} from "@wallet-standard/react";
import { LogOut, Wallet } from "iconoir-react";
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

interface WalletDisconnectRef {
  disconnect: () => Promise<void>;
  isDisconnecting: boolean;
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

const WalletDisconnectIcon = forwardRef<
  WalletDisconnectRef,
  { wallet: UiWallet }
>(function WalletDisconnectIcon({ wallet }, ref) {
  const [isDisconnecting, disconnect] = useDisconnect(wallet);

  useImperativeHandle(
    ref,
    () => ({
      disconnect,
      isDisconnecting,
    }),
    [disconnect, isDisconnecting],
  );

  return isDisconnecting ? (
    <Spinner className="h-4 w-4" size="sm" />
  ) : (
    <LogOut className="h-4 w-4" />
  );
});

export function WalletConnectButton({
  fullWidth = true,
}: {
  fullWidth?: boolean;
}) {
  const {
    isConnected,
    selectedAccount,
    selectedWallet,
    setWalletAndAccount,
    wallets,
  } = useSolana();

  const { isOpen, onOpen, onClose } = useDisclosure();
  const walletRefs = useRef(
    new Map<string, React.RefObject<WalletConnectRef>>(),
  );
  const disconnectRef = useRef<React.RefObject<WalletDisconnectRef>>({
    current: null,
  });

  const handleButtonClick = () => {
    if (!isConnected) {
      onOpen();
    }
  };

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
        onClose();
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
    const impl = disconnectRef.current.current;

    if (!impl || impl.isDisconnecting || !selectedWallet || !isConnected)
      return;

    try {
      await impl.disconnect();
      setWalletAndAccount(null, null);
      onClose();
    } catch (err) {
      addToast({
        title: "Failed to disconnect wallet",
        description: err instanceof Error ? err.message : String(err),
        color: "warning",
      });
    }
  };

  return (
    <>
      {wallets.length === 0 ? (
        <Button
          isDisabled
          className={`${fullWidth ? "w-full py-4 text-lg font-semibold" : "px-3 py-2 text-sm"}`}
          color="primary"
          startContent={<Wallet className="mr-2 h-5 w-5" />}
          variant="solid"
        >
          No wallets detected
        </Button>
      ) : (
        <Button
          className={`${fullWidth ? "w-full py-4 text-lg font-semibold" : "px-3 py-2 text-sm"} ${
            isConnected && selectedWallet && selectedAccount
              ? "justify-between font-mono"
              : ""
          }`}
          color="primary"
          startContent={
            isConnected && selectedWallet && selectedAccount ? (
              <WalletIcon className="h-5 w-5" wallet={selectedWallet} />
            ) : (
              <Wallet className="mr-2 h-5 w-5" />
            )
          }
          variant={
            isConnected && selectedWallet && selectedAccount
              ? "bordered"
              : "solid"
          }
          onPress={handleButtonClick}
        >
          {isConnected && selectedWallet && selectedAccount
            ? truncateAddress(selectedAccount.address)
            : "Connect wallet"}
        </Button>
      )}

      <Modal isOpen={isOpen} placement="center" onClose={onClose}>
        <ModalContent>
          {() => (
            <ModalBody className="py-6">
              {!isConnected ? (
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold mb-2">
                    Available Wallets
                  </h3>
                  <Listbox aria-label="Available Wallets">
                    {wallets.map((wallet: UiWallet) => {
                      // Get or create ref for this wallet
                      let r = walletRefs.current.get(wallet.name);

                      if (!r) {
                        r = { current: null };
                        walletRefs.current.set(wallet.name, r);
                      }

                      return (
                        <ListboxItem
                          key={wallet.name}
                          startContent={
                            <WalletIconWithConnect ref={r} wallet={wallet} />
                          }
                          onClick={() => handleWalletConnect(wallet, r)}
                        >
                          {wallet.name}
                        </ListboxItem>
                      );
                    })}
                  </Listbox>
                </div>
              ) : selectedWallet && selectedAccount ? (
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold mb-2">
                    Wallet Connected
                  </h3>
                  <ListboxItem
                    className="text-danger"
                    startContent={
                      <WalletDisconnectIcon
                        ref={disconnectRef.current}
                        wallet={selectedWallet}
                      />
                    }
                    onClick={handleDisconnect}
                  >
                    Disconnect
                  </ListboxItem>
                </div>
              ) : null}
            </ModalBody>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
