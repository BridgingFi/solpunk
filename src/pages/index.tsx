import { useEffect, useState } from "react";
import {
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { addToast } from "@heroui/toast";
import { Address } from "@solana/kit";

import DefaultLayout from "@/layouts/default";
import { WalletConnectButton } from "@/components/solana-connect-button";
import { useSolana } from "@/components/solana-provider";

// GBPL Token Mint Address (should be set from env or config)
const GBPL_MINT_ADDRESS = import.meta.env.VITE_GBPL_MINT_ADDRESS || "";
const USDC_MINT_ADDRESS = import.meta.env.VITE_USDC_MINT_ADDRESS || "";

export default function IndexPage() {
  const { isConnected, selectedAccount, rpc } = useSolana();
  const [balance, setBalance] = useState<number | null>(null);
  const [gbplBalance, setGbplBalance] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !selectedAccount) {
      setBalance(null);
      setGbplBalance(null);
      setUsdcBalance(null);

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

    // Generic function to fetch token balance
    const fetchTokenBalance = async (
      mintAddress: Address,
      tokenProgram: Address,
      setBalance: (value: string | null) => void,
      errorTitle: string,
    ) => {
      if (!mintAddress) {
        setBalance(null);

        return;
      }

      try {
        // Find associated token account
        const [associatedTokenAddress] = await findAssociatedTokenPda({
          owner: selectedAccount.address as any,
          mint: mintAddress,
          tokenProgram,
        });

        // Check if token account exists
        const tokenAccountInfo = await rpc
          .getAccountInfo(associatedTokenAddress, { encoding: "base64" })
          .send();

        if (!tokenAccountInfo.value) {
          setBalance("0");

          return;
        }

        // Get token balance
        const balanceResponse = await rpc
          .getTokenAccountBalance(associatedTokenAddress)
          .send();

        setBalance(balanceResponse.value.uiAmountString || "0");
      } catch (err) {
        addToast({
          title: errorTitle,
          description: err instanceof Error ? err.message : String(err),
          color: "warning",
        });
        setBalance("0");
      }
    };

    // Fetch GBPL balance
    const fetchGbplBalance = () =>
      fetchTokenBalance(
        GBPL_MINT_ADDRESS,
        TOKEN_2022_PROGRAM_ADDRESS,
        setGbplBalance,
        "Failed to fetch GBPL balance",
      );

    // Fetch USDC balance
    const fetchUsdcBalance = () =>
      fetchTokenBalance(
        USDC_MINT_ADDRESS,
        TOKEN_PROGRAM_ADDRESS,
        setUsdcBalance,
        "Failed to fetch USDC balance",
      );

    fetchBalance();
    fetchGbplBalance();
    fetchUsdcBalance();
  }, [isConnected, selectedAccount, rpc]);

  return (
    <DefaultLayout>
      <WalletConnectButton />

      <section className="flex flex-col justify-center gap-4 py-8 md:py-10">
        {isConnected && selectedAccount ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 text-xs">
              <p className="text-default-500">Connected Wallet</p>
              <p className="font-mono ">{selectedAccount.address}</p>
            </div>

            <div className="flex text-xs flex-col gap-2 border-t pt-4">
              <p className="text-lg font-semibold">Balances</p>
              {balance !== null && (
                <p>
                  SOL:{" "}
                  <span className="font-semibold">{balance.toFixed(4)}</span>
                </p>
              )}
              {usdcBalance !== null && (
                <p>
                  USDC: <span className="font-semibold">{usdcBalance}</span>
                </p>
              )}
              {gbplBalance !== null && (
                <p>
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
