/**
 * Gmail connector (Checkpoint I) — official OAuth/API shapes only.
 *
 * Implementation is fixture-first until Owner OAuth. No browser password scrape.
 * Owner Google OAuth consent is required before live calls.
 *
 * After Owner authority envelope expansion (R9):
 *   READ, SEARCH, THREAD_INGEST, CREATE_DRAFT = permitted when authorized
 *   SEND = permitted only when authority envelope emailSend is true AND kill switches clear
 *          AND per-message safety checks pass (enforced in service layer).
 */

export type GmailCapabilityV1 =
  | "search"
  | "read_message"
  | "read_thread"
  | "create_draft"
  | "send";

export interface GmailConnectorConfigV1 {
  /** OAuth client id from Google Cloud console (Owner-created). */
  clientId: string;
  /** Env var name holding client secret — never the secret itself. */
  clientSecretEnvVar: string;
  /** Env var name holding refresh token after Owner consent. */
  refreshTokenEnvVar: string;
  /** Redirect URI registered with Google (loopback preferred). */
  redirectUri: string;
  /** Enabled capabilities. send defaults false. */
  capabilities: GmailCapabilityV1[];
}

export interface GmailMessageFixtureV1 {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  bodyText: string;
  internalDate: string;
  labelIds: string[];
}

export interface GmailDraftResultV1 {
  id: string;
  messageId: string;
  subject: string;
  body: string;
  status: "draft";
  basedOn: string;
}

export interface GmailConnectorStatusV1 {
  configured: boolean;
  authorized: boolean;
  consentRequired: boolean;
  capabilities: GmailCapabilityV1[];
  message: string;
  code: "READY" | "GMAIL_OWNER_CONSENT_REQUIRED" | "NOT_CONFIGURED" | "FIXTURE_MODE";
}

const DEFAULT_CAPS: GmailCapabilityV1[] = ["search", "read_message", "read_thread", "create_draft"];

export function defaultGmailConfig(): GmailConnectorConfigV1 {
  return {
    clientId: "",
    clientSecretEnvVar: "AION_GMAIL_CLIENT_SECRET",
    refreshTokenEnvVar: "AION_GMAIL_REFRESH_TOKEN",
    redirectUri: "http://127.0.0.1:31415/oauth/gmail/callback",
    capabilities: [...DEFAULT_CAPS],
  };
}

export function gmailConnectorStatus(
  config: GmailConnectorConfigV1 = defaultGmailConfig(),
  env: NodeJS.ProcessEnv = process.env,
  opts: { sendAuthorized?: boolean } = {},
): GmailConnectorStatusV1 {
  const hasClient = Boolean(config.clientId?.trim());
  const hasSecret = Boolean(env[config.clientSecretEnvVar]?.trim());
  const hasRefresh = Boolean(env[config.refreshTokenEnvVar]?.trim());
  const caps = [...config.capabilities];
  if (opts.sendAuthorized === true && !caps.includes("send")) caps.push("send");
  if (!hasClient) {
    return {
      configured: false,
      authorized: false,
      consentRequired: false,
      capabilities: caps.filter((c) => c !== "send" || opts.sendAuthorized === true),
      message: "Gmail connector code is ready. Configure Google OAuth client id, then complete Owner consent.",
      code: "NOT_CONFIGURED",
    };
  }
  if (!hasSecret || !hasRefresh) {
    return {
      configured: true,
      authorized: false,
      consentRequired: true,
      capabilities: caps.filter((c) => c !== "send" || opts.sendAuthorized === true),
      message:
        "Gmail OAuth client is partially configured. Owner must complete Google consent via official flow (tokens in env vars only — never paste into chat).",
      code: "GMAIL_OWNER_CONSENT_REQUIRED",
    };
  }
  return {
    configured: true,
    authorized: true,
    consentRequired: false,
    capabilities: opts.sendAuthorized === true ? caps : caps.filter((c) => c !== "send"),
    message: opts.sendAuthorized
      ? "Gmail credentials present. SEND authorized by Owner envelope with per-message safety checks."
      : "Gmail credentials present. SEND not enabled in current envelope/kill switches.",
    code: "READY",
  };
}

/** Fixture search — used in tests and before OAuth. */
export function searchGmailFixtures(
  messages: readonly GmailMessageFixtureV1[],
  query: string,
): GmailMessageFixtureV1[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...messages];
  return messages.filter((m) =>
    `${m.from} ${m.to} ${m.subject} ${m.snippet} ${m.bodyText}`.toLowerCase().includes(q),
  );
}

/**
 * Marketing / newsletter / bulk automation signals.
 * Multi-evidence: never rely on a single keyword like "I'll" or "sales".
 */
export function isMarketingOrBulkMail(input: {
  from?: string;
  to?: string;
  subject?: string;
  snippet?: string;
  bodyText?: string;
  labelIds?: string[];
  headers?: Record<string, string>;
}): { bulk: boolean; reasons: string[] } {
  const from = String(input.from ?? "").toLowerCase();
  const subject = String(input.subject ?? "").toLowerCase();
  const body = `${input.snippet ?? ""} ${input.bodyText ?? ""}`.slice(0, 6000).toLowerCase();
  const labels = (input.labelIds ?? []).map((l) => String(l).toLowerCase());
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    headers[k.toLowerCase()] = String(v ?? "");
  }
  const reasons: string[] = [];

  if (labels.some((l) => l === "category_promotions" || l === "category_social" || l === "spam")) {
    reasons.push("gmail_category_bulk");
  }
  if (headers["list-unsubscribe"] || headers["list-id"] || headers["mailing-list"]) {
    reasons.push("list_headers");
  }
  if (/bulk|list|junk/i.test(headers["precedence"] || "")) reasons.push("precedence_bulk");
  if (/auto-generated|auto-replied|newsletter/i.test(headers["auto-submitted"] || headers["x-auto-response-suppress"] || "")) {
    reasons.push("auto_submitted");
  }
  if (
    /noreply|no-reply|no_reply|donotreply|do-not-reply|mailer-daemon|notifications?@|newsletter@|marketing@|promo@|news@|info@|support@|hello@|team@|updates?@|deals@|offers?@/i.test(
      from,
    )
  ) {
    reasons.push("automated_sender_pattern");
  }
  // Common ESP / platform footprints in From or body footers
  if (
    /mailchimp|sendgrid|constantcontact|klaviyo|hubspot|marketo|pardot|campaign-archive|list-manage|cmail\d+\.|amazonses|postmarkapp|mandrillapp|sparkpost|convertkit|beehiiv|substack|medium\.com|funderpro|somabreath|vesica\.org/i.test(
      `${from} ${body}`,
    )
  ) {
    reasons.push("esp_or_platform");
  }
  if (/unsubscribe|email preferences|view (this|in) browser|manage your preferences|opt[- ]out|one-click unsubscribe/i.test(body)) {
    reasons.push("unsubscribe_language");
  }
  if (
    /% off|limited time|flash sale|free series|daily dose|your daily|available balance|privacy policy update|act now|click here|shop now|claim your|exclusive offer|webinar|course enrollment/i.test(
      `${subject} ${body}`,
    )
  ) {
    reasons.push("promotional_template");
  }
  // Broadcast tone: "I'll show you" / "we'll help you" without addressing a specific person in To
  const to = String(input.to ?? "");
  const addressesOwner = /daniel|coffman|nearmiss/i.test(to);
  if (
    !addressesOwner &&
    /\b(i'll show you|we'll help you|you're going to|click here to|schedule (a|your) free|book a free)\b/i.test(body)
  ) {
    reasons.push("broadcast_sales_copy");
  }

  // Need 2+ independent signals for bulk classification (except hard Gmail category / list headers)
  const hard =
    reasons.includes("gmail_category_bulk") ||
    reasons.includes("list_headers") ||
    reasons.includes("precedence_bulk");
  const bulk = hard || reasons.length >= 2;
  return { bulk, reasons };
}

export type CommitmentActorV1 = "owner" | "other" | "uncertain";

export interface ExtractedCommitmentV1 {
  statement: string;
  actor: CommitmentActorV1;
  /** True only when message appears to be real interpersonal obligation language */
  interpersonal: boolean;
  reason: string;
}

/**
 * Extract interpersonal commitments only.
 * Marketing "I'll show you..." / "We'll help you..." never become Owner obligations.
 */
export function extractInterpersonalCommitments(
  body: string,
  opts: { fromOwnerMailbox?: boolean; marketing?: boolean } = {},
): ExtractedCommitmentV1[] {
  if (opts.marketing) return [];
  const lines = body.split(/\r?\n/);
  const out: ExtractedCommitmentV1[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length < 8 || line.length > 500) continue;

    // Hard reject marketing / CTA / instructional sales copy
    if (
      /\b(i'll show you|i will show you|we'll help you|we will help you|you're going to|you are going to|click here|schedule today|book a free|opt in|sign up|subscribe|limited time|% off)\b/i.test(
        line,
      )
    ) {
      continue;
    }
    if (/\b(unsubscribe|view in browser|email preferences)\b/i.test(line)) continue;

    // Require concrete obligation verbs + a counterparty or concrete deliverable cue
    const hasObligation =
      /\b(i will|i'll|i am going to|i'm going to|we will|we'll|i promise|i can send|i'll send|i will send|i'll call|i will call|i'll email|i will email|follow up with you|get back to you)\b/i.test(
        line,
      ) ||
      /\b(by friday|by monday|by tuesday|by wednesday|by thursday|tomorrow|next week|eod|end of day)\b/i.test(line);

    if (!hasObligation) continue;

    // Prefer lines that address a person, a concrete deliverable, or a dated mutual decision
    const addressesPerson =
      /\b(you|your|daniel|quote|paperwork|contract|invoice|appointment|call you|email you|send you|get you|follow up)\b/i.test(
        line,
      );
    const datedObligation =
      /\b(i will|i'll|we will|we'll)\b/i.test(line) &&
      /\b(by friday|by monday|by tuesday|by wednesday|by thursday|by saturday|by sunday|tomorrow|next week|eod)\b/i.test(
        line,
      );
    if (!addressesPerson && !datedObligation) continue;

    // "Friday is the deadline" alone in promo is not interpersonal
    if (/^\s*friday is the deadline\.?\s*$/i.test(line) && !/\byou\b/i.test(line)) continue;

    let actor: CommitmentActorV1 = "uncertain";
    if (/\b(i will|i'll|i am going to|i'm going to|i promise|i'll send|i will send|i'll call|i will call)\b/i.test(line)) {
      // In received mail, first-person is usually the SENDER (other), not the Owner —
      // unless we know this is Owner-authored (Sent / fromOwnerMailbox).
      actor = opts.fromOwnerMailbox ? "owner" : "other";
    } else if (/\b(we will|we'll)\b/i.test(line)) {
      actor = opts.fromOwnerMailbox ? "owner" : "uncertain";
    }

    out.push({
      statement: line.slice(0, 500),
      actor,
      interpersonal: true,
      reason: opts.fromOwnerMailbox ? "owner_authored_obligation" : "sender_obligation_language",
    });
  }
  return out.slice(0, 20);
}

/** Backward-compatible string extract — filters marketing via extractInterpersonalCommitments. */
export function extractCommitmentsFromBody(body: string): string[] {
  return extractInterpersonalCommitments(body, { marketing: false }).map((c) => c.statement);
}

export type GmailRelevanceV1 =
  | "customer_or_prospect"
  | "business_or_brand"
  | "career_or_job"
  | "commitment_or_admin"
  | "personal"
  | "noise"
  | "unknown";

export type GmailWorkspaceHintV1 = "work" | "personal" | "compassionate-choice" | "unknown";

/**
 * Pre-live staged classification for Gmail messages.
 * Does not create CRM rows — only proposes classes + whether to extract facts.
 * Trust for live mail remains live_connector at service layer.
 */
export function classifyGmailMessage(input: {
  from: string;
  to?: string;
  subject: string;
  snippet?: string;
  bodyText?: string;
  labelIds?: string[];
  headers?: Record<string, string>;
}): {
  relevance: GmailRelevanceV1;
  workspaceHint: GmailWorkspaceHintV1;
  shouldExtractCommitments: boolean;
  shouldProposeContact: boolean;
  contactClass: "CUSTOMER" | "PROSPECT" | "COLLABORATOR" | "VENDOR" | "UNKNOWN";
  reason: string;
  marketingOrBulk: boolean;
} {
  const from = String(input.from ?? "").toLowerCase();
  const subject = String(input.subject ?? "");
  const body = `${input.snippet ?? ""} ${input.bodyText ?? ""}`.slice(0, 4000);
  const blob = `${from} ${subject} ${body}`.toLowerCase();
  const labels = (input.labelIds ?? []).map((l) => l.toLowerCase());
  const bulk = isMarketingOrBulkMail(input);

  if (bulk.bulk) {
    return {
      relevance: "noise",
      workspaceHint: "unknown",
      shouldExtractCommitments: false,
      shouldProposeContact: false,
      contactClass: "UNKNOWN",
      reason: `Marketing/bulk mail (${bulk.reasons.join(",")}) — no CRM/commitment auto-create.`,
      marketingOrBulk: true,
    };
  }

  if (
    /noreply|no-reply|newsletter|unsubscribe|marketing@|promo|notification@|mailer-daemon/i.test(from) ||
    labels.includes("spam") ||
    labels.includes("category_promotions")
  ) {
    return {
      relevance: "noise",
      workspaceHint: "unknown",
      shouldExtractCommitments: false,
      shouldProposeContact: false,
      contactClass: "UNKNOWN",
      reason: "Automated/promotional noise — metadata only.",
      marketingOrBulk: true,
    };
  }

  // Direct interpersonal career thread (not job-board blast)
  if (
    /job|resume|interview|hiring|application|linkedin|indeed|greenhouse|lever\.co/i.test(blob) &&
    !bulk.bulk
  ) {
    const direct =
      /@gmail\.com|@yahoo\.|@outlook\.|@hotmail\.|recruiter@|talent@|careers@/i.test(from) ||
      /\b(interview|phone screen|offer letter|your application for)\b/i.test(blob);
    return {
      relevance: "career_or_job",
      workspaceHint: "personal",
      shouldExtractCommitments: direct,
      shouldProposeContact: false,
      contactClass: "UNKNOWN",
      reason: direct
        ? "Career/job thread — extract commitments only when interpersonal; never auto-CRM customer."
        : "Career-ish language without interpersonal proof — no auto commitment/CRM.",
      marketingOrBulk: false,
    };
  }

  if (/compassionate choice|kristina|kris\.leach|home services|home care|ahca|grant/i.test(blob)) {
    // Collaborator propose only for real human senders (not marketing@)
    const human = !/support@|info@|newsletter@|noreply/i.test(from) && /kris\.leach|@gmail\.com/i.test(from);
    return {
      relevance: "business_or_brand",
      workspaceHint: "compassionate-choice",
      shouldExtractCommitments: human,
      shouldProposeContact: human,
      contactClass: human ? "COLLABORATOR" : "UNKNOWN",
      reason: human
        ? "Business/brand human correspondent — collaborator candidate with email evidence."
        : "Business keyword without interpersonal human sender — no auto CRM.",
      marketingOrBulk: false,
    };
  }

  // Dealership / sales — require vehicle or dealership context, not generic "course/sales" promo
  const dealershipSignal =
    /\b(toyota|dealership|tacoma|highlander|camry|rav4|trade[- ]?in|test drive|inventory|stock #|vin\b|lakeland toyota)\b/i.test(
      blob,
    );
  if (dealershipSignal) {
    // Auto-CRM only when message looks like direct person-to-person (not free course / series)
    const direct =
      !/free series|sacred geometry|course enrollment|webinar/i.test(blob) &&
      (/\b(you|your|appointment|quote|come by|see you|spoke|talked|call me|email me)\b/i.test(blob) ||
        /@gmail\.com|@yahoo\.|@outlook\./i.test(from));
    return {
      relevance: "customer_or_prospect",
      workspaceHint: "work",
      shouldExtractCommitments: direct,
      shouldProposeContact: direct,
      contactClass: direct ? (/invoice|vendor|supplier/i.test(blob) ? "VENDOR" : "PROSPECT") : "UNKNOWN",
      reason: direct
        ? "Dealership interpersonal correspondence — prospect candidate."
        : "Dealership keyword without interpersonal proof — no auto CRM.",
      marketingOrBulk: false,
    };
  }

  if (/\b(i will|i'll|we will|we'll|follow up|deadline|promise|due by|by friday|next week)\b/i.test(blob)) {
    return {
      relevance: "commitment_or_admin",
      workspaceHint: "unknown",
      shouldExtractCommitments: true,
      shouldProposeContact: false,
      contactClass: "UNKNOWN",
      reason: "Possible commitment language — extract only if interpersonal gate passes.",
      marketingOrBulk: false,
    };
  }

  if (labels.includes("category_personal") || /family|personal|birthday/i.test(blob)) {
    return {
      relevance: "personal",
      workspaceHint: "personal",
      shouldExtractCommitments: false,
      shouldProposeContact: false,
      contactClass: "UNKNOWN",
      reason: "Personal category — no CRM auto-create.",
      marketingOrBulk: false,
    };
  }

  return {
    relevance: "unknown",
    workspaceHint: "unknown",
    shouldExtractCommitments: false,
    shouldProposeContact: false,
    contactClass: "UNKNOWN",
    reason: "Insufficient signals — retain searchable metadata only.",
    marketingOrBulk: false,
  };
}

export function createGmailDraftFromFixture(input: {
  to: string;
  subject: string;
  body: string;
  basedOn: string;
}): GmailDraftResultV1 {
  return {
    id: `draft-fixture-${Date.now().toString(36)}`,
    messageId: `msg-fixture-${Date.now().toString(36)}`,
    subject: input.subject.slice(0, 300),
    body: input.body.slice(0, 20_000),
    status: "draft",
    basedOn: input.basedOn.slice(0, 1000),
  };
}

/**
 * Google OAuth authorization URL builder (offline access, gmail.readonly + gmail.compose).
 * Does not open a browser; Owner completes consent when ready.
 */
export function buildGmailAuthUrl(
  config: GmailConnectorConfigV1,
  state: string,
  opts: { includeSend?: boolean } = {},
): string {
  if (!config.clientId) throw new Error("Gmail clientId is required to build auth URL.");
  const scopeList = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
  ];
  // Minimum practical scope for Owner-authorized send (gmail.send)
  if (opts.includeSend) scopeList.push("https://www.googleapis.com/auth/gmail.send");
  const scopes = scopeList.join(" ");
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    prompt: "consent",
    state: state.slice(0, 128),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
