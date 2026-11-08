import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink, Trophy } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import {
  EscrowRaffleReleasePanel,
  EscrowReleasePanel,
} from "@/components/marketplace/escrow-release-panel";
import { TaskChatBox } from "@/components/marketplace/task-chat-box";
import {
  createTranslator,
  formatDate,
  type TranslationKey,
} from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";
import {
  decideApplicationAction,
  restoreApplicationAction,
  reviewSubmissionAction,
  selectRaffleWinnersAction,
  setSubmissionRaffleEligibilityAction,
} from "@/app/applications/actions";
import { createClient } from "@/lib/supabase/server";
import { TASK_LIST_COLUMNS, isUuid, type DbTask } from "@/lib/tasks";
import { escrowContractForTask } from "@/lib/escrow";
import { buildSocialLinks } from "@/lib/profile";
import {
  APPLICATION_COLUMNS,
  APPLICATION_STATUS_COLOR,
  SUBMISSION_COLUMNS,
  SUBMISSION_STATUS_COLOR,
  type DbApplication,
  type DbSubmission,
} from "@/lib/applications";
import {
  TASK_MESSAGE_COLUMNS,
  type DbTaskMessage,
} from "@/lib/task-messages";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export const metadata = {
  title: "Applicants",
  description: "Review applicants and submissions for your task.",
};

type ProfileLite = {
  id: string;
  username: string;
  display_name: string | null;
  wallet_address: string | null;
  social_links: {
    x?: string;
    telegram?: string;
    github?: string;
    website?: string;
  } | null;
};

async function loadPage(taskId: string) {
  if (!isUuid(taskId)) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  const { data: task } = await supabase
    .from("tasks")
    .select(TASK_LIST_COLUMNS)
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return null;

  const isAdmin = profile?.role === "admin";
  const isOwner = task.creator_id === user.id;
  if (!isAdmin && !isOwner) return null;

  const { data: applications } = await supabase
    .from("task_applications")
    .select(APPLICATION_COLUMNS)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });

  const apps = (applications ?? []) as DbApplication[];
  const applicantIds = Array.from(new Set(apps.map((a) => a.applicant_id)));

  const { data: submissions } = await supabase
    .from("task_submissions")
    .select(SUBMISSION_COLUMNS)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });

  const subs = (submissions ?? []) as DbSubmission[];
  const subsByApp = new Map<string, DbSubmission[]>();
  for (const s of subs) {
    const arr = subsByApp.get(s.application_id) ?? [];
    arr.push(s);
    subsByApp.set(s.application_id, arr);
  }

  const { data: messages } = await supabase
    .from("task_messages")
    .select(TASK_MESSAGE_COLUMNS)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  const taskMessages = (messages ?? []) as DbTaskMessage[];
  const messagesByApp = new Map<string, DbTaskMessage[]>();
  for (const message of taskMessages) {
    if (!message.application_id) continue;
    const arr = messagesByApp.get(message.application_id) ?? [];
    arr.push(message);
    messagesByApp.set(message.application_id, arr);
  }

  const profileIds = new Set<string>([
    user.id,
    (task as DbTask).creator_id,
    ...applicantIds,
  ]);
  for (const message of taskMessages) {
    profileIds.add(message.sender_id);
    if (message.receiver_id) profileIds.add(message.receiver_id);
  }

  const profilesByUser = new Map<string, ProfileLite>();
  if (profileIds.size > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, display_name, wallet_address, social_links")
      .in("id", Array.from(profileIds));
    for (const p of profiles ?? []) {
      profilesByUser.set(p.id, p as ProfileLite);
    }
  }

  return {
    task: task as DbTask,
    apps,
    profilesByUser,
    submissions: subs,
    subsByApp,
    messagesByApp,
    currentUserId: user.id,
  };
}

export default async function ApplicantsPage({ params }: RouteParams) {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await loadPage(id);
  if (!data) notFound();

  const {
    task,
    apps,
    profilesByUser,
    submissions,
    subsByApp,
    messagesByApp,
    currentUserId,
  } = data;
  const isRaffle = task.reward_mode === "raffle";
  const eligibleSubs = submissions.filter((s) => s.raffle_eligible);
  const winnerSubs = submissions
    .filter((s) => s.raffle_winner_position !== null)
    .sort(
      (a, b) =>
        (a.raffle_winner_position ?? 0) - (b.raffle_winner_position ?? 0),
    );
  const canSelectWinners =
    isRaffle &&
    winnerSubs.length === 0 &&
    eligibleSubs.length >= task.raffle_winner_count;
  const escrowContractAddress = escrowContractForTask({
    escrowContractAddress: task.escrow_contract_address,
    escrowTxHash: task.escrow_tx_hash,
    rewardMode: task.reward_mode,
  });
  const isMultiWinnerRaffle = isRaffle && task.raffle_winner_count > 1;
  const raffleReleaseWinners = winnerSubs.map((s) => {
    const winnerApp = apps.find((app) => app.id === s.application_id);
    const winnerProfile = winnerApp
      ? profilesByUser.get(winnerApp.applicant_id)
      : null;
    return {
      submissionId: s.id,
      walletAddress: winnerProfile?.wallet_address ?? null,
      grossAmount: task.reward_amount ?? 0,
      label: `#${s.raffle_winner_position}: @${
        winnerProfile?.username ?? t("applicants.unknown")
      }`,
    };
  });
  const canReleaseRaffleEscrow =
    isMultiWinnerRaffle &&
    task.payment_method === "escrow_base" &&
    winnerSubs.length === task.raffle_winner_count &&
    winnerSubs.every((s) => s.status === "approved" && !s.released_at);
  const drawWinners = selectRaffleWinnersAction.bind(null, task.id);

  return (
    <main className="comic-page min-h-screen overflow-hidden text-[#140625]">
      <SiteHeader />
      <section className="container-page py-8 sm:py-12">
        <Link
          href={`/tasks/${task.id}`}
          className="inline-flex items-center gap-2 rounded-lg border-2 border-[#140625] bg-white px-3 py-2 text-sm font-black text-[#140625] shadow-[3px_3px_0_#140625] transition hover:bg-[#38e7ff]"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t("applicants.back")}
        </Link>

        <div className="mt-6">
          <p className="comic-chip bg-[#ffdd3d]">{t("applicants.manage")}</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-black uppercase leading-none sm:text-5xl">
            {task.title}
          </h1>
          <p className="mt-3 text-sm font-bold leading-6 text-[#5a3b66]">
            {t("applicants.body")}
          </p>
        </div>

        {isRaffle ? (
          <div className="comic-card-soft mt-6 bg-[#fffaf4] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="comic-chip bg-[#ffdd3d]">
                  <Trophy aria-hidden="true" className="h-3.5 w-3.5" />
                  {t("raffle.reward")}
                </p>
                <h2 className="mt-4 text-xl font-black text-[#140625]">
                  {task.raffle_winner_count}{" "}
                  {task.raffle_winner_count === 1
                    ? t("raffle.winner")
                    : t("raffle.winners")}
                </h2>
                {task.eligibility_rules ? (
                  <p className="mt-3 max-w-3xl whitespace-pre-line text-sm font-semibold leading-6 text-[#3c214b]">
                    {task.eligibility_rules}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2 text-sm font-black text-[#140625] sm:min-w-48">
                <span className="rounded-lg border-2 border-[#140625] bg-white px-3 py-2 shadow-[3px_3px_0_#140625]">
                  {t("applicants.eligible", { count: eligibleSubs.length })}
                </span>
                <span className="rounded-lg border-2 border-[#140625] bg-white px-3 py-2 shadow-[3px_3px_0_#140625]">
                  {t("applicants.selected", {
                    selected: winnerSubs.length,
                    total: task.raffle_winner_count,
                  })}
                </span>
              </div>
            </div>

            {winnerSubs.length > 0 ? (
              <div className="mt-4 rounded-lg border-2 border-[#140625] bg-[#dff7e6] p-3 text-sm font-bold leading-6 text-[#1f6b3a]">
                <p className="font-black">{t("raffle.winnersSelected")}</p>
                <div className="mt-2 grid gap-1">
                  {winnerSubs.map((s) => {
                    const winnerApp = apps.find(
                      (app) => app.id === s.application_id,
                    );
                    const winnerProfile = winnerApp
                      ? profilesByUser.get(winnerApp.applicant_id)
                      : null;
                    return (
                      <p key={s.id}>
                        #{s.raffle_winner_position}: @
                        {winnerProfile?.username ?? t("applicants.unknown")}
                      </p>
                    );
                  })}
                </div>
                {canReleaseRaffleEscrow ? (
                  <EscrowRaffleReleasePanel
                    taskId={task.id}
                    winners={raffleReleaseWinners}
                    contractAddress={escrowContractAddress}
                    locale={locale}
                  />
                ) : null}
              </div>
            ) : canSelectWinners ? (
              <form action={drawWinners} className="mt-4">
                <button className="inline-flex min-h-11 items-center gap-2 rounded-lg border-2 border-[#140625] bg-[#ff4fb8] px-4 text-sm font-black uppercase text-white shadow-[4px_4px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#7c3cff]">
                  <Trophy aria-hidden="true" className="h-4 w-4" />
                  {t("raffle.randomlySelectWinners")}
                </button>
              </form>
            ) : (
              <p className="mt-4 rounded-lg border-2 border-dashed border-[#140625] bg-white p-3 text-sm font-bold leading-6 text-[#5a3b66]">
                {t("raffle.markEligibleBeforeDrawing", {
                  count: task.raffle_winner_count,
                  noun:
                    task.raffle_winner_count === 1
                      ? t("common.submission")
                      : t("common.submissions"),
                })}
              </p>
            )}
          </div>
        ) : null}

        <div className="mt-8 grid gap-4">
          {apps.length === 0 ? (
            <div className="comic-card bg-white p-6 text-center sm:p-8">
              <h2 className="text-xl font-black text-[#140625]">
                {t("applicants.noApplicants")}
              </h2>
              <p className="mt-3 text-sm font-bold leading-6 text-[#5a3b66]">
                {t("applicants.noApplicantsBody")}
              </p>
            </div>
          ) : (
            apps.map((app) => {
              const applicant = profilesByUser.get(app.applicant_id);
              const socialLinks = buildSocialLinks(applicant?.social_links ?? {});
              const publicLinks = [
                ["X", socialLinks.x],
                ["Telegram", socialLinks.telegram],
                ["GitHub", socialLinks.github],
                ["Website", socialLinks.website],
              ].filter((entry): entry is [string, string] => Boolean(entry[1]));
              const subs = subsByApp.get(app.id) ?? [];
              const chatMessages = messagesByApp.get(app.id) ?? [];
              const latestSubmissionId = subs[0]?.id ?? null;
              const acceptAction = decideApplicationAction.bind(
                null,
                app.id,
                "accepted",
              );
              const rejectAction = decideApplicationAction.bind(
                null,
                app.id,
                "rejected",
              );

              return (
                <article
                  key={app.id}
                  className="comic-card bg-white p-5 sm:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link
                        href={
                          applicant
                            ? `/profile/${applicant.username}`
                            : "#"
                        }
                        className="text-sm font-black uppercase text-[#7c3cff]"
                      >
                        @{applicant?.username ?? t("applicants.unknown")}
                      </Link>
                      {applicant?.display_name ? (
                        <p className="text-base font-bold text-[#140625]">
                          {applicant.display_name}
                        </p>
                      ) : null}
                      {applicant ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link
                            href={`/profile/${applicant.username}`}
                            className="inline-flex min-h-9 items-center gap-2 rounded-lg border-2 border-[#140625] bg-[#38e7ff] px-3 py-1.5 text-xs font-black uppercase text-[#140625] shadow-[3px_3px_0_#140625] transition hover:bg-[#ffdd3d]"
                          >
                            {t("dashboard.profile.viewPublic")}
                          </Link>
                          {publicLinks.map(([label, href]) => (
                            <a
                              key={label}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border-2 border-[#140625] bg-white px-3 py-1.5 text-xs font-black uppercase text-[#140625] shadow-[3px_3px_0_#140625] transition hover:bg-[#f1d8ff]"
                            >
                              <ExternalLink
                                aria-hidden="true"
                                className="h-3.5 w-3.5 text-[#7c3cff]"
                              />
                              {label}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <span
                      className={`inline-flex items-center rounded-md border-2 border-[#140625] px-2 py-1 text-[0.7rem] font-black uppercase shadow-[2px_2px_0_#140625] ${APPLICATION_STATUS_COLOR[app.status]}`}
                    >
                      {t(`market.status.${app.status}` as TranslationKey)}
                    </span>
                  </div>

                  {app.message ? (
                    <p className="mt-3 whitespace-pre-line rounded-lg border-2 border-dashed border-[#140625] bg-[#fffaf4] p-3 text-sm font-semibold leading-6 text-[#3c214b]">
                      {app.message}
                    </p>
                  ) : null}

                  {app.status === "pending" ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <form action={acceptAction}>
                        <button className="inline-flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#140625] bg-[#23b26d] px-3 py-2 text-xs font-black uppercase text-white shadow-[3px_3px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#1f6b3a]">
                          {t("applicants.accept")}
                        </button>
                      </form>
                      <form action={rejectAction}>
                        <button className="inline-flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#140625] bg-white px-3 py-2 text-xs font-black uppercase text-[#c42463] shadow-[3px_3px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#ffe1ed]">
                          {t("applicants.reject")}
                        </button>
                      </form>
                    </div>
                  ) : null}

                  {app.status === "withdrawn" ? (
                    <div className="mt-4">
                      <form
                        action={restoreApplicationAction.bind(null, app.id)}
                      >
                        <button className="inline-flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#140625] bg-[#38e7ff] px-3 py-2 text-xs font-black uppercase text-[#140625] shadow-[3px_3px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#ffdd3d]">
                          {t("applicants.restore")}
                        </button>
                      </form>
                    </div>
                  ) : null}

                  <TaskChatBox
                    taskId={task.id}
                    applicationId={app.id}
                    submissionId={latestSubmissionId}
                    currentUserId={currentUserId}
                    messages={chatMessages}
                    senderProfilesById={profilesByUser}
                    locale={locale}
                  />

                  {subs.length > 0 ? (
                    <div className="mt-5 grid gap-3">
                      <p className="text-xs font-black uppercase text-[#5a3b66]">
                        {t("common.submissions")}
                      </p>
                      {subs.map((s) => {
                        const review = reviewSubmissionAction.bind(null, s.id);
                        const markEligible =
                          setSubmissionRaffleEligibilityAction.bind(
                            null,
                            s.id,
                            true,
                          );
                        const unmarkEligible =
                          setSubmissionRaffleEligibilityAction.bind(
                            null,
                            s.id,
                            false,
                          );
                        const editable = s.status === "pending_review";
                        return (
                          <div
                            key={s.id}
                            className="rounded-lg border-2 border-[#140625] bg-[#fffaf4] p-4 shadow-[3px_3px_0_#140625]"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex items-center rounded-md border-2 border-[#140625] px-2 py-1 text-[0.65rem] font-black uppercase shadow-[2px_2px_0_#140625] ${SUBMISSION_STATUS_COLOR[s.status]}`}
                              >
                                {t(`market.status.${s.status}` as TranslationKey)}
                              </span>
                              <span className="text-xs font-bold text-[#5a3b66]">
                                {formatDate(s.created_at, locale)}
                              </span>
                              {isRaffle ? (
                                s.raffle_winner_position !== null ? (
                                  <span className="inline-flex items-center gap-1 rounded-md border-2 border-[#140625] bg-[#ffdd3d] px-2 py-1 text-[0.65rem] font-black uppercase shadow-[2px_2px_0_#140625]">
                                    <Trophy
                                      aria-hidden="true"
                                      className="h-3 w-3"
                                    />
                                    {t("raffle.winnerNumber", {
                                      position: s.raffle_winner_position,
                                    })}
                                  </span>
                                ) : s.raffle_eligible ? (
                                  <span className="inline-flex items-center rounded-md border-2 border-[#140625] bg-[#dff7e6] px-2 py-1 text-[0.65rem] font-black uppercase text-[#1f6b3a] shadow-[2px_2px_0_#140625]">
                                    {t("raffle.eligibleShort")}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center rounded-md border-2 border-[#140625] bg-white px-2 py-1 text-[0.65rem] font-black uppercase text-[#5a3b66] shadow-[2px_2px_0_#140625]">
                                    {t("raffle.notEligible")}
                                  </span>
                                )
                              ) : null}
                            </div>
                            <a
                              href={s.delivery_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex items-center gap-2 break-all rounded-lg border-2 border-[#140625] bg-white px-3 py-2 text-sm font-black text-[#7c3cff] shadow-[3px_3px_0_#140625] transition hover:bg-[#38e7ff]"
                            >
                              <ExternalLink
                                aria-hidden="true"
                                className="h-4 w-4"
                              />
                              {s.delivery_url}
                            </a>
                            {s.notes ? (
                              <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-6 text-[#3c214b]">
                                {s.notes}
                              </p>
                            ) : null}

                            {isRaffle &&
                            winnerSubs.length === 0 &&
                            s.raffle_winner_position === null ? (
                              <div className="mt-4 flex flex-wrap gap-2">
                                {s.raffle_eligible ? (
                                  <form action={unmarkEligible}>
                                    <button className="inline-flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#140625] bg-white px-3 py-2 text-xs font-black uppercase text-[#8a1742] shadow-[3px_3px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#ffe1ed]">
                                      {t("raffle.removeEligibility")}
                                    </button>
                                  </form>
                                ) : (
                                  <form action={markEligible}>
                                    <button className="inline-flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#140625] bg-[#23b26d] px-3 py-2 text-xs font-black uppercase text-white shadow-[3px_3px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#1f6b3a]">
                                      {t("raffle.markEligible")}
                                    </button>
                                  </form>
                                )}
                              </div>
                            ) : null}

                            {editable ||
                            s.status === "revision_requested" ? (
                              <form action={review} className="mt-4 grid gap-2">
                                <textarea
                                  name="review_notes"
                                  rows={3}
                                  maxLength={2000}
                                  defaultValue={s.review_notes ?? ""}
                                  placeholder={t(
                                    "applicants.reviewNotesPlaceholder",
                                  )}
                                  className="w-full rounded-lg border-2 border-[#140625] bg-white px-3 py-2 text-sm font-medium text-[#140625] placeholder:text-[#5a3b66]/45 outline-none focus:ring-2 focus:ring-[#38e7ff]"
                                />
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    name="decision"
                                    value="approved"
                                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#140625] bg-[#23b26d] px-3 py-2 text-xs font-black uppercase text-white shadow-[3px_3px_0_#140625] transition hover:-translate-y-0.5"
                                  >
                                    {t("common.approve")}
                                  </button>
                                  <button
                                    name="decision"
                                    value="revision_requested"
                                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#140625] bg-[#ffdd3d] px-3 py-2 text-xs font-black uppercase text-[#140625] shadow-[3px_3px_0_#140625] transition hover:-translate-y-0.5"
                                  >
                                    {t("applicants.requestRevision")}
                                  </button>
                                  <button
                                    name="decision"
                                    value="rejected"
                                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border-2 border-[#140625] bg-white px-3 py-2 text-xs font-black uppercase text-[#c42463] shadow-[3px_3px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#ffe1ed]"
                                  >
                                    {t("applicants.reject")}
                                  </button>
                                </div>
                              </form>
                            ) : null}

                            {s.review_notes &&
                            (s.status === "approved" ||
                              s.status === "rejected") ? (
                              <p className="mt-3 rounded-lg border-2 border-dashed border-[#140625] bg-[#f2e6ff] p-3 text-sm font-bold text-[#3c214b]">
                                {s.review_notes}
                              </p>
                            ) : null}

                            {s.status === "approved" &&
                            task.payment_method === "escrow_base" &&
                            !s.released_at &&
                            (!isRaffle ||
                              (task.raffle_winner_count === 1 &&
                                s.raffle_winner_position !== null)) ? (
                              <EscrowReleasePanel
                                submissionId={s.id}
                                taskId={task.id}
                                rewardAmount={task.reward_amount}
                                workerWalletAddress={applicant ? applicant.wallet_address : null}
                                contractAddress={escrowContractAddress}
                                locale={locale}
                              />
                            ) : null}

                            {s.released_at ? (
                              <div className="mt-4 rounded-lg border-2 border-[#140625] bg-[#dff7e6] p-3 text-sm font-bold text-[#1f6b3a]">
                                {t("escrow.releasedOn", {
                                  date: formatDate(s.released_at, locale),
                                })}
                                {s.assign_tx_hash ? (
                                  <div className="mt-2 space-y-1">
                                    <a
                                      href={`https://basescan.org/tx/${s.assign_tx_hash}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block text-xs font-black text-[#7c3cff] hover:underline"
                                    >
                                      {t("escrow.release.viewAssignTx")}
                                    </a>
                                  </div>
                                ) : null}
                                {s.release_tx_hash ? (
                                  <div className="space-y-1">
                                    <a
                                      href={`https://basescan.org/tx/${s.release_tx_hash}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block text-xs font-black text-[#7c3cff] hover:underline"
                                    >
                                      {t("escrow.release.viewReleaseTx")}
                                    </a>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}
