export const PROFILE_ROLES = ["user", "creator", "operator", "admin"] as const;
export type ProfileRole = (typeof PROFILE_ROLES)[number];

export const PROFILE_LANGUAGES = ["en", "id", "zh"] as const;
export type ProfileLanguage = (typeof PROFILE_LANGUAGES)[number];

export const PROFILE_LANGUAGE_LABEL: Record<ProfileLanguage, string> = {
  en: "English",
  id: "Bahasa Indonesia",
  zh: "中文 (Chinese)",
};

export const PROFILE_ROLE_LABEL: Record<ProfileRole, string> = {
  user: "Explorer",
  creator: "Creator",
  operator: "Operator",
  admin: "Admin",
};

/** Shape persisted in profiles.social_links jsonb. All keys optional. */
export type SocialLinks = {
  x?: string;
  telegram?: string;
  github?: string;
  website?: string;
};

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  role: ProfileRole;
  skills: string[];
  wallet_address: string | null;
  social_links: SocialLinks;
  preferred_language: ProfileLanguage;
  can_use_platform: boolean;
  is_early_contributor: boolean;
  referral_code: string;
  created_at: string;
  updated_at: string;
};

export const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
export const WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function validateUsername(value: string): string | null {
  if (!value) return "Username is required.";
  if (!USERNAME_PATTERN.test(value)) {
    return "Use 3–30 lowercase letters, numbers, or underscores.";
  }
  return null;
}

export function validateWalletAddress(value: string): string | null {
  if (!value) return null;
  if (!WALLET_PATTERN.test(value)) {
    return "Wallet address must be a 0x-prefixed Ethereum/Base address.";
  }
  return null;
}

export function validateUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return "URL must start with https://.";
    }
    return null;
  } catch {
    return "Enter a valid URL.";
  }
}

const SOCIAL_PROFILE_URLS = {
  x: "https://x.com/",
  telegram: "https://t.me/",
  github: "https://github.com/",
} as const;

/** Expand social handles and trim non-empty link values. */
export function buildSocialLinks(input: SocialLinks): SocialLinks {
  const result: SocialLinks = {};
  for (const key of ["x", "telegram", "github", "website"] as const) {
    const v = input[key]?.trim();
    if (v) {
      result[key] =
        key !== "website" && /^@?[A-Za-z0-9_-]+$/u.test(v)
          ? `${SOCIAL_PROFILE_URLS[key]}${v.replace(/^@/u, "")}`
          : v;
    }
  }
  return result;
}

/** Parse a comma-separated skills string into a normalized array of up to 12. */
export function parseSkills(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}
