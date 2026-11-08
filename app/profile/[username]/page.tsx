import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  Globe,
  Send,
  Sparkles,
  Wallet,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { ServiceOfferCard } from "@/components/marketplace/service-offer-card";
import { createTranslator, formatDate } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildSocialLinks,
  PROFILE_LANGUAGE_LABEL,
  PROFILE_ROLE_LABEL,
  type Profile,
  type ProfileLanguage,
  type ProfileRole,
  type SocialLinks,
} from "@/lib/profile";
import {
  SERVICE_LIST_COLUMNS,
  type DbServiceOffer,
  type PublicServiceOffer,
} from "@/lib/services";

type RouteParams = { params: Promise<{ username: string }> };

export const dynamic = "force-dynamic";

async function fetchProfile(username: string): Promise<Profile | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, username, display_name, bio, avatar_url, role, skills, wallet_address, social_links, preferred_language, can_use_platform, is_early_contributor, referral_code, created_at, updated_at",
      )
      .eq("username", username.toLowerCase())
      .maybeSingle();

    if (error || !data) return null;
    return {
      ...data,
      role: data.role as ProfileRole,
      preferred_language: data.preferred_language as ProfileLanguage,
      social_links: (data.social_links ?? {}) as SocialLinks,
      skills: data.skills ?? [],
    } as Profile;
  } catch {
    return null;
  }
}

async function fetchProfileServices(
  profile: Profile,
): Promise<PublicServiceOffer[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("services")
      .select(SERVICE_LIST_COLUMNS)
      .eq("creator_id", profile.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(12);

    if (error || !data) return [];
    const creator = {
      id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      skills: profile.skills,
      social_links: profile.social_links,
      is_early_contributor: profile.is_early_contributor,
    };
    return (data as DbServiceOffer[]).map((service) => ({
      ...service,
      creator,
    }));
  } catch {
    return [];
  }
}

async function getViewerIsAuthed(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return Boolean(user);
  } catch {
    return false;
  }
}

export async function generateMetadata({ params }: RouteParams) {
  const { username } = await params;
  const profile = await fetchProfile(username);
  if (!profile) return { title: `@${username}` };
  return {
    title: profile.display_name
      ? `${profile.display_name} (@${profile.username})`
      : `@${profile.username}`,
    description:
      profile.bio ??
      `${PROFILE_ROLE_LABEL[profile.role]} on Bountix.`,
  };
}

export default async function PublicProfilePage({ params }: RouteParams) {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  const { username } = await params;
  const profile = await fetchProfile(username);
  if (!profile) {
    notFound();
  }

  const [services, viewerIsAuthed] = await Promise.all([
    fetchProfileServices(profile),
    getViewerIsAuthed(),
  ]);
  const social = buildSocialLinks(profile.social_links);
  const displayName = profile.display_name ?? `@${profile.username}`;

  return (
    <main className="comic-page min-h-screen overflow-hidden text-[#140625]">
      <SiteHeader />
      <section className="container-page py-8 sm:py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border-2 border-[#140625] bg-white px-3 py-2 text-sm font-black text-[#140625] shadow-[3px_3px_0_#140625] transition hover:bg-[#38e7ff]"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t("common.backHome")}
        </Link>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
          <article className="comic-card relative overflow-hidden bg-[#fff8ed] p-6 sm:p-8">
            <div className="halftone-mask absolute -right-10 -top-10 h-40 w-40 opacity-20" />

            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 border-[#140625] bg-[#ffdd3d] shadow-[5px_5px_0_#140625]">
                  {profile.avatar_url ? (
                    <Image
                      src={profile.avatar_url}
                      alt=""
                      fill
                      sizes="80px"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-2xl font-black text-[#140625]">
                      {profile.username.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </span>
                <div>
                  <p className="text-sm font-bold text-[#7c3cff]">
                    @{profile.username}
                  </p>
                  <h1 className="mt-1 text-3xl font-black tracking-tight text-[#140625] sm:text-4xl">
                    {displayName}
                  </h1>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[#140625] bg-[#38e7ff] px-3 py-1.5 text-xs font-black uppercase text-[#140625] shadow-[3px_3px_0_#140625]">
                  <BadgeCheck aria-hidden="true" className="h-3.5 w-3.5" />
                  {PROFILE_ROLE_LABEL[profile.role]}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[#140625] bg-white px-3 py-1.5 text-xs font-black uppercase text-[#140625] shadow-[3px_3px_0_#140625]">
                  <Globe aria-hidden="true" className="h-3.5 w-3.5" />
                  {PROFILE_LANGUAGE_LABEL[profile.preferred_language]}
                </span>
                {profile.is_early_contributor ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[#140625] bg-[#f1d8ff] px-3 py-1.5 text-xs font-black uppercase text-[#140625] shadow-[3px_3px_0_#140625]">
                    <BadgeCheck
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-[#7c3cff]"
                    />
                    {t("early.contributor")}
                  </span>
                ) : null}
              </div>
            </div>

            {profile.bio ? (
              <p className="mt-6 max-w-3xl whitespace-pre-line text-base font-semibold leading-7 text-[#3c214b]">
                {profile.bio}
              </p>
            ) : (
              <p className="mt-6 text-sm font-bold leading-6 text-[#5a3b66]">
                {t("profile.noBio")}
              </p>
            )}

            {profile.skills.length > 0 ? (
              <div className="mt-6">
                <h2 className="text-xs font-black uppercase text-[#5a3b66]">
                  {t("dashboard.profile.skills")}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {profile.skills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-lg border-2 border-[#140625] bg-white px-3 py-1.5 text-sm font-black text-[#140625] shadow-[3px_3px_0_#140625]"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </article>

          <aside className="grid h-fit gap-4">
            <div className="comic-card-soft bg-white p-5">
              <h2 className="text-lg font-black text-[#140625]">
                {t("profile.links")}
              </h2>
              <div className="mt-4 grid gap-2 text-sm font-bold">
                <SocialRow label="X" href={social.x} icon="x" openLabel={t("common.open")} />
                <SocialRow
                  label="Telegram"
                  href={social.telegram}
                  icon="telegram"
                  openLabel={t("common.open")}
                />
                <SocialRow
                  label="GitHub"
                  href={social.github}
                  icon="github"
                  openLabel={t("common.open")}
                />
                <SocialRow
                  label="Website"
                  href={social.website}
                  icon="website"
                  openLabel={t("common.open")}
                />
                {!social.x &&
                !social.telegram &&
                !social.github &&
                !social.website ? (
                  <p className="text-sm font-bold leading-6 text-[#5a3b66]">
                    {t("profile.noPublicLinks")}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="comic-card-soft bg-[#fffaf4] p-5">
              <div className="flex items-center gap-2">
                <Wallet
                  aria-hidden="true"
                  className="h-5 w-5 text-[#7c3cff]"
                />
                <h2 className="text-lg font-black text-[#140625]">
                  {t("profile.walletBase")}
                </h2>
              </div>
              <p className="mt-3 break-all text-sm font-semibold leading-6 text-[#3c214b]">
                {profile.wallet_address ?? t("dashboard.profile.notConnected")}
              </p>
              <p className="mt-3 text-xs font-bold leading-5 text-[#5a3b66]">
                {t("profile.walletComing")}
              </p>
            </div>

            <div className="comic-card-soft bg-[#f2e6ff] p-5">
              <Sparkles
                aria-hidden="true"
                className="h-5 w-5 text-[#7c3cff]"
              />
              <h2 className="mt-3 text-lg font-black text-[#140625]">
                {t("profile.joinedBountix")}
              </h2>
              <p className="mt-2 text-sm font-bold leading-6 text-[#5a3b66]">
                {formatDate(profile.created_at, locale)}
              </p>
            </div>
          </aside>
        </div>

        <section className="mt-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="comic-chip bg-[#ffdd3d]">
                {t("service.creatorServices")}
              </p>
              <h2 className="mt-3 text-3xl font-black uppercase leading-none sm:text-4xl">
                {t("service.profileServicesTitle")}
              </h2>
            </div>
          </div>

          {services.length > 0 ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {services.map((service) => (
                <ServiceOfferCard
                  key={service.id}
                  service={service}
                  locale={locale}
                  viewerIsAuthed={viewerIsAuthed}
                />
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-lg border-2 border-[#140625] bg-white p-6 text-center shadow-[5px_5px_0_#140625]">
              <h3 className="text-lg font-black text-[#140625]">
                {t("service.noProfileServicesTitle")}
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm font-bold leading-6 text-[#5a3b66]">
                {t("service.noProfileServicesBody")}
              </p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function SocialRow({
  label,
  href,
  icon,
  openLabel,
}: {
  label: string;
  href?: string;
  icon: "x" | "telegram" | "github" | "website";
  openLabel: string;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center justify-between gap-3 rounded-lg border-2 border-[#140625] bg-[#fffaf4] px-3 py-2 font-black uppercase text-[#140625] shadow-[3px_3px_0_#140625] transition hover:bg-[#38e7ff]"
    >
      <span className="inline-flex items-center gap-2">
        {icon === "telegram" ? (
          <Send aria-hidden="true" className="h-4 w-4 text-[#7c3cff]" />
        ) : (
          <Globe aria-hidden="true" className="h-4 w-4 text-[#7c3cff]" />
        )}
        {label}
      </span>
      <span className="text-xs font-bold normal-case text-[#7c3cff]">
        {openLabel}
      </span>
    </a>
  );
}
