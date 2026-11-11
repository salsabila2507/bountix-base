"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  TASK_STATUSES,
  TASK_TYPES,
  TASK_ACCESS_LEVELS,
  PAYMENT_METHODS,
  REWARD_MODES,
  isAdminTaskType,
  isUuid,
  shouldGateSoftOpenTask,
  type TaskStatus,
  type TaskType,
  type TaskAccessLevel,
  type PaymentMethod,
  type RewardMode,
} from "@/lib/tasks";
import {
  ESCROW_CONTRACT_ADDRESS,
  ESCROW_V2_CONTRACT_ADDRESS,
  MIN_ESCROW_USDC,
} from "@/lib/escrow";
import type { TaskFormState } from "@/lib/task-form-state";

type ParsedTaskInput = {
  title: string;
  description: string;
  category: string | null;
  reward_amount: number | null;
  status: TaskStatus;
  task_type: TaskType;
  external_link: string | null;
  start_date: string | null;
  end_date: string | null;
  reward_mode: RewardMode;
  raffle_winner_count: number;
  eligibility_rules: string | null;
  access_level: TaskAccessLevel;
  payment_method: PaymentMethod;
};

function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function parseTaskInput(formData: FormData): {
  data: ParsedTaskInput;
  fieldErrors: TaskFormState["fieldErrors"];
} {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const rewardRaw = String(formData.get("reward_amount") ?? "").trim();
  const status = String(formData.get("status") ?? "draft");
  const task_type = String(formData.get("task_type") ?? "user_task");
  const external_link = String(formData.get("external_link") ?? "").trim();
  const start_date_raw = String(formData.get("start_date") ?? "").trim();
  const end_date_raw = String(formData.get("end_date") ?? "").trim();
  const reward_mode = String(formData.get("reward_mode") ?? "fixed");
  const winnerCountRaw = String(formData.get("raffle_winner_count") ?? "").trim();
  const eligibility_rules = String(formData.get("eligibility_rules") ?? "").trim();
  let access_level = String(formData.get("access_level") ?? "open");
  const payment_method = String(formData.get("payment_method") ?? "manual");

  const fieldErrors: TaskFormState["fieldErrors"] = {};

  if (title.length < 4 || title.length > 140) {
    fieldErrors.title = "Title must be 4–140 characters.";
  }
  if (description.length < 1 || description.length > 4000) {
    fieldErrors.description = "Description is required (up to 4000 chars).";
  }
  if (category && category.length > 60) {
    fieldErrors.category = "Category must be 60 characters or fewer.";
  }

  let reward_amount: number | null = null;
  if (rewardRaw) {
    const n = Number(rewardRaw);
    if (!Number.isFinite(n) || n < 0) {
      fieldErrors.reward_amount = "Reward must be a non-negative number.";
    } else if (n > 9_999_999.99) {
      fieldErrors.reward_amount = "Reward is too large.";
    } else {
      reward_amount = Math.round(n * 100) / 100;
    }
  }

  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    fieldErrors.status = "Invalid status.";
  }
  if (!(TASK_TYPES as readonly string[]).includes(task_type)) {
    fieldErrors.task_type = "Invalid task type.";
  }
  if (!(PAYMENT_METHODS as readonly string[]).includes(payment_method)) {
    fieldErrors.payment_method = "Invalid payment method.";
  } else if (payment_method === "escrow_base") {
    // Escrow funds the on-chain contract, which enforces a 1 USDC minimum.
    if (reward_amount === null || reward_amount < MIN_ESCROW_USDC) {
      fieldErrors.payment_method = `Escrow needs a reward of at least ${MIN_ESCROW_USDC} USDC.`;
    }
  }
  if (!(REWARD_MODES as readonly string[]).includes(reward_mode)) {
    fieldErrors.reward_mode = "Invalid reward mode.";
  }
  if (!(TASK_ACCESS_LEVELS as readonly string[]).includes(access_level)) {
    fieldErrors.access_level = "Invalid task access setting.";
  }

  if (
    shouldGateSoftOpenTask({
      title,
      description,
      category: category || null,
    })
  ) {
    access_level = "early_contributor";
  }

  let raffle_winner_count = 1;
  if (reward_mode === "raffle") {
    const n = Number(winnerCountRaw || "1");
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      fieldErrors.raffle_winner_count =
        "Winner count must be a whole number from 1 to 50.";
    } else {
      raffle_winner_count = n;
    }
    if (!eligibility_rules) {
      fieldErrors.eligibility_rules = "Eligibility rules are required.";
    } else if (eligibility_rules.length > 2000) {
      fieldErrors.eligibility_rules =
        "Eligibility rules must be 2000 characters or fewer.";
    }
    if (reward_amount === null || reward_amount <= 0) {
      fieldErrors.reward_amount = "Raffle reward must be greater than 0 USDC.";
    }
  } else if (eligibility_rules.length > 2000) {
    fieldErrors.eligibility_rules =
      "Eligibility rules must be 2000 characters or fewer.";
  }
  if (external_link) {
    if (external_link.length > 500) {
      fieldErrors.external_link =
        "Link must be 500 characters or fewer.";
    } else if (!isHttpsUrl(external_link)) {
      fieldErrors.external_link = "Use a valid HTTPS URL.";
    }
  }

  let start_date: string | null = null;
  let end_date: string | null = null;
  try {
    start_date = start_date_raw
      ? new Date(start_date_raw).toISOString()
      : null;
    end_date = end_date_raw
      ? new Date(end_date_raw).toISOString()
      : null;
  } catch {
    if (start_date_raw) fieldErrors.start_date = "Invalid start date.";
    if (end_date_raw) fieldErrors.end_date = "Invalid end date.";
  }
  if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
    fieldErrors.end_date = "End date must be on or after start date.";
  }
  if (reward_mode === "raffle" && !end_date) {
    fieldErrors.end_date = "Raffle tasks need a deadline.";
  }

  return {
    data: {
      title,
      description,
      category: category || null,
      reward_amount,
      status: status as TaskStatus,
      task_type: task_type as TaskType,
      external_link: external_link || null,
      start_date,
      end_date,
      reward_mode: reward_mode as RewardMode,
      raffle_winner_count,
      eligibility_rules:
        reward_mode === "raffle" ? eligibility_rules : null,
      access_level: access_level as TaskAccessLevel,
      payment_method: payment_method as PaymentMethod,
    },
    fieldErrors,
  };
}

/** Read actor role via dedicated query. */
async function loadActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null as null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  return {
    supabase,
    user,
    profile: profile as | { id: string; role: string } | null,
  };
}

export async function createTaskAction(
  _previous: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");
  if (!profile) {
    return {
      status: "error",
      message: "Your profile is missing. Refresh and try again.",
    };
  }

  const isAdmin = profile.role === "admin";

  const { data, fieldErrors } = parseTaskInput(formData);
  if (Object.keys(fieldErrors ?? {}).length > 0) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors,
    };
  }

  // Non-admins can only create user_task.
  let task_type = data.task_type;
  if (!isAdmin && isAdminTaskType(task_type)) {
    return {
      status: "error",
      message: `Only admins can post a ${task_type}.`,
      fieldErrors: { task_type: "Pick 'user_task'." },
    };
  }
  if (!isAdmin) task_type = "user_task";

  // Escrow tasks stay in draft until the on-chain funding tx confirms;
  // markTaskEscrowFundedAction flips them to open. Manual tasks keep the
  // creator's chosen status, preserving the existing flow.
  const status =
    data.payment_method === "escrow_base" ? "draft" : data.status;

  const { data: inserted, error } = await supabase
    .from("tasks")
    .insert({
      creator_id: user.id,
      title: data.title,
      description: data.description,
      category: data.category,
      reward_amount: data.reward_amount,
      reward_currency: "USDC",
      chain: "base",
      status,
      task_type,
      external_link: data.external_link,
      start_date: data.start_date,
      end_date: data.end_date,
      reward_mode: data.reward_mode,
      raffle_winner_count: data.raffle_winner_count,
      eligibility_rules: data.eligibility_rules,
      access_level: data.access_level,
      payment_method: data.payment_method,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return {
      status: "error",
      message: error.message || "Could not create task right now.",
    };
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard/tasks");

  if (inserted?.id) {
    redirect(`/tasks/${inserted.id}`);
  }

  return { status: "success", message: "Task created." };
}

export async function updateTaskAction(
  taskId: string,
  _previous: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  if (!isUuid(taskId)) {
    return { status: "error", message: "Invalid task id." };
  }

  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");
  if (!profile) {
    return {
      status: "error",
      message: "Your profile is missing. Refresh and try again.",
    };
  }

  const isAdmin = profile.role === "admin";

  const { data, fieldErrors } = parseTaskInput(formData);
  if (Object.keys(fieldErrors ?? {}).length > 0) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors,
    };
  }

  let task_type = data.task_type;
  if (!isAdmin && isAdminTaskType(task_type)) {
    return {
      status: "error",
      message: `Only admins can use ${task_type}.`,
      fieldErrors: { task_type: "Pick 'user_task'." },
    };
  }
  if (!isAdmin) task_type = "user_task";

  // Load full task state for ownership + funding checks.
  const { data: existing } = await supabase
    .from("tasks")
    .select(
      "creator_id, payment_method, escrow_tx_hash, status, reward_amount, reward_mode, raffle_winner_count",
    )
    .eq("id", taskId)
    .maybeSingle();

  if (!existing) {
    return { status: "error", message: "Task not found." };
  }

  if (!isAdmin && existing.creator_id !== user.id) {
    return {
      status: "error",
      message: "You can only edit your own tasks.",
    };
  }

  const isFunded = Boolean(existing.escrow_tx_hash);
  const payment_method: PaymentMethod = isFunded
    ? "escrow_base"
    : data.payment_method;

  // Lock status and reward terms for escrow-funded tasks — on-chain state
  // depends on them, and payout must match the amount already in escrow.
  const status = isFunded ? existing.status : data.status;
  const reward = isFunded ? existing : data;

  const { error } = await supabase
    .from("tasks")
    .update({
      title: data.title,
      description: data.description,
      category: data.category,
      reward_amount: reward.reward_amount,
      reward_currency: "USDC",
      chain: "base",
      status,
      task_type,
      external_link: data.external_link,
      start_date: data.start_date,
      end_date: data.end_date,
      reward_mode: reward.reward_mode,
      raffle_winner_count: reward.raffle_winner_count,
      eligibility_rules: data.eligibility_rules,
      access_level: data.access_level,
      payment_method,
    })
    .eq("id", taskId);

  if (error) {
    return {
      status: "error",
      message: error.message || "Could not save task right now.",
    };
  }

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/dashboard/tasks");

  return { status: "success", message: "Task updated.", taskId };
}

export type EscrowFundResult = {
  ok: boolean;
  message: string;
};

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Record a confirmed escrow funding tx and open the task.
 * Owner-only. Called by the client fund panel after the on-chain
 * fundEscrow transaction is mined. Refuses to overwrite an existing hash.
 */
export async function markTaskEscrowFundedAction(
  taskId: string,
  txHash: string,
): Promise<EscrowFundResult> {
  if (!isUuid(taskId)) {
    return { ok: false, message: "Invalid task id." };
  }
  if (!TX_HASH_RE.test(txHash)) {
    return { ok: false, message: "Invalid transaction hash." };
  }

  const { supabase, user } = await loadActor();
  if (!user) {
    return { ok: false, message: "You must be signed in." };
  }

  // Confirm ownership + escrow intent + not already funded before writing.
  const { data: task } = await supabase
    .from("tasks")
    .select("creator_id, payment_method, escrow_tx_hash, reward_mode")
    .eq("id", taskId)
    .maybeSingle();

  const row = task as
    | {
        creator_id: string;
        payment_method: string;
        escrow_tx_hash: string | null;
        reward_mode: string | null;
      }
    | null;

  if (!row) {
    return { ok: false, message: "Task not found." };
  }
  if (row.creator_id !== user.id) {
    return { ok: false, message: "Only the task owner can fund escrow." };
  }
  if (row.payment_method !== "escrow_base") {
    return { ok: false, message: "This task does not use escrow." };
  }
  if (row.escrow_tx_hash) {
    return { ok: false, message: "This task is already funded." };
  }

  const escrowContractAddress =
    row.reward_mode === "fcfs"
      ? ESCROW_V2_CONTRACT_ADDRESS
      : ESCROW_CONTRACT_ADDRESS;

  const { data: funded, error } = await supabase
    .from("tasks")
    .update({
      escrow_tx_hash: txHash,
      escrow_contract_address: escrowContractAddress,
      status: "open",
    })
    .eq("id", taskId)
    .is("escrow_tx_hash", null)
    .select("id")
    .maybeSingle();

  if (error || !funded) {
    return {
      ok: false,
      message: error?.message || "This task is already funded.",
    };
  }

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/dashboard/tasks");

  return { ok: true, message: "Escrow funded. Task is now open." };
}

export async function deleteTaskAction(taskId: string): Promise<void> {
  if (!isUuid(taskId)) return;

  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");

  const { data: task } = await supabase
    .from("tasks")
    .select("creator_id")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) return;

  const isAdmin = profile?.role === "admin";
  if (!isAdmin && task.creator_id !== user.id) return;

  const { error } = await supabase.from("tasks").delete().eq("id", taskId);

  if (error) return;

  revalidatePath("/tasks");
  revalidatePath("/dashboard/tasks");
  redirect("/dashboard/tasks");
}


// Note: this is a "use server" file — only async functions may be exported.
// Types and constants live in /lib/tasks.ts and /lib/task-form-state.ts.
