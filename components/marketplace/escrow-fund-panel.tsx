"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type EIP1193Provider,
} from "viem";
import { base } from "viem/chains";
import {
  ESCROW_CONTRACT_ADDRESS,
  ESCROW_FUND_ABI,
  ESCROW_USDC_ADDRESS,
  ESCROW_V2_CONTRACT_ADDRESS,
  USDC_APPROVE_ABI,
  basescanTxUrl,
  usdcToUnits,
  uuidToBytes32,
} from "@/lib/escrow";
import { formatUsdc } from "@/lib/payments";
import { markTaskEscrowFundedAction } from "@/app/tasks/actions";
import {
  DEFAULT_LOCALE,
  createTranslator,
  type Locale,
} from "@/lib/i18n";
import type { DbRewardMode } from "@/lib/tasks";

type Phase =
  | "idle"
  | "connecting"
  | "approving"
  | "funding"
  | "recording"
  | "done"
  | "error";

function getProvider(): EIP1193Provider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  return eth ?? null;
}

export function EscrowFundPanel({
  taskId,
  rewardAmount,
  rewardMode = "fixed",
  winnerCount = 1,
  locale = DEFAULT_LOCALE,
}: {
  taskId: string;
  rewardAmount: number;
  rewardMode?: DbRewardMode;
  winnerCount?: number;
  locale?: Locale;
}) {
  const t = createTranslator(locale);
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string>("");
  const [txHash, setTxHash] = useState<string>("");

  const busy =
    phase === "connecting" ||
    phase === "approving" ||
    phase === "funding" ||
    phase === "recording";

  async function handleFund() {
    setError("");
    const provider = getProvider();
    if (!provider) {
      setPhase("error");
      setError(t("payment.walletNoWallet"));
      return;
    }

    const safeWinnerCount =
      rewardMode === "raffle" && Number.isInteger(winnerCount)
        ? Math.max(1, winnerCount)
        : 1;
    const amount = usdcToUnits(rewardAmount) * BigInt(safeWinnerCount);
    if (amount <= BigInt(0)) {
      setPhase("error");
      setError(t("escrow.fund.positiveAmount"));
      return;
    }

    try {
      setPhase("connecting");
      const [account] = (await provider.request({
        method: "eth_requestAccounts",
      })) as `0x${string}`[];
      if (!account) throw new Error(t("payment.walletNoAccount"));

      const walletClient = createWalletClient({
        account,
        chain: base,
        transport: custom(provider),
      });
      const publicClient = createPublicClient({
        chain: base,
        transport: http(),
      });

      // Make sure the wallet is on Base mainnet.
      const currentChain = await walletClient.getChainId();
      if (currentChain !== base.id) {
        await walletClient.switchChain({ id: base.id });
      }

      const taskKey = uuidToBytes32(taskId);

      const targetEscrowAddress =
        rewardMode === "fcfs"
          ? (ESCROW_V2_CONTRACT_ADDRESS as `0x${string}`)
          : (ESCROW_CONTRACT_ADDRESS as `0x${string}`);

      // Approve only if the current allowance is insufficient.
      const allowance = (await publicClient.readContract({
        address: ESCROW_USDC_ADDRESS as `0x${string}`,
        abi: USDC_APPROVE_ABI,
        functionName: "allowance",
        args: [account, targetEscrowAddress],
      })) as bigint;

      if (allowance < amount) {
        setPhase("approving");
        const approveHash = await walletClient.writeContract({
          address: ESCROW_USDC_ADDRESS as `0x${string}`,
          abi: USDC_APPROVE_ABI,
          functionName: "approve",
          args: [targetEscrowAddress, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // Fund the escrow.
      setPhase("funding");
      const fundHash = await walletClient.writeContract({
        address: targetEscrowAddress,
        abi: ESCROW_FUND_ABI,
        functionName: rewardMode === "raffle" ? "fundRaffleEscrow" : "fundEscrow",
        args: [taskKey, amount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: fundHash,
      });
      if (receipt.status !== "success") {
        throw new Error(t("escrow.fund.reverted"));
      }
      setTxHash(fundHash);

      // Record on the task and open it.
      setPhase("recording");
      const result = await markTaskEscrowFundedAction(taskId, fundHash);
      if (!result.ok) throw new Error(result.message);

      setPhase("done");
      router.refresh();
    } catch (err) {
      setPhase("error");
      const message =
        err instanceof Error ? err.message : t("escrow.fund.failed");
      // Wallet rejections are long and noisy — trim to the first line.
      setError(message.split("\n")[0].slice(0, 200));
    }
  }

  const displayAmount =
    rewardMode === "raffle"
      ? rewardAmount * Math.max(1, winnerCount)
      : rewardAmount;

  if (phase === "done") {
    return (
      <div className="comic-card-soft bg-[#dff7e6] p-5">
        <p className="comic-chip bg-[#1f6b3a] text-white">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
          {t("escrow.fund.doneChip")}
        </p>
        <h2 className="mt-4 text-lg font-black text-[#140625]">
          {t("escrow.fund.doneTitle")}
        </h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#3c214b]">
          {t("escrow.fund.doneBody")}
        </p>
        {txHash ? (
          <a
            href={basescanTxUrl(txHash)}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-2 break-all rounded-lg border-2 border-[#140625] bg-white px-3 py-2 text-sm font-black text-[#7c3cff] shadow-[3px_3px_0_#140625] transition hover:bg-[#38e7ff]"
          >
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            {t("escrow.viewFundingTx")}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="comic-card-soft bg-[#f2e6ff] p-5">
      <p className="comic-chip bg-[#7c3cff] text-white">
        <LockKeyhole aria-hidden="true" className="h-3.5 w-3.5" />
        {t("escrow.fund.chip")}
      </p>
      <h2 className="mt-4 text-lg font-black text-[#140625]">
        {t("escrow.fund.title")}
      </h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-[#3c214b]">
        {t("escrow.fund.body", { amount: formatUsdc(displayAmount) })}
      </p>

      {phase === "error" && error ? (
        <div className="mt-4 flex gap-2 rounded-lg border-2 border-[#140625] bg-[#ffe1ed] p-3 text-sm font-bold text-[#8a1742]">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="break-words">{error}</p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleFund}
        disabled={busy}
        className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-[#140625] bg-[#ff4fb8] px-5 py-3 text-sm font-black uppercase text-white shadow-[5px_5px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#7c3cff] disabled:cursor-not-allowed disabled:bg-[#c9c0d3] disabled:text-[#5a3b66]"
      >
        {busy ? (
          <>
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
            {phase === "connecting"
              ? t("escrow.fund.connecting")
              : phase === "approving"
                ? t("escrow.fund.approving")
                : phase === "funding"
                  ? t("escrow.fund.funding")
                  : t("escrow.fund.recording")}
          </>
        ) : (
          <>
            <Wallet aria-hidden="true" className="h-4 w-4" />
            {t("escrow.fund.button")}
          </>
        )}
      </button>
      <p className="mt-3 text-xs font-bold text-[#5a3b66]">
        {t("escrow.fund.prompts")}
      </p>
    </div>
  );
}
