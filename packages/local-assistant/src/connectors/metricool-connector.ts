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

/**
 * Map Metricool brand names → AION brand workspaces.
 * Auto-map only high-confidence exact/normalized name matches; otherwise review.
 */
export function mapMetricoolBrandsToWorkspaces(
  metricoolBrands: readonly { id: string; name: string }[],
  aionWorkspaces: readonly { id: string; label: string; brandName?: string; archived?: boolean }[],
): Array<{
  metricoolId: string;
  metricoolName: string;
  workspaceId: string | null;
  workspaceLabel: string | null;
  confidence: "high" | "medium" | "low";
  action: "auto_map" | "review";
  reason: string;
}> {
  const norm = (s: string) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const live = aionWorkspaces.filter((w) => !w.archived);
  return metricoolBrands.map((mb) => {
    const n = norm(mb.name);
    let best: { id: string; label: string; score: number } | null = null;
    for (const w of live) {
      const labels = [w.label, w.brandName || ""].map(norm).filter(Boolean);
      for (const L of labels) {
        let score = 0;
        if (L === n) score = 100;
        else if (L.includes(n) || n.includes(L)) score = 80;
        else if (n.split(" ").some((t) => t.length > 3 && L.includes(t))) score = 50;
        if (!best || score > best.score) best = { id: w.id, label: w.label, score };
      }
    }
    if (best && best.score >= 90) {
      return {
        metricoolId: mb.id,
        metricoolName: mb.name,
        workspaceId: best.id,
        workspaceLabel: best.label,
        confidence: "high" as const,
        action: "auto_map" as const,
        reason: "Exact or near-exact brand/workspace name match.",
      };
    }
    if (best && best.score >= 70) {
      return {
        metricoolId: mb.id,
        metricoolName: mb.name,
        workspaceId: best.id,
        workspaceLabel: best.label,
        confidence: "medium" as const,
        action: "review" as const,
        reason: "Partial name overlap — Owner should confirm mapping.",
      };
    }
    return {
      metricoolId: mb.id,
      metricoolName: mb.name,
      workspaceId: null,
      workspaceLabel: null,
      confidence: "low" as const,
      action: "review" as const,
      reason: "No confident AION brand workspace match.",
    };
  });
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
