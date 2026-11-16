export const TASK_STATUSES = [
  "draft",
  "open",
  "in_progress",
  "submitted",
  "completed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_VISIBLE_STATUSES = [
  "open",
  "in_progress",
  "submitted",
  "completed",
] as const satisfies readonly TaskStatus[];

export const TASK_TYPES = [
  "user_task",
  "official_task",
  "giveaway",
  "campaign",
  "announcement",
  "update",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const ADMIN_TASK_TYPES = [
  "official_task",
  "giveaway",
  "campaign",
  "announcement",
  "update",
] as const satisfies readonly TaskType[];

export const PAYMENT_METHODS = ["manual", "escrow_base"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  manual: "Manual payment",
  escrow_base: "Escrow USDC on Base",
};

export const REWARD_MODES = ["fixed", "raffle"] as const;
export type RewardMode = (typeof REWARD_MODES)[number];
export type DbRewardMode = RewardMode | "fcfs";  

/**  
* Resolve the reward mode to save when editing a task.  
* The edit form only offers REWARD_MODES, so a stored mode the form  
* cannot express (today "fcfs") must keep its stored mode when edited.  
*/ 
export function resolveEditedRewardMode(existing: DbRewardMode, posted: RewardMode): DbRewardMode {   
    return (REWARD_MODES as readonly string[]).includes(existing) ? posted : existing; 
}

export const REWARD_MODE_LABEL: Record<RewardMode, string> = {
  fixed: "Fixed reward",
  raffle: "Raffle reward",
};

export const TASK_ACCESS_LEVELS = ["open", "early_contributor"] as const;
export type TaskAccessLevel = (typeof TASK_ACCESS_LEVELS)[number];

export const TASK_ACCESS_LEVEL_LABEL: Record<TaskAccessLevel, string> = {
  open: "Open to everyone",
  early_contributor: "Early Contributors only",
};

const SOFT_OPEN_DEMO_TASK_RE =
  /(^|[^a-z0-9_])(fake|demo|example|sample|preview)([^a-z0-9_]|$)|(^|[^a-z0-9_])test[\s_-]*(task|bounty|demo|example|sample|only)([^a-z0-9_]|$)/i;

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  draft: "Draft",
  open: "Open",
  in_progress: "In progress",
  submitted: "Submitted",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  user_task: "User task",
  official_task: "Official task",
  giveaway: "Giveaway",
  campaign: "Campaign",
  announcement: "Announcement",
  update: "Update",
};

export const TASK_TYPE_COLOR: Record<TaskType, string> = {
  user_task: "bg-[#38e7ff]",
  official_task: "bg-[#7c3cff] text-white",
  giveaway: "bg-[#ff4fb8] text-white",
  campaign: "bg-[#ffdd3d]",
  announcement: "bg-[#f0d7ff]",
  update: "bg-white",
};

export function isAdminTaskType(t: string): boolean {
  return (ADMIN_TASK_TYPES as readonly string[]).includes(t);
}

export function shouldGateSoftOpenTask(input: {
  title: string;
  description: string;
  category: string | null;
}): boolean {
  return [input.title, input.description, input.category ?? ""].some((value) =>
    SOFT_OPEN_DEMO_TASK_RE.test(value),
  );
}

export type DbTask = {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  category: string | null;
  reward_amount: number | null;
  reward_currency: "USDC";
  chain: "base" | "base-sepolia";
  status: TaskStatus;
  task_type: TaskType;
  external_link: string | null;
  start_date: string | null;
  end_date: string | null;
  reward_mode: DbRewardMode;
  raffle_winner_count: number;
  eligibility_rules: string | null;
  access_level: TaskAccessLevel;
  payment_method: PaymentMethod;
  escrow_contract_address: string | null;
  escrow_tx_hash: string | null;
  created_at: string;
  updated_at: string;
};

/** Lightweight column list for list views — minimises row read size. */
export const TASK_LIST_COLUMNS =
  "id, creator_id, title, description, category, reward_amount, reward_currency, chain, status, task_type, external_link, start_date, end_date, reward_mode, raffle_winner_count, eligibility_rules, access_level, payment_method, escrow_contract_address, escrow_tx_hash, created_at, updated_at";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
