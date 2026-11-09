"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ESCROW_V1_CONTRACT_ADDRESS } from "@/lib/escrow";
import { isUuid } from "@/lib/tasks";
import type {
  ApplyState,
  SubmitState,
} from "@/lib/application-form-state";

async function loadActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null as null };
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, is_early_contributor")
    .eq("id", user.id)
    .maybeSingle();
  return {
    supabase,
    user,
    profile: profile as
      | {
          id: string;
          role: string;
          is_early_contributor: boolean;
        }
      | null,
  };
}

function hasEarlyContributorAccess(profile: {
  role: string;
  is_early_contributor: boolean;
}): boolean {
  return profile.role === "admin" || profile.is_early_contributor;
}

function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

// =====================================================================
// Applications
// =====================================================================

export async function applyToTaskAction(
  taskId: string,
  _previous: ApplyState,
  formData: FormData,
): Promise<ApplyState> {
  if (!isUuid(taskId)) return { status: "error", message: "Invalid task id." };

  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");
  if (!profile) {
    return { status: "error", message: "Your profile is missing." };
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("id, access_level")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) {
    return { status: "error", message: "Task not found." };
  }

  if (
    task.access_level === "early_contributor" &&
    !hasEarlyContributorAccess(profile)
  ) {
    return {
      status: "error",
      message: "Only Early Contributors can work on this task.",
    };
  }

  const message = String(formData.get("message") ?? "").trim();
  if (message.length > 1000) {
    return { status: "error", message: "Message must be 1000 chars or fewer." };
  }

  const { error } = await supabase.from("task_applications").insert({
    task_id: taskId,
    applicant_id: user.id,
    message: message || null,
    status: "pending",
  });

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        message: "You already applied to this task.",
      };
    }
    return {
      status: "error",
      message: error.message || "Could not submit application.",
    };
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath(`/dashboard/applications`);
  return { status: "success", message: "Application submitted." };
}

export async function withdrawApplicationAction(applicationId: string) {
  if (!isUuid(applicationId)) return;
  const { supabase, user } = await loadActor();
  if (!user) redirect("/login");

  const { data: app } = await supabase
    .from("task_applications")
    .select("task_id, applicant_id")
    .eq("id", applicationId)
    .maybeSingle();

  if (!app) return;
  if (app.applicant_id !== user.id) return;

  await supabase
    .from("task_applications")
    .update({ status: "withdrawn" })
    .eq("id", applicationId);

  if (app?.task_id) revalidatePath(`/tasks/${app.task_id}`);
  revalidatePath(`/dashboard/applications`);
}

export async function decideApplicationAction(
  applicationId: string,
  decision: "accepted" | "rejected",
) {
  if (!isUuid(applicationId)) return;
  if (decision !== "accepted" && decision !== "rejected") return;
  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");

  const { data: app } = await supabase
    .from("task_applications")
    .select("task_id")
    .eq("id", applicationId)
    .maybeSingle();

  if (!app) return;

  const { data: task } = await supabase
    .from("tasks")
    .select("creator_id")
    .eq("id", app.task_id)
    .maybeSingle();

  const isAdmin = profile?.role === "admin";
  if (!task || (task.creator_id !== user.id && !isAdmin)) return;

  await supabase
    .from("task_applications")
    .update({ status: decision })
    .eq("id", applicationId);

  if (app?.task_id) {
    revalidatePath(`/tasks/${app.task_id}`);
    revalidatePath(`/dashboard/tasks/${app.task_id}/applicants`);
  }
}

// =====================================================================
// Restore Withdrawn Application (admin/task-owner only)
// =====================================================================

export async function restoreApplicationAction(applicationId: string) {
  if (!isUuid(applicationId)) return;

  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");

  const { data: app } = await supabase
    .from("task_applications")
    .select("task_id, status")
    .eq("id", applicationId)
    .maybeSingle();

  if (!app) return;

  // Only restore withdrawn applications
  if (app.status !== "withdrawn") return;

  // Check permission: task owner or admin
  const { data: task } = await supabase
    .from("tasks")
    .select("creator_id")
    .eq("id", app.task_id)
    .maybeSingle();

  if (!task) return;

  const isAdmin = profile?.role === "admin";
  const isOwner = task.creator_id === user.id;
  if (!isAdmin && !isOwner) return;

  // Restore to pending so the owner can accept/reject again.
  // Submissions still require status='accepted' (guard_task_submissions).
  const { error } = await supabase
    .from("task_applications")
    .update({ status: "pending" })
    .eq("id", applicationId);

  if (error) {
    console.error("restoreApplicationAction failed", error.message);
    return;
  }

  revalidatePath(`/dashboard/tasks/${app.task_id}/applicants`);
  revalidatePath(`/tasks/${app.task_id}`);
}

// =====================================================================
// Submissions
// =====================================================================

export async function createSubmissionAction(
  applicationId: string,
  _previous: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  if (!isUuid(applicationId))
    return { status: "error", message: "Invalid application." };

  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");
  if (!profile) {
    return { status: "error", message: "Your profile is missing." };
  }

  const delivery_url = String(formData.get("delivery_url") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const fieldErrors: SubmitState["fieldErrors"] = {};

  if (!delivery_url) fieldErrors.delivery_url = "Delivery link is required.";
  else if (!isHttpsUrl(delivery_url))
    fieldErrors.delivery_url = "Use a valid HTTPS URL.";
  else if (delivery_url.length > 500)
    fieldErrors.delivery_url = "Link is too long (max 500).";
  if (notes.length > 2000)
    fieldErrors.notes = "Notes must be 2000 chars or fewer.";

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors,
    };
  }

  const { data: app } = await supabase
    .from("task_applications")
    .select("task_id, applicant_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app?.task_id) {
    return { status: "error", message: "Application not found." };
  }
  if (app.applicant_id !== user.id) {
    return {
      status: "error",
      message: "You can only submit work for your own applications.",
    };
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("access_level")
    .eq("id", app.task_id)
    .maybeSingle();

  if (
    task?.access_level === "early_contributor" &&
    !hasEarlyContributorAccess(profile)
  ) {
    return {
      status: "error",
      message: "Only Early Contributors can work on this task.",
    };
  }

  const { error } = await supabase.from("task_submissions").insert({
    task_id: app.task_id,
    application_id: applicationId,
    submitter_id: user.id,
    delivery_url,
    notes: notes || null,
    status: "pending_review",
  });

  if (error) {
    return { status: "error", message: error.message || "Could not submit." };
  }

  revalidatePath(`/tasks/${app.task_id}`);
  revalidatePath(`/dashboard/applications`);
  return { status: "success", message: "Submission posted for review." };
}

export async function updateSubmissionAction(
  submissionId: string,
  _previous: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  if (!isUuid(submissionId))
    return { status: "error", message: "Invalid submission." };

  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");
  if (!profile) {
    return { status: "error", message: "Your profile is missing." };
  }

  const delivery_url = String(formData.get("delivery_url") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const fieldErrors: SubmitState["fieldErrors"] = {};

  if (!delivery_url) fieldErrors.delivery_url = "Delivery link is required.";
  else if (!isHttpsUrl(delivery_url))
    fieldErrors.delivery_url = "Use a valid HTTPS URL.";
  if (notes.length > 2000)
    fieldErrors.notes = "Notes must be 2000 chars or fewer.";
  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors,
    };
  }

  const { data: row } = await supabase
    .from("task_submissions")
    .select("task_id, submitter_id")
    .eq("id", submissionId)
    .maybeSingle();

  if (!row) {
    return { status: "error", message: "Submission not found." };
  }
  if (row.submitter_id !== user.id) {
    return {
      status: "error",
      message: "You can only edit your own submissions.",
    };
  }

  if (row?.task_id) {
    const { data: task } = await supabase
      .from("tasks")
      .select("access_level")
      .eq("id", row.task_id)
      .maybeSingle();

    if (
      task?.access_level === "early_contributor" &&
      !hasEarlyContributorAccess(profile)
    ) {
      return {
        status: "error",
        message: "Only Early Contributors can work on this task.",
      };
    }
  }

  const { error } = await supabase
    .from("task_submissions")
    .update({ delivery_url, notes: notes || null })
    .eq("id", submissionId);

  if (error) {
    return { status: "error", message: error.message };
  }

  if (row?.task_id) revalidatePath(`/tasks/${row.task_id}`);
  return { status: "success", message: "Submission updated." };
}

export async function reviewSubmissionAction(
  submissionId: string,
  formData: FormData,
) {
  if (!isUuid(submissionId)) return;

  const decision = String(formData.get("decision") ?? "");
  if (
    decision !== "approved" &&
    decision !== "rejected" &&
    decision !== "revision_requested"
  ) {
    return;
  }
  const review_notes = String(formData.get("review_notes") ?? "").trim();

  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");

  const { data: row } = await supabase
    .from("task_submissions")
    .select("task_id")
    .eq("id", submissionId)
    .maybeSingle();

  if (!row?.task_id) return;

  const { data: task } = await supabase
    .from("tasks")
    .select("creator_id")
    .eq("id", row.task_id)
    .maybeSingle();

  const isAdmin = profile?.role === "admin";
  if (!task || (task.creator_id !== user.id && !isAdmin)) return;

  await supabase
    .from("task_submissions")
    .update({
      status: decision,
      review_notes: review_notes || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", submissionId);

  if (row?.task_id) {
    revalidatePath(`/tasks/${row.task_id}`);
    revalidatePath(`/dashboard/tasks/${row.task_id}/applicants`);
  }
}

// =====================================================================
// Raffle Metadata (admin/owner only)
// =====================================================================

export async function setSubmissionRaffleEligibilityAction(
  submissionId: string,
  eligible: boolean,
) {
  if (!isUuid(submissionId)) return;

  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");

  const { data: submission } = await supabase
    .from("task_submissions")
    .select("id, task_id, raffle_winner_position")
    .eq("id", submissionId)
    .maybeSingle();

  if (!submission) return;

  const { data: task } = await supabase
    .from("tasks")
    .select("id, creator_id, reward_mode")
    .eq("id", submission.task_id)
    .maybeSingle();

  if (!task || task.reward_mode !== "raffle") return;

  const isAdmin = profile?.role === "admin";
  const isOwner = task.creator_id === user.id;
  if (!isAdmin && !isOwner) return;

  if (!eligible && submission.raffle_winner_position !== null) {
    return;
  }

  const { data: selectedWinner } = await supabase
    .from("task_submissions")
    .select("id")
    .eq("task_id", task.id)
    .not("raffle_winner_position", "is", null)
    .limit(1)
    .maybeSingle();

  if (selectedWinner) return;

  const { error } = await supabase
    .from("task_submissions")
    .update({
      raffle_eligible: eligible,
      raffle_eligible_at: eligible ? new Date().toISOString() : null,
    })
    .eq("id", submissionId);

  if (error) return;

  revalidatePath(`/tasks/${task.id}`);
  revalidatePath(`/dashboard/tasks/${task.id}/applicants`);
  revalidatePath("/dashboard/applications");
}

export async function selectRaffleWinnersAction(taskId: string) {
  if (!isUuid(taskId)) return;

  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");

  const { data: task } = await supabase
    .from("tasks")
    .select("id, creator_id, reward_mode, raffle_winner_count")
    .eq("id", taskId)
    .maybeSingle();

  if (!task || task.reward_mode !== "raffle") return;

  const isAdmin = profile?.role === "admin";
  const isOwner = task.creator_id === user.id;
  if (!isAdmin && !isOwner) return;

  const { error } = await supabase.rpc("select_raffle_winners", {
    p_task_id: taskId,
  });

  if (error) return;

  revalidatePath(`/tasks/${task.id}`);
  revalidatePath(`/dashboard/tasks/${task.id}/applicants`);
  revalidatePath("/dashboard/applications");
}

// =====================================================================
// Escrow Release (admin/owner only)
// =====================================================================

export async function releaseEscrowAction(
  submissionId: string,
  assignTxHash: string,
  releaseTxHash: string,
) {
  if (!isUuid(submissionId)) {
    return { ok: false, message: "Invalid submission." };
  }
  if (!TX_HASH_RE.test(assignTxHash) || !TX_HASH_RE.test(releaseTxHash)) {
    return { ok: false, message: "Invalid transaction hash." };
  }

  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");

  // Fetch submission + task + worker profile
  const { data: submission } = await supabase
    .from("task_submissions")
    .select("task_id, submitter_id, status, raffle_winner_position")
    .eq("id", submissionId)
    .maybeSingle();

  if (!submission) {
    return { ok: false, message: "Submission not found." };
  }

  const { data: task } = await supabase
    .from("tasks")
    .select(
      "id, creator_id, payment_method, reward_amount, reward_mode, raffle_winner_count",
    )
    .eq("id", submission.task_id)
    .maybeSingle();

  if (!task) {
    return { ok: false, message: "Task not found." };
  }

  // Check permission: must be task owner or admin
  const isAdmin = profile?.role === "admin";
  const isOwner = task.creator_id === user.id;
  if (!isAdmin && !isOwner) {
    return { ok: false, message: "Permission denied." };
  }

  // Only escrow tasks can release
  if (task.payment_method !== "escrow_base") {
    return { ok: false, message: "This task uses manual payment." };
  }

  if (submission.status !== "approved") {
    return {
      ok: false,
      message: "Approve the submission before releasing escrow.",
    };
  }

  if (task.reward_mode === "raffle") {
    if (task.raffle_winner_count > 1) {
      return {
        ok: false,
        message:
          "Use the raffle escrow release flow for multi-winner raffles.",
      };
    }
    if (submission.raffle_winner_position === null) {
      return {
        ok: false,
        message: "Only the selected raffle winner can receive escrow.",
      };
    }
  }

  // Fetch worker wallet address
  const { data: worker } = await supabase
    .from("profiles")
    .select("wallet_address")
    .eq("id", submission.submitter_id)
    .maybeSingle();

  if (!worker?.wallet_address) {
    return {
      ok: false,
      message:
        "Worker has not set a wallet address. Ask them to add one in their profile.",
    };
  }

  // Record both assign and release tx hashes on the submission
  const { error } = await supabase
    .from("task_submissions")
    .update({
      assign_tx_hash: assignTxHash,
      assigned_at: new Date().toISOString(),
      release_tx_hash: releaseTxHash,
      released_at: new Date().toISOString(),
    })
    .eq("id", submissionId);

  if (error) {
    return {
      ok: false,
      message: error.message || "Could not record release.",
    };
  }

  revalidatePath(`/dashboard/tasks/${task.id}/applicants`);
  revalidatePath(`/tasks/${task.id}`);

  return { ok: true, message: "Escrow released." };
}

export async function releaseRaffleEscrowAction(
  taskId: string,
  assignTxHash: string,
  releaseTxHash: string,
) {
  if (!isUuid(taskId)) {
    return { ok: false, message: "Invalid task id." };
  }
  if (!TX_HASH_RE.test(assignTxHash) || !TX_HASH_RE.test(releaseTxHash)) {
    return { ok: false, message: "Invalid transaction hash." };
  }

  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");

  const { data: task } = await supabase
    .from("tasks")
    .select(
      "id, creator_id, payment_method, reward_mode, raffle_winner_count, escrow_contract_address",
    )
    .eq("id", taskId)
    .maybeSingle();

  if (!task) {
    return { ok: false, message: "Task not found." };
  }

  const isAdmin = profile?.role === "admin";
  const isOwner = task.creator_id === user.id;
  if (!isAdmin && !isOwner) {
    return { ok: false, message: "Permission denied." };
  }

  if (task.payment_method !== "escrow_base") {
    return { ok: false, message: "This task uses manual payment." };
  }
  if (task.reward_mode !== "raffle") {
    return { ok: false, message: "This task is not a raffle." };
  }
  if (task.raffle_winner_count <= 1) {
    return { ok: false, message: "Use the single-worker release flow." };
  }
  if (
    (task.escrow_contract_address ?? "").toLowerCase() !==
    ESCROW_V1_CONTRACT_ADDRESS.toLowerCase()
  ) {
    return {
      ok: false,
      message: "Multi-winner escrow release requires a V1-funded task.",
    };
  }

  const { data: winners } = await supabase
    .from("task_submissions")
    .select("id, status, release_tx_hash")
    .eq("task_id", taskId)
    .not("raffle_winner_position", "is", null);

  const winnerRows =
    (winners as
      | { id: string; status: string; release_tx_hash: string | null }[]
      | null) ?? [];

  if (winnerRows.length !== task.raffle_winner_count) {
    return { ok: false, message: "Raffle winners are not fully selected." };
  }
  if (winnerRows.some((winner) => winner.status !== "approved")) {
    return {
      ok: false,
      message: "Approve every selected winner before releasing escrow.",
    };
  }
  if (winnerRows.some((winner) => winner.release_tx_hash)) {
    return { ok: false, message: "This raffle escrow is already released." };
  }

  const { error } = await supabase
    .from("task_submissions")
    .update({
      assign_tx_hash: assignTxHash,
      assigned_at: new Date().toISOString(),
      release_tx_hash: releaseTxHash,
      released_at: new Date().toISOString(),
    })
    .in(
      "id",
      winnerRows.map((winner) => winner.id),
    );

  if (error) {
    return {
      ok: false,
      message: error.message || "Could not record raffle release.",
    };
  }

  revalidatePath(`/dashboard/tasks/${task.id}/applicants`);
  revalidatePath(`/tasks/${task.id}`);

  return { ok: true, message: "Raffle escrow released." };
}

// =====================================================================
// Escrow Refund (admin/owner only)
// =====================================================================

export async function refundEscrowAction(
  taskId: string,
  refundTxHash: string,
) {
  if (!isUuid(taskId)) {
    return { ok: false, message: "Invalid task id." };
  }
  if (!TX_HASH_RE.test(refundTxHash)) {
    return { ok: false, message: "Invalid transaction hash." };
  }

  const { supabase, user, profile } = await loadActor();
  if (!user) redirect("/login");

  const { data: task } = await supabase
    .from("tasks")
    .select("id, creator_id, payment_method, escrow_tx_hash, escrow_contract_address, status")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) {
    return { ok: false, message: "Task not found." };
  }

  const isAdmin = profile?.role === "admin";
  const isOwner = task.creator_id === user.id;
  if (!isAdmin && !isOwner) {
    return { ok: false, message: "Permission denied." };
  }

  if (task.payment_method !== "escrow_base") {
    return { ok: false, message: "This task does not use escrow." };
  }

  if (!task.escrow_tx_hash) {
    return { ok: false, message: "This task has not been funded yet." };
  }

  if (task.status === "cancelled") {
    return { ok: false, message: "This task is already cancelled." };
  }

  if (task.status === "completed") {
    return { ok: false, message: "This task is already completed." };
  }

  const { error } = await supabase
    .from("tasks")
    .update({ status: "cancelled" })
    .eq("id", taskId);

  if (error) {
    return {
      ok: false,
      message: error.message || "Could not record refund.",
    };
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/dashboard/tasks");

  return { ok: true, message: "Escrow refunded. Task cancelled." };
}
