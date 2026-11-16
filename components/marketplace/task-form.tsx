"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  CheckCircle2,
  LoaderCircle,
  Save,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { createTaskAction, updateTaskAction } from "@/app/tasks/actions";
import {
  initialTaskFormState,
  type TaskFormState,
} from "@/lib/task-form-state";
import {
  TASK_STATUSES,
  TASK_TYPES,
  PAYMENT_METHODS,
  REWARD_MODES,
  TASK_ACCESS_LEVELS,
  type DbTask,
  type PaymentMethod,
  type RewardMode,
} from "@/lib/tasks";
import {
  DEFAULT_LOCALE,
  createTranslator,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-2 text-sm font-bold text-[#c42463]">{message}</p>;
}

const input =
  "mt-2 h-12 w-full rounded-lg border-2 border-[#140625] bg-[#fffaf4] px-3 font-medium text-[#140625] placeholder:text-[#5a3b66]/45 outline-none transition focus:bg-white focus:ring-2 focus:ring-[#38e7ff]";

export function TaskForm({
  mode,
  isAdmin,
  initialTask,
  locale = DEFAULT_LOCALE,
}: {
  mode: "create" | "edit";
  isAdmin: boolean;
  initialTask?: DbTask;
  locale?: Locale;
}) {
  const t = createTranslator(locale);
  const boundAction =
    mode === "edit" && initialTask
      ? updateTaskAction.bind(null, initialTask.id)
      : createTaskAction;

  const [state, setState] =
    useState<TaskFormState>(initialTaskFormState);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const result = await boundAction(state, formData);
        if (result) setState(result);
      } catch {
        // redirect or navigation — component may unmount
      }
    });
  }

  const def = initialTask;
  const allowedTypes = isAdmin ? TASK_TYPES : (["user_task"] as const);
  const [rewardMode, setRewardMode] = useState<RewardMode>(
    def?.reward_mode === "raffle" ? "raffle" : "fixed",
  );
  // The form has no FCFS option, so an FCFS task keeps its stored mode on save.
  const isFcfs = def?.reward_mode === "fcfs";
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    def?.payment_method ?? "manual",
  );
  const isRaffle = rewardMode === "raffle";

  return (
    <form onSubmit={handleSubmit} className="comic-card bg-white p-5 sm:p-6">
      <p className="comic-chip bg-[#38e7ff]">
        {mode === "create"
          ? t("form.postTask.chipCreate")
          : t("form.postTask.chipEdit")}
      </p>
      <h1 className="mt-5 text-2xl font-black text-[#140625]">
        {mode === "create"
          ? t("form.postTask.titleCreate")
          : t("form.postTask.titleEdit")}
      </h1>
      <p className="mt-3 text-sm font-medium leading-6 text-[#5a3b66]">
        {t("payment.copy")}
      </p>

      {state.status === "error" && state.message ? (
        <div className="mt-6 flex gap-3 rounded-lg border-2 border-[#140625] bg-[#ffe1ed] p-3 text-sm font-bold text-[#8a1742]">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <p>{state.message}</p>
        </div>
      ) : null}
      {state.status === "success" ? (
        <div className="mt-6 flex gap-3 rounded-lg border-2 border-[#140625] bg-[#dff7e6] p-3 text-sm font-bold text-[#1f6b3a]">
          <CheckCircle2
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <p>{state.message}</p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-5">
        <label className="block">
          <span className="text-sm font-black text-[#140625]">
            {t("form.postTask.titleLabel")}
          </span>
          <input
            name="title"
            type="text"
            required
            minLength={4}
            maxLength={140}
            defaultValue={def?.title ?? ""}
            placeholder={t("form.postTask.titlePlaceholder")}
            className={input}
          />
          <FieldError message={state.fieldErrors?.title} />
        </label>

        <label className="block">
          <span className="text-sm font-black text-[#140625]">
            {t("form.postTask.descriptionLabel")}
          </span>
          <textarea
            name="description"
            rows={6}
            required
            maxLength={4000}
            defaultValue={def?.description ?? ""}
            placeholder={t("form.postTask.descriptionPlaceholder")}
            className="mt-2 w-full rounded-lg border-2 border-[#140625] bg-[#fffaf4] px-3 py-3 font-medium text-[#140625] placeholder:text-[#5a3b66]/45 outline-none transition focus:bg-white focus:ring-2 focus:ring-[#38e7ff]"
          />
          <FieldError message={state.fieldErrors?.description} />
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-black text-[#140625]">
              {t("form.postTask.categoryLabel")}{" "}
              <span className="text-[#5a3b66]">{t("common.optional")}</span>
            </span>
            <input
              name="category"
              type="text"
              maxLength={60}
              defaultValue={def?.category ?? ""}
              placeholder={t("form.postTask.categoryPlaceholder")}
              className={input}
            />
            <FieldError message={state.fieldErrors?.category} />
          </label>

          <label className="block">
            <span className="text-sm font-black text-[#140625]">
              {t("form.postTask.rewardLabel")}
              {isRaffle ? ` ${t("form.postTask.perWinner")}` : " "}
              {!isRaffle ? (
                <span className="text-[#5a3b66]">
                  {t("common.optional")}
                </span>
              ) : null}
            </span>
            <input
              name="reward_amount"
              type="number"
              min="0"
              step="0.01"
              defaultValue={def?.reward_amount ?? ""}
              placeholder="50.00"
              className={input}
            />
            <FieldError message={state.fieldErrors?.reward_amount} />
          </label>
        </div>

        <fieldset className="block">
          <legend className="text-sm font-black text-[#140625]">
            {t("form.postTask.rewardMode")}
          </legend>
          <p className="mt-1 text-xs font-bold text-[#5a3b66]">
            {t("form.postTask.rewardModeHelp")}
          </p>
          {isFcfs ? (<p className="mt-3 rounded-lg border-2 border-[#140625] bg-[#dff7e6] p-3 text-xs font-black leading-5 text-[#1f6b3a]">{t("form.postTask.fcfsKept")}) : null}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {REWARD_MODES.map((modeValue, i) => (
              <label
                key={modeValue}
                className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-[#140625] bg-[#fffaf4] p-3 shadow-[3px_3px_0_#140625] transition hover:bg-white has-[:checked]:bg-[#ffdd3d]"
              >
                <input
                  type="radio"
                  name="reward_mode"
                  value={modeValue}
                  defaultChecked={
                    def?.reward_mode
                      ? rewardMode === modeValue
                      : i === 0
                  }
                  onChange={() => setRewardMode(modeValue)}
                  disabled={isFcfs}
                  className="mt-1 h-4 w-4 accent-[#7c3cff]"
                />
                <span className="text-sm font-black text-[#140625]">
                  {t(`task.rewardMode.${modeValue}` as TranslationKey)}
                  {modeValue === "raffle" ? (
                    <span className="mt-1 block text-xs font-bold text-[#5a3b66]">
                      {t("form.postTask.raffleHelp")}
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs font-bold text-[#5a3b66]">
                      {t("form.postTask.fixedHelp")}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <FieldError message={state.fieldErrors?.reward_mode} />
        </fieldset>

        {isRaffle ? (
          <div className="grid gap-5">
            <label className="block">
              <span className="text-sm font-black text-[#140625]">
                {t("form.postTask.numberWinners")}
              </span>
              <input
                name="raffle_winner_count"
                type="number"
                required
                min="1"
                max="50"
                step="1"
                defaultValue={def?.raffle_winner_count ?? 1}
                className={input}
              />
              <FieldError message={state.fieldErrors?.raffle_winner_count} />
            </label>

            <label className="block">
              <span className="text-sm font-black text-[#140625]">
                {t("form.postTask.eligibilityRules")}
              </span>
              <textarea
                name="eligibility_rules"
                rows={4}
                required
                maxLength={2000}
                defaultValue={def?.eligibility_rules ?? ""}
                placeholder={t("form.postTask.eligibilityPlaceholder")}
                className="mt-2 w-full rounded-lg border-2 border-[#140625] bg-[#fffaf4] px-3 py-3 font-medium text-[#140625] placeholder:text-[#5a3b66]/45 outline-none transition focus:bg-white focus:ring-2 focus:ring-[#38e7ff]"
              />
              <FieldError message={state.fieldErrors?.eligibility_rules} />
            </label>
          </div>
        ) : null}

        <fieldset className="block">
          <legend className="text-sm font-black text-[#140625]">
            {t("form.postTask.paymentMethod")}
          </legend>
          <p className="mt-1 text-xs font-bold text-[#5a3b66]">
            {t("form.postTask.paymentHelp")}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {PAYMENT_METHODS.map((method, i) => (
              <label
                key={method}
                className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-[#140625] bg-[#fffaf4] p-3 shadow-[3px_3px_0_#140625] transition hover:bg-white has-[:checked]:bg-[#38e7ff]"
              >
                <input
                  type="radio"
                  name="payment_method"
                  value={method}
                  defaultChecked={
                    def?.payment_method
                      ? def.payment_method === method
                      : i === 0
                  }
                  onChange={() => setPaymentMethod(method)}
                  className="mt-1 h-4 w-4 accent-[#7c3cff]"
                />
                <span className="text-sm font-black text-[#140625]">
                  {t(`task.payment.${method}` as TranslationKey)}
                  {method === "escrow_base" ? (
                    <span className="mt-1 block text-xs font-bold text-[#5a3b66]">
                      {t("form.postTask.escrowHelp")}
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs font-bold text-[#5a3b66]">
                      {t("form.postTask.manualHelp")}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {isRaffle && paymentMethod === "escrow_base" ? (
            <p className="mt-3 rounded-lg border-2 border-[#140625] bg-[#dff7e6] p-3 text-xs font-black leading-5 text-[#1f6b3a]">
              {t("raffle.escrowV1Compatible")}
            </p>
          ) : null}
          <FieldError message={state.fieldErrors?.payment_method} />
        </fieldset>

        <fieldset className="block">
          <legend className="text-sm font-black text-[#140625]">
            {t("form.postTask.access")}
          </legend>
          <p className="mt-1 text-xs font-bold text-[#5a3b66]">
            {t("form.postTask.accessHelp")}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {TASK_ACCESS_LEVELS.map((level, i) => (
              <label
                key={level}
                className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-[#140625] bg-[#fffaf4] p-3 shadow-[3px_3px_0_#140625] transition hover:bg-white has-[:checked]:bg-[#f1d8ff]"
              >
                <input
                  type="radio"
                  name="access_level"
                  value={level}
                  defaultChecked={
                    def?.access_level ? def.access_level === level : i === 0
                  }
                  className="mt-1 h-4 w-4 accent-[#7c3cff]"
                />
                <span className="text-sm font-black text-[#140625]">
                  {t(`task.access.${level}` as TranslationKey)}
                  {level === "early_contributor" ? (
                    <span className="mt-1 block text-xs font-bold text-[#5a3b66]">
                      {t("form.postTask.accessEarlyHelp")}
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs font-bold text-[#5a3b66]">
                      {t("form.postTask.accessOpenHelp")}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <FieldError message={state.fieldErrors?.access_level} />
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-black text-[#140625]">
              {t("form.postTask.status")}
            </span>
            <select
              name="status"
              defaultValue={def?.status ?? "draft"}
              className="mt-2 h-12 w-full rounded-lg border-2 border-[#140625] bg-[#fffaf4] px-3 font-bold text-[#140625] outline-none focus:bg-white focus:ring-2 focus:ring-[#38e7ff]"
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`market.status.${s}` as TranslationKey)}
                </option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.status} />
          </label>

          <label className="block">
            <span className="text-sm font-black text-[#140625]">
              {t("form.postTask.taskType")}
            </span>
            <select
              name="task_type"
              defaultValue={def?.task_type ?? "user_task"}
              className="mt-2 h-12 w-full rounded-lg border-2 border-[#140625] bg-[#fffaf4] px-3 font-bold text-[#140625] outline-none focus:bg-white focus:ring-2 focus:ring-[#38e7ff]"
            >
              {allowedTypes.map((taskType) => (
                <option key={taskType} value={taskType}>
                  {t(`task.type.${taskType}` as TranslationKey)}
                  {(taskType === "official_task" ||
                    taskType === "giveaway" ||
                    taskType === "campaign" ||
                    taskType === "announcement" ||
                    taskType === "update") &&
                    ` (${t("common.adminOnly")})`}
                </option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.task_type} />
            {!isAdmin && (
              <p className="mt-2 text-xs font-bold text-[#5a3b66]">
                {t("form.postTask.adminTypesHelp")}
              </p>
            )}
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-black text-[#140625]">
            {t("form.postTask.externalLink")}{" "}
            <span className="text-[#5a3b66]">{t("common.optional")}</span>
          </span>
          <input
            name="external_link"
            type="url"
            maxLength={500}
            defaultValue={def?.external_link ?? ""}
            placeholder="https://..."
            className={input}
          />
          <FieldError message={state.fieldErrors?.external_link} />
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-black text-[#140625]">
              {t("form.postTask.startDate")}{" "}
              <span className="text-[#5a3b66]">{t("common.optional")}</span>
            </span>
            <input
              name="start_date"
              type="datetime-local"
              defaultValue={
                def?.start_date
                  ? new Date(def.start_date).toISOString().slice(0, 16)
                  : ""
              }
              className={input}
            />
            <FieldError message={state.fieldErrors?.start_date} />
          </label>

          <label className="block">
            <span className="text-sm font-black text-[#140625]">
              {isRaffle
                ? t("form.postTask.deadline")
                : t("form.postTask.endDate")}{" "}
              {!isRaffle ? (
                <span className="text-[#5a3b66]">
                  {t("common.optional")}
                </span>
              ) : null}
            </span>
            <input
              name="end_date"
              type="datetime-local"
              required={isRaffle}
              defaultValue={
                def?.end_date
                  ? new Date(def.end_date).toISOString().slice(0, 16)
                  : ""
              }
              className={input}
            />
            <FieldError message={state.fieldErrors?.end_date} />
          </label>
        </div>

        <div className="rounded-lg border-2 border-dashed border-[#140625] bg-[#f2e6ff] p-4 text-sm font-bold text-[#3c214b]">
          <Sparkles
            aria-hidden="true"
            className="mr-2 inline h-4 w-4 text-[#7c3cff]"
          />
          {t("form.postTask.paymentNote", {
            emphasis: t("common.usdcOnBase"),
          })}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border-2 border-[#140625] bg-[#ff4fb8] px-5 py-3 text-sm font-black uppercase text-white shadow-[5px_5px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#7c3cff] disabled:cursor-not-allowed disabled:bg-[#c9c0d3] disabled:text-[#5a3b66]"
        >
          {isPending ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin"
              />
              {mode === "create"
                ? t("form.postTask.posting")
                : t("common.saving")}
            </>
          ) : (
            <>
              <Save aria-hidden="true" className="h-4 w-4" />
              {mode === "create"
                ? t("form.postTask.post")
                : t("common.saveChanges")}
            </>
          )}
        </button>
        <Link
          href={mode === "edit" && def ? `/tasks/${def.id}` : "/dashboard/tasks"}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border-2 border-[#140625] bg-white px-5 py-3 text-sm font-black uppercase text-[#140625] shadow-[5px_5px_0_#140625] transition hover:-translate-y-0.5 hover:bg-[#38e7ff]"
        >
          {t("common.cancel")}
        </Link>
      </div>
    </form>
  );
}
