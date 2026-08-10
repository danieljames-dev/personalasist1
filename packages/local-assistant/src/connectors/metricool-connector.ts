/**
 * Metricool connector scaffold (Checkpoint J).
 *
 * Uses official API patterns only. No password chat requests.
 * Live calls wait for Owner token/account authorization.
 *
 * Target mapping:
 *   Metricool brands/social → AION brand registry
 *   posts/schedules/metrics → permanent campaign history (later)
 */

export interface MetricoolConnectorConfigV1 {
  /** Env var for API user token — never the token value itself. */
  userTokenEnvVar: string;
  /** Env var for blog/brand id if multi-brand. */
  blogIdEnvVar: string;
  baseUrl: string;
}

export interface MetricoolStatusV1 {
  configured: boolean;
  authorized: boolean;
  consentRequired: boolean;
  code: "READY" | "METRICOOL_OWNER_TOKEN_REQUIRED" | "NOT_CONFIGURED" | "FIXTURE_MODE";
  message: string;
}

export interface MetricoolBrandFixtureV1 {
  id: string;
  name: string;
  networks: string[];
  active: boolean;
}

export interface MetricoolPostFixtureV1 {
  id: string;
  brandId: string;
  network: string;
  text: string;
  publishedAt: string | null;
  scheduledAt: string | null;
  metrics: { likes?: number; comments?: number; reach?: number };
}

export function defaultMetricoolConfig(): MetricoolConnectorConfigV1 {
  return {
    userTokenEnvVar: "AION_METRICOOL_USER_TOKEN",
    blogIdEnvVar: "AION_METRICOOL_BLOG_ID",
    baseUrl: "https://app.metricool.com/api",
  };
}

export function metricoolConnectorStatus(
  config: MetricoolConnectorConfigV1 = defaultMetricoolConfig(),
  env: NodeJS.ProcessEnv = process.env,
): MetricoolStatusV1 {
  const token = env[config.userTokenEnvVar]?.trim();
  if (!token) {
    return {
      configured: false,
      authorized: false,
      consentRequired: true,
      code: "METRICOOL_OWNER_TOKEN_REQUIRED",
      message:
        "Metricool connector scaffold is ready. Owner must supply an official API user token via the named environment variable (never paste the password into chat). Until then AION uses fixtures only.",
    };
  }
  return {
    configured: true,
    authorized: true,
    consentRequired: false,
    code: "READY",
    message: "Metricool token present. Live brand/post sync can run under existing connector policy.",
  };
}

export function listMetricoolBrandFixtures(brands: readonly MetricoolBrandFixtureV1[]): MetricoolBrandFixtureV1[] {
  return brands.filter((b) => b.active);
}

export function bestPerformingPosts(
  posts: readonly MetricoolPostFixtureV1[],
  limit = 5,
): MetricoolPostFixtureV1[] {
  return [...posts]
    .sort((a, b) => {
      const score = (p: MetricoolPostFixtureV1) =>
        (p.metrics.likes ?? 0) + (p.metrics.comments ?? 0) * 2 + (p.metrics.reach ?? 0) / 100;
      return score(b) - score(a);
    })
    .slice(0, limit);
}

export function brandsNeedingAttention(
  brands: readonly MetricoolBrandFixtureV1[],
  posts: readonly MetricoolPostFixtureV1[],
  nowIso: string,
  quietDays = 14,
): Array<{ brand: string; reason: string }> {
  const now = Date.parse(nowIso);
  const out: Array<{ brand: string; reason: string }> = [];
  for (const b of brands.filter((x) => x.active)) {
    const brandPosts = posts.filter((p) => p.brandId === b.id && p.publishedAt);
    if (!brandPosts.length) {
      out.push({ brand: b.name, reason: "No published posts recorded in AION yet." });
      continue;
    }
    const latest = brandPosts.map((p) => Date.parse(p.publishedAt!)).sort((a, c) => c - a)[0]!;
    if (now - latest > quietDays * 86400000) {
      out.push({ brand: b.name, reason: `No post in ${quietDays}+ days (last ${new Date(latest).toISOString().slice(0, 10)}).` });
    }
  }
  return out;
}
