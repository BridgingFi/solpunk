import { useEffect, useState } from "react";
import {
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";

import DefaultLayout from "@/layouts/default";
import { WalletConnectButton } from "@/components/solana-connect-button";
import { useSolana } from "@/components/solana-provider";
import { addToast } from "@heroui/toast";

// GBPL Token Mint Address (should be set from env or config)
const GBPL_MINT_ADDRESS = import.meta.env.VITE_GBPL_MINT_ADDRESS || "";

export default function IndexPage() {
  const { isConnected, selectedAccount, rpc } = useSolana();
  const [balance, setBalance] = useState<number | null>(null);
  const [gbplBalance, setGbplBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !selectedAccount) {
      setBalance(null);
      setGbplBalance(null);

      return;
    }

    // Fetch SOL balance using @solana/kit RPC
    const fetchBalance = async () => {
      try {
        const balanceResponse = await rpc
          .getBalance(selectedAccount.address as any)
          .send();

        setBalance(Number(balanceResponse.value) / 1e9); // Convert lamports to SOL
      } catch (err) {
        addToast({
          title: "Failed to fetch balance",
          description: err instanceof Error ? err.message : String(err),
          color: "warning",
        });
        setBalance(null);
      }
    };

    // Fetch GBPL balance
    const fetchGbplBalance = async () => {
      if (!GBPL_MINT_ADDRESS) {
        setGbplBalance(null);

        return;
      }

      try {
        const mintAddress = GBPL_MINT_ADDRESS as any;

        // Find associated token account
        const [associatedTokenAddress] = await findAssociatedTokenPda({
          owner: selectedAccount.address as any,
          tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
          mint: mintAddress,
        });

        // Get token balance
        const balanceResponse = await rpc
          .getTokenAccountBalance(associatedTokenAddress)
          .send();

        setGbplBalance(balanceResponse.value.uiAmountString || "0");
      } catch (err) {
        addToast({
          title: "Failed to fetch GBPL balance",
          description: err instanceof Error ? err.message : String(err),
          color: "warning",
        });
        setGbplBalance("0");
      }
    };

    fetchBalance();
    fetchGbplBalance();
  }, [isConnected, selectedAccount, rpc]);

  return (
    <DefaultLayout>
      <WalletConnectButton />

      <section className="flex flex-col justify-center gap-4 py-8 md:py-10">
        {isConnected && selectedAccount ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-default-500">Connected Wallet</p>
              <p className="font-mono text-xs">{selectedAccount.address}</p>
            </div>

            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-sm font-semibold">Balances</p>
              {balance !== null && (
                <p className="text-lg">
                  SOL:{" "}
                  <span className="font-semibold">{balance.toFixed(4)}</span>
                </p>
              )}
              {gbplBalance !== null && (
                <p className="text-lg">
                  GBPL: <span className="font-semibold">{gbplBalance}</span>
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-default-500">Please connect your wallet</p>
        )}
      </section>
    </DefaultLayout>
  );
}
