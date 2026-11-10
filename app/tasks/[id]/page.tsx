import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Edit3,
  ExternalLink,
  FileText,
  LockKeyhole,
  Trophy,
  Users,
} from "lucide-react";
import {
  EarlyContributorsOnlyBadge,
  NegotiableBadge,
  PaymentBadge,
  StatusBadge,
  TaskTypeBadge,
} from "@/components/marketplace/badges";
import { SubmissionForm } from "@/components/marketplace/submission-form";
import { ApplyForm } from "@/components/marketplace/apply-form";
import { SubmitWorkForm } from "@/components/marketplace/submit-work-form";
import { EscrowFundPanel } from "@/components/marketplace/escrow-fund-panel";
import { EscrowRefundPanel } from "@/components/marketplace/escrow-refund-panel";
import { SiteHeader } from "@/components/site-header";
import { withdrawApplicationAction } from "@/app/applications/actions";
import {
  escrowContractForTask,
} from "@/lib/escrow";
import {
  createTranslator,
  formatDate,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";
import { getTask, tasks as previewTasks } from "@/lib/marketplace";
import { createClient } from "@/lib/supabase/server";
import { formatUsdc } from "@/lib/payments";
import {
  TASK_LIST_COLUMNS,
  TASK_TYPE_COLOR,
  isUuid,
  type DbTask,
} from "@/lib/tasks";
import {
  APPLICATION_STATUS_COLOR,
  SUBMISSION_COLUMNS,
  SUBMISSION_STATUS_COLOR,
  type DbApplication,
  type DbSubmission,
} from "@/lib/applications";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

async function fetchDbTask(id: string): Promise<DbTask | null> {
  if (!isUuid(id)) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .select(TASK_LIST_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return data as DbTask;
  } catch {
    return null;
  }
}

async function loadActorContext(taskId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        userId: null as string | null,
        isAdmin: false,
        hasEarlyContributorAccess: false,
        ownApplication: null as DbApplication | null,
        ownSubmissions: [] as DbSubmission[],
        applicantCounts: { pending: 0, accepted: 0 },
      };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role, is_early_contributor")
      .eq("id", user.id)
      .maybeSingle();

    const isAdmin = profile?.role === "admin";
    const hasEarlyContributorAccess =
      (profile?.is_early_contributor ?? false) || isAdmin;

    const { data: app } = await supabase
      .from("task_applications")
      .select("id, task_id, applicant_id, message, status, created_at, updated_at")
      .eq("task_id", taskId)
      .eq("applicant_id", user.id)
      .maybeSingle();

    let ownSubmissions: DbSubmission[] = [];
    if (app?.id) {
      const { data: subs } = await supabase
        .from("task_submissions")
        .select(SUBMISSION_COLUMNS)
        .eq("application_id", app.id)
        .order("created_at", { ascending: false });
      ownSubmissions = (subs ?? []) as DbSubmission[];
    }

    return {
      userId: user.id,
      isAdmin,
      hasEarlyContributorAccess,
      ownApplication: (app as DbApplication | null) ?? null,
      ownSubmissions,
      applicantCounts: { pending: 0, accepted: 0 },
    };
  } catch {
    return {
      userId: null as string | null,
      isAdmin: false,
      hasEarlyContributorAccess: false,
      ownApplication: null as DbApplication | null,
      ownSubmissions: [] as DbSubmission[],
      applicantCounts: { pending: 0, accepted: 0 },
    };
  }
}

export async function generateMetadata({ params }: RouteParams) {
  const { id } = await params;
  const dbTask = await fetchDbTask(id);
  if (dbTask) {
    return {
      title: dbTask.title,
      description: dbTask.description.slice(0, 160),
    };
  }
  const preview = previewTasks.find((p) => p.id === id);
  return {
    title: preview ? preview.title : "Task",
    description: preview?.summary ?? "Bountix task detail.",
  };
}

export default async function TaskDetailPage({ params }: RouteParams) {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  const { id } = await params;
  const dbTask = await fetchDbTask(id);

  if (dbTask) {
    const ctx = await loadActorContext(dbTask.id);
    const isOwner = ctx.userId === dbTask.creator_id;
    const isOfficial = dbTask.task_type !== "user_task";
    const isRaffle = dbTask.reward_mode === "raffle";
    const isClosed = ["completed", "cancelled"].includes(dbTask.status);
    const requiresEarlyContributor =
      dbTask.access_level === "early_contributor";
    const canWorkTask =
      !requiresEarlyContributor || ctx.hasEarlyContributorAccess;
    const escrowContractAddr = escrowContractForTask({
      escrowContractAddress: dbTask.escrow_contract_address,
      escrowTxHash: dbTask.escrow_tx_hash,
      rewardMode: dbTask.reward_mode,
    });

    return (
      <main className="comic-page min-h-screen overflow-hidden text-[#140625]">
        <SiteHeader />
        <section className="container-page py-8 sm:py-12">
          <Link
            href="/tasks"
            className="inline-flex items-center gap-2 rounded-lg border-2 border-[#140625] bg-white px-3 py-2 text-sm font-black text-[#140625] shadow-[3px_3px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#38e7ff]"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {t("common.backToTasks")}
          </Link>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
            <article className="comic-card relative overflow-hidden bg-[#fff8ed] p-6 sm:p-8">
              <div className="halftone-mask absolute -right-10 -top-10 h-40 w-40 opacity-20" />
              <div className="relative">
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`inline-flex items-center rounded-md border-2 border-[#140625] px-2 py-1 text-[0.65rem] font-black uppercase shadow-[2px_2px_0_#140625] ${
                      TASK_TYPE_COLOR[dbTask.task_type]
                    }`}
                  >
                    {t(`task.type.${dbTask.task_type}` as TranslationKey)}
                  </span>
                  <span className="inline-flex items-center rounded-md border-2 border-[#140625] bg-white px-2 py-1 text-[0.65rem] font-black uppercase shadow-[2px_2px_0_#140625]">
                    {t(`market.status.${dbTask.status}` as TranslationKey)}
                  </span>
                  {isOfficial ? (
                    <span className="inline-flex items-center rounded-md border-2 border-[#140625] bg-[#ffdd3d] px-2 py-1 text-[0.65rem] font-black uppercase shadow-[2px_2px_0_#140625]">
                      {t("market.badge.official")}
                    </span>
                  ) : null}
                  {isRaffle ? (
                    <span className="inline-flex items-center gap-1 rounded-md border-2 border-[#140625] bg-[#ffdd3d] px-2 py-1 text-[0.65rem] font-black uppercase shadow-[2px_2px_0_#140625]">
                      <Trophy aria-hidden="true" className="h-3 w-3" />
                      {t("raffle.label")}
                    </span>
                  ) : null}
                  {requiresEarlyContributor ? (
                    <EarlyContributorsOnlyBadge locale={locale} />
                  ) : null}
                </div>

                {dbTask.category ? (
                  <p className="mt-8 text-xs font-black uppercase text-[#7c3cff]">
                    {dbTask.category}
                  </p>
                ) : null}
                <h1 className="mt-4 max-w-4xl text-4xl font-black leading-tight text-[#140625] sm:text-6xl">
                  {dbTask.title}
                </h1>
                <p className="mt-6 max-w-3xl whitespace-pre-line text-base font-semibold leading-8 text-[#5a3b66]">
                  {dbTask.description}
                </p>

                <div className="mt-8 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border-2 border-[#140625] bg-[#ffdd3d] p-4 shadow-[4px_4px_0_#140625]">
                    <p className="text-xs font-black uppercase text-[#5a3b66]">
                      {isRaffle
                        ? t("common.rewardPerWinner")
                        : t("common.reward")}
                    </p>
                    <p className="mt-2 inline-flex items-center gap-1.5 text-lg font-black text-[#140625]">
                      {formatUsdc(dbTask.reward_amount ?? 0)}
                      <Image src="/bountix-comic/base-icon.png" alt="Base" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
                    </p>
                  </div>
                  <div className="rounded-lg border-2 border-[#140625] bg-[#38e7ff] p-4 shadow-[4px_4px_0_#140625]">
                    <p className="text-xs font-black uppercase text-[#5a3b66]">
                      {t("common.chain")}
                    </p>
                    <p className="mt-2 text-lg font-black text-[#140625]">{dbTask.chain.toUpperCase()}</p>
                  </div>
                  <div className="rounded-lg border-2 border-[#140625] bg-white p-4 shadow-[4px_4px_0_#140625]">
                    <p className="text-xs font-black uppercase text-[#5a3b66]">
                      {t("common.posted")}
                    </p>
                    <p className="mt-2 text-lg font-black text-[#140625]">{formatDate(dbTask.created_at, locale)}</p>
                  </div>
                </div>

                {dbTask.start_date || dbTask.end_date ? (
                  <div className="mt-6 inline-flex items-center gap-2 rounded-lg border-2 border-[#140625] bg-white px-3 py-2 text-sm font-black text-[#140625] shadow-[3px_3px_0_#140625]">
                    <Calendar aria-hidden="true" className="h-4 w-4 text-[#7c3cff]" />
                    {dbTask.start_date
                      ? `${t("common.starts")} ${formatDate(
                          dbTask.start_date,
                          locale,
                        )}`
                      : null}
                    {dbTask.start_date && dbTask.end_date ? " · " : null}
                    {dbTask.end_date
                      ? `${isRaffle ? t("common.deadline") : t("common.ends")} ${formatDate(
                          dbTask.end_date,
                          locale,
                        )}`
                      : null}
                  </div>
                ) : null}

                {isRaffle ? (
                  <div className="mt-6 rounded-lg border-2 border-[#140625] bg-[#fffaf4] p-5 shadow-[5px_5px_0_#140625]">
                    <div className="flex items-start gap-3">
                      <Trophy
                        aria-hidden="true"
                        className="mt-0.5 h-5 w-5 shrink-0 text-[#7c3cff]"
                      />
                      <div>
                        <h2 className="font-black text-[#140625]">
                          {dbTask.raffle_winner_count}{" "}
                          {dbTask.raffle_winner_count === 1
                            ? t("raffle.raffleWinner")
                            : t("raffle.raffleWinners")}
                        </h2>
                        {dbTask.eligibility_rules ? (
                          <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-6 text-[#3c214b]">
                            {dbTask.eligibility_rules}
                          </p>
                        ) : null}
                        {dbTask.payment_method === "escrow_base" ? (
                          <p className="mt-3 rounded-lg border-2 border-[#140625] bg-[#dff7e6] p-3 text-xs font-black leading-5 text-[#1f6b3a]">
                            {t("raffle.escrowV1Compatible")}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {dbTask.external_link ? (
                  <a href={dbTask.external_link} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-lg border-2 border-[#140625] bg-[#f0d7ff] px-3 py-2 text-sm font-black text-[#140625] shadow-[3px_3px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#38e7ff]">
                    <ExternalLink aria-hidden="true" className="h-4 w-4 text-[#7c3cff]" />
                    {t("taskDetail.openExternalLink")}
                  </a>
                ) : null}

                <div className="mt-8 rounded-lg border-2 border-[#140625] bg-[#38e7ff] p-5 shadow-[5px_5px_0_#140625]">
                  <div className="flex gap-3">
                    <LockKeyhole aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#7c3cff]" />
                    <div>
                      <h2 className="font-black text-[#140625]">{t("payment.methodsTitle")}</h2>
                      <p className="mt-2 text-sm font-semibold leading-6 text-[#3c214b]">{t("payment.methodsBody")}</p>
                    </div>
                  </div>
                </div>
              </div>
            </article>

            <aside className="grid h-fit gap-4">
              {isOwner ? (
                <>
                  <div className="comic-card-soft bg-white p-5">
                    <h2 className="text-lg font-black text-[#140625]">{t("taskDetail.youOwnTitle")}</h2>
                    <p className="mt-2 text-sm font-semibold leading-6 text-[#5a3b66]">
                      {t("taskDetail.youOwnBody")}
                    </p>
                    <div className="mt-4 grid gap-2">
                      <Link href={`/dashboard/tasks/${dbTask.id}/applicants`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 border-[#140625] bg-[#38e7ff] px-4 text-sm font-black uppercase text-[#140625] shadow-[4px_4px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#ffdd3d]">
                        <Users aria-hidden="true" className="h-4 w-4" />
                        {t("taskDetail.applicantsSubmissions")}
                      </Link>
                      <Link href={`/dashboard/tasks/${dbTask.id}/edit`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 border-[#140625] bg-[#ff4fb8] px-4 text-sm font-black uppercase text-white shadow-[4px_4px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#7c3cff]">
                        <Edit3 aria-hidden="true" className="h-4 w-4" />
                        {t("common.editTask")}
                      </Link>
                    </div>
                  </div>

                  {dbTask.payment_method === "escrow_base" ? (
                    dbTask.escrow_tx_hash ? (
                      <>
                        <div className="comic-card-soft bg-[#dff7e6] p-5">
                          <h2 className="text-lg font-black text-[#140625]">
                            {t("taskDetail.escrowFunded")}
                          </h2>
                          <p className="mt-2 text-sm font-semibold leading-6 text-[#5a3b66]">
                            {t("taskDetail.usdcLocked")}
                          </p>
                          <a
                            href={`https://basescan.org/tx/${dbTask.escrow_tx_hash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-4 inline-flex items-center gap-2 break-all rounded-lg border-2 border-[#140625] bg-white px-3 py-2 text-sm font-black text-[#7c3cff] shadow-[3px_3px_0_#140625] transition hover:bg-[#38e7ff]"
                          >
                            <ExternalLink aria-hidden="true" className="h-4 w-4" />
                            {t("taskDetail.viewFundingTx")}
                          </a>
                        </div>
                        <EscrowRefundPanel
                          taskId={dbTask.id}
                          rewardAmount={dbTask.reward_amount ?? 0}
                          contractAddress={escrowContractAddr}
                          locale={locale}
                        />
                      </>
                    ) : (
                      <EscrowFundPanel
                        taskId={dbTask.id}
                        rewardAmount={dbTask.reward_amount ?? 0}
                        rewardMode={dbTask.reward_mode}
                        winnerCount={dbTask.raffle_winner_count}
                        locale={locale}
                      />
                    )
                  ) : null}
                </>
              ) : ctx.isAdmin && !isOwner && dbTask.payment_method === "escrow_base" && dbTask.escrow_tx_hash ? (
                <EscrowRefundPanel
                  taskId={dbTask.id}
                  rewardAmount={dbTask.reward_amount ?? 0}
                  contractAddress={escrowContractAddr}
                  locale={locale}
                />
              ) : !ctx.userId ? (
                <div className="comic-card-soft bg-white p-5">
                  <h2 className="text-lg font-black text-[#140625]">
                    {t("taskDetail.wantToApply")}
                  </h2>
                  {requiresEarlyContributor ? (
                    <p className="mt-2 rounded-lg border-2 border-[#140625] bg-[#f1d8ff] p-3 text-sm font-black leading-6 text-[#140625]">
                      {t("early.onlyContributorsCanWork")}
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#5a3b66]">
                    {t("taskDetail.loginApplyBody")}
                  </p>
                  <div className="mt-4 grid gap-2">
                    <Link href="/login" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 border-[#140625] bg-[#7c3cff] px-4 text-sm font-black uppercase text-white shadow-[4px_4px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#ff4fb8]">{t("common.login")}</Link>
                    <Link href="/signup" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 border-[#140625] bg-[#ffdd3d] px-4 text-sm font-black uppercase text-[#140625] shadow-[4px_4px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#38e7ff]">{t("common.createAccount")}</Link>
                  </div>
                </div>
              ) : ctx.ownApplication ? (
                <ApplicationStatusCard
                  app={ctx.ownApplication}
                  submissions={ctx.ownSubmissions}
                  taskClosed={isClosed}
                  canSubmitWork={canWorkTask}
                  workBlockedReason={
                    requiresEarlyContributor && !canWorkTask
                      ? "early_contributor"
                      : null
                  }
                  locale={locale}
                />
              ) : isClosed ? (
                <div className="comic-card-soft bg-white p-5">
                  <h2 className="text-lg font-black text-[#140625]">{t("taskDetail.closedTitle")}</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#5a3b66]">
                    {t("taskDetail.closedBody")}
                  </p>
                </div>
              ) : !canWorkTask ? (
                <WorkGateNotice locale={locale} />
              ) : (
                <ApplyForm taskId={dbTask.id} locale={locale} />
              )}

              <div className="comic-card-soft bg-[#fffaf4] p-5">
                <h2 className="text-lg font-black text-[#140625]">{t("taskDetail.scopeTitle")}</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#5a3b66]">
                  {t("taskDetail.scopeBody")}
                </p>
              </div>
            </aside>
          </div>
        </section>
      </main>
    );
  }

  // Fallback to static preview for the original 3 ids.
  const previewTask = getTask(id);
  if (!previewTask) {
    notFound();
  }

  return (
    <main className="comic-page min-h-screen overflow-hidden text-[#140625]">
      <SiteHeader />
      <section className="container-page py-8 sm:py-12">
        <Link href="/tasks" className="inline-flex items-center gap-2 rounded-lg border-2 border-[#140625] bg-white px-3 py-2 text-sm font-black text-[#140625] shadow-[3px_3px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#38e7ff]">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t("common.backToTasks")}
        </Link>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
          <article className="comic-card relative overflow-hidden bg-[#fff8ed] p-6 sm:p-8">
            <div className="halftone-mask absolute -right-10 -top-10 h-40 w-40 opacity-20" />
            <div className="relative">
              <div className="flex flex-wrap gap-2">
                <TaskTypeBadge type="task" locale={locale} />
                <PaymentBadge type={previewTask.paymentType} locale={locale} />
                <StatusBadge status={previewTask.status} locale={locale} />
                <NegotiableBadge
                  negotiable={previewTask.negotiable}
                  locale={locale}
                />
                {previewTask.accessLevel === "early_contributor" ? (
                  <EarlyContributorsOnlyBadge locale={locale} />
                ) : null}
              </div>

              <div className="mt-5 rounded-lg border-2 border-[#140625] bg-[#f1d8ff] px-4 py-3 text-sm font-black leading-6 text-[#140625] shadow-[4px_4px_0_#140625]">
                {t("taskDetail.previewNotice")}
                <span className="mt-2 block text-xs font-bold leading-5 text-[#3c214b]">
                  {t("payment.copy")}
                </span>
              </div>

              <p className="mt-8 text-xs font-black uppercase text-[#7c3cff]">{previewTask.category}</p>
              <h1 className="mt-4 max-w-4xl text-4xl font-black leading-tight text-[#140625] sm:text-6xl">
                {t(`preview.${previewTask.id}.title` as TranslationKey)}
              </h1>
              <p className="mt-6 max-w-3xl text-base font-semibold leading-8 text-[#5a3b66]">
                {t(`preview.${previewTask.id}.summary` as TranslationKey)}
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-4">
                {[
                  [t("taskDetail.budget"), previewTask.budget, "bg-[#ffdd3d]"],
                  [t("taskDetail.timeline"), previewTask.timeline, "bg-[#38e7ff]"],
                  [t("taskDetail.applicants"), String(previewTask.applicants), "bg-white"],
                  [t("common.submissions"), String(previewTask.submissions), "bg-[#f1d8ff]"],
                ].map(([label, value, color], index) => (
                  <div key={label} className={`rounded-lg border-2 border-[#140625] p-4 shadow-[4px_4px_0_#140625] ${color}`}>
                    <p className="text-xs font-black uppercase text-[#5a3b66]">{label}</p>
                    <p className="mt-2 inline-flex items-center gap-1.5 text-lg font-black text-[#140625]">
                      {value}
                      {index === 0 && (
                        <Image src="/bountix-comic/base-icon.png" alt="Base" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
                      )}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <h2 className="text-xl font-black text-[#140625]">
                  {t("taskDetail.executionBrief")}
                </h2>
                <div className="mt-4 grid gap-4">
                  {[
                    t("taskDetail.brief1"),
                    t("taskDetail.brief2"),
                    t("taskDetail.brief3"),
                  ].map((item) => (
                    <div key={item} className="flex gap-3 rounded-lg border-2 border-[#140625] bg-white p-4 text-sm font-semibold leading-6 text-[#5a3b66] shadow-[4px_4px_0_#140625]">
                      <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#7c3cff]" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 rounded-lg border-2 border-[#140625] bg-[#38e7ff] p-5 shadow-[5px_5px_0_#140625]">
                <div className="flex gap-3">
                  <LockKeyhole aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#7c3cff]" />
                  <div>
                    <h2 className="font-black text-[#140625]">
                      {t("payment.methodsTitle")}
                    </h2>
                    <p className="mt-2 text-sm font-semibold leading-6 text-[#3c214b]">
                      {t("payment.methodsBody")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </article>

          <aside className="grid h-fit gap-4">
            <div className="comic-card-soft bg-white p-5">
              <h2 className="text-lg font-black text-[#140625]">
                {t("taskDetail.applyPreviewTitle")}
              </h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#5a3b66]">
                {t("taskDetail.applyPreviewBody")}
              </p>
              <Link href="/tasks" className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-[#140625] bg-[#ffdd3d] px-4 text-sm font-black uppercase text-[#140625] shadow-[4px_4px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#38e7ff]">
                <Users aria-hidden="true" className="h-4 w-4" />
                {t("common.browseTasks")}
              </Link>
            </div>

            <SubmissionForm locale={locale} />
          </aside>
        </div>
      </section>
    </main>
  );
}

function ApplicationStatusCard({
  app,
  submissions,
  taskClosed,
  canSubmitWork,
  workBlockedReason,
  locale,
}: {
  app: DbApplication;
  submissions: DbSubmission[];
  taskClosed: boolean;
  canSubmitWork: boolean;
  workBlockedReason: "early_contributor" | null;
  locale: Locale;
}) {
  const t = createTranslator(locale);
  const withdraw = withdrawApplicationAction.bind(null, app.id);
  const latest = submissions[0];

  return (
    <>
      <div className="comic-card-soft bg-white p-5">
        <p className="comic-chip bg-[#38e7ff]">
          {t("taskDetail.yourApplication")}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md border-2 border-[#140625] px-2 py-1 text-[0.7rem] font-black uppercase shadow-[2px_2px_0_#140625] ${APPLICATION_STATUS_COLOR[app.status]}`}
          >
            {t(`market.status.${app.status}` as TranslationKey)}
          </span>
          <span className="text-xs font-bold text-[#5a3b66]">
            {formatDate(app.created_at, locale)}
          </span>
        </div>
        {app.message ? (
          <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-6 text-[#3c214b]">
            {app.message}
          </p>
        ) : null}

        {app.status === "pending" && !taskClosed ? (
          <form action={withdraw} className="mt-4">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 border-[#140625] bg-white px-4 text-xs font-black uppercase text-[#c42463] shadow-[3px_3px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#ffe1ed]"
            >
              {t("taskDetail.withdrawApplication")}
            </button>
          </form>
        ) : null}
      </div>

      {app.status === "accepted" && !latest && canSubmitWork ? (
        <SubmitWorkForm applicationId={app.id} locale={locale} />
      ) : null}
      {app.status === "accepted" && !latest && !canSubmitWork && workBlockedReason ? (
        <WorkGateNotice locale={locale} />
      ) : null}

      {latest ? (
        <div className="comic-card-soft bg-white p-5">
          <p className="comic-chip bg-[#ffdd3d]">
            {t("taskDetail.yourSubmission")}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-md border-2 border-[#140625] px-2 py-1 text-[0.7rem] font-black uppercase shadow-[2px_2px_0_#140625] ${SUBMISSION_STATUS_COLOR[latest.status]}`}
            >
              {t(`market.status.${latest.status}` as TranslationKey)}
            </span>
          <span className="text-xs font-bold text-[#5a3b66]">
            {formatDate(latest.created_at, locale)}
          </span>
          {latest.raffle_winner_position !== null ? (
            <span className="inline-flex items-center gap-1 rounded-md border-2 border-[#140625] bg-[#ffdd3d] px-2 py-1 text-[0.65rem] font-black uppercase shadow-[2px_2px_0_#140625]">
              <Trophy aria-hidden="true" className="h-3 w-3" />
              {t("raffle.winnerNumber", {
                position: latest.raffle_winner_position,
              })}
            </span>
          ) : latest.raffle_eligible ? (
            <span className="inline-flex items-center rounded-md border-2 border-[#140625] bg-[#dff7e6] px-2 py-1 text-[0.65rem] font-black uppercase text-[#1f6b3a] shadow-[2px_2px_0_#140625]">
              {t("raffle.eligible")}
            </span>
          ) : null}
        </div>
          <a
            href={latest.delivery_url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 break-all rounded-lg border-2 border-[#140625] bg-[#fffaf4] px-3 py-2 text-sm font-black text-[#7c3cff] shadow-[3px_3px_0_#140625] transition hover:bg-[#38e7ff]"
          >
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            {latest.delivery_url}
          </a>
          {latest.notes ? (
            <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-6 text-[#3c214b]">
              {latest.notes}
            </p>
          ) : null}
          {latest.review_notes ? (
            <div className="mt-4 rounded-lg border-2 border-dashed border-[#140625] bg-[#f2e6ff] p-3 text-sm font-bold text-[#3c214b]">
              <p className="text-xs font-black uppercase text-[#7c3cff]">
                {t("taskDetail.reviewerFeedback")}
              </p>
              <p className="mt-2 whitespace-pre-line">{latest.review_notes}</p>
            </div>
          ) : null}
          {latest.status === "revision_requested" ? (
            <p className="mt-3 text-xs font-bold text-[#5a3b66]">
              {t("taskDetail.revisionRequested")}
            </p>
          ) : null}
        </div>
      ) : null}

      {app.status === "accepted" &&
      latest &&
      latest.status === "revision_requested" &&
      canSubmitWork ? (
        <SubmitWorkForm applicationId={app.id} locale={locale} />
      ) : null}
      {app.status === "accepted" &&
      latest &&
      latest.status === "revision_requested" &&
      !canSubmitWork &&
      workBlockedReason ? (
        <WorkGateNotice locale={locale} />
      ) : null}
    </>
  );
}

function WorkGateNotice({
  locale,
}: {
  locale: Locale;
}) {
  const t = createTranslator(locale);

  return (
    <div className="comic-card-soft bg-[#f1d8ff] p-5">
      <LockKeyhole
        aria-hidden="true"
        className="h-5 w-5 text-[#7c3cff]"
      />
      <p className="mt-2 text-sm font-black leading-6 text-[#140625]">
        {t("early.onlyContributorsCanWork")}
      </p>
    </div>
  );
}
