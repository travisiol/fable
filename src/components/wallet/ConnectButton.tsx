"use client";

import { shortAddress } from "@/lib/format";
import { openWalletDialog, useWallet } from "./store";

export function ConnectButton({ className = "btn btn-primary" }: { className?: string }) {
  const wallet = useWallet();
  return (
    <button type="button" className={`${className} wallet-connect`} onClick={openWalletDialog}>
      {wallet.address ? (
        <>
          <span className="dot" aria-hidden="true" />
          <span className="mono">{shortAddress(wallet.address)}</span>
        </>
      ) : (
        "Connect wallet"
      )}
    </button>
  );
}
