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

export function extractCommitmentsFromBody(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const hits: string[] = [];
  for (const line of lines) {
    if (/\b(i will|we will|i'll|we'll|follow up|by friday|next week|deadline|promise)\b/i.test(line)) {
      hits.push(line.trim().slice(0, 500));
    }
  }
  return hits.slice(0, 20);
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
