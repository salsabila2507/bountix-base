export type EscrowFundKind = "single" | "raffle";

/**
 * Which BountixEscrowV1 funding kind pairs with a task's release flow.
 *
 * The contract enforces matching kinds at release time:
 *   - Single-kind escrows (fundEscrow) release through assignWorker +
 *     releaseEscrow — the flow in EscrowReleasePanel.
 *   - Raffle-kind escrows (fundRaffleEscrow) release through
 *     assignRaffleWinners + releaseRaffleEscrow — the flow in
 *     EscrowRaffleReleasePanel.
 *
 * Single-winner raffle tasks are released through the single flow
 * (releaseEscrowAction allows raffle tasks with raffle_winner_count = 1
 * and the applicants page renders EscrowReleasePanel for them), so they
 * must fund as Single. Mixing kinds strands the funds: a Raffle-kind
 * escrow cannot pass assignWorker/releaseEscrow ("Not single escrow").
 */
export function escrowFundKind(
  rewardMode: string,
  winnerCount: number,
): EscrowFundKind {
  return rewardMode === "raffle" && winnerCount > 1 ? "raffle" : "single";
}
