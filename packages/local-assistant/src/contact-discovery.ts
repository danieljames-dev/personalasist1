/**
 * Conservative contact/person candidate discovery from imported document text.
 * Never classifies solely on bare name appearance.
 */
export type ContactClassV1 =
  | "CUSTOMER"
  | "PROSPECT"
  | "COLLABORATOR"
  | "VENDOR"
  | "BUSINESS_CONTACT"
  | "PERSONAL_CONTACT"
  | "UNKNOWN";

export interface ContactCandidateV1 {
  displayName: string;
  class: ContactClassV1;
  organisation: string;
  email: string;
  phone: string;
  role: string;
  workspaceHint: string;
  confidence: number;
  evidence: string[];
  sourcePath: string;
  sourceDocumentId: string;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

const NOISE_EMAIL =
  /noreply|no-reply|example\.|test@|sentry|github|npmjs|w3\.org|schema\.org|googleapis|localhost/i;
const NOISE_PATH = /Claude_Grok|audit_archive|AION-HQ[\\/]docs|aion-smoke|node_modules|\\Temp\\/i;

/** High-value roots only — refuse technical noise trees. */
export function isHighValueContactSourcePath(path: string): boolean {
  const p = String(path ?? "");
  if (NOISE_PATH.test(p)) return false;
  return (
    /Compassionate Choice|kristina|Remote Job Kit|resume|cover.?letter|BUSINESS_STRUCTURE|EXTERNAL-DRIVE|COMPLETE-COMPLIANCE|GRANT|key-deliverables/i.test(
      p,
    ) || /\\\\Documents\\\\|\/Documents\//i.test(p)
  );
}

function normalizeName(n: string): string {
  return n.replace(/\s+/g, " ").trim();
}

function isPlausiblePersonName(n: string): boolean {
  const s = normalizeName(n);
  if (s.length < 3 || s.length > 60) return false;
  if (!/^[A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){0,3}$/.test(s)) return false;
  const stop = /^(Owner|Founder|Manager|Director|Contact|Company|Business|Florida|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|The|This|That|From|Settings|Bizee)$/i;
  if (stop.test(s)) return false;
  if (stop.test(s.split(/\s+/)[0]!)) return false;
  return true;
}

/**
 * Discover contact candidates from a single document's extracted text.
 */
export function discoverContactsInDocument(input: {
  documentId: string;
  filename: string;
  sourceRootPath?: string;
  extractedText?: string;
  summary?: string;
}): ContactCandidateV1[] {
  const sourcePath = `${input.sourceRootPath || ""}/${input.filename}`;
  if (!isHighValueContactSourcePath(sourcePath) && !isHighValueContactSourcePath(input.filename)) {
    return [];
  }
  const text = `${input.summary || ""}\n${input.extractedText || ""}`.slice(0, 50_000);
  if (!text.trim()) return [];

  const emails = [...new Set(text.match(EMAIL_RE) || [])].filter((e) => !NOISE_EMAIL.test(e));
  const phones = [...new Set(text.match(PHONE_RE) || [])].filter((p) => {
    const digits = p.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 11 && !/^(\d)\1+$/.test(digits);
  });

  const out: ContactCandidateV1[] = [];
  const seen = new Set<string>();

  const push = (c: ContactCandidateV1) => {
    const key = `${c.displayName.toLowerCase()}|${c.email.toLowerCase()}|${c.class}`;
    if (seen.has(key)) return;
    if (!isPlausiblePersonName(c.displayName) && !c.email) return;
    if (!isPlausiblePersonName(c.displayName) && c.email) {
      // Derive display from email local-part only if strong org context
      const local = c.email.split("@")[0] || "";
      if (!/[a-z]/i.test(local) || local.length < 3) return;
    }
    seen.add(key);
    out.push(c);
  };

  // Explicit Owner: Name patterns
  const ownerPatterns = [
    /Owner\s*(?:\/\s*founder)?\s*[:\-–]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/gi,
    /Founder\s*[:\-–]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/gi,
    /Owner Full Name\s*[:\-–]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/gi,
  ];
  for (const re of ownerPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = normalizeName(m[1]!);
      if (!isPlausiblePersonName(name)) continue;
      const isCompassionate = /compassionate|kristina/i.test(sourcePath + text.slice(0, 500));
      push({
        displayName: name,
        class: isCompassionate ? "COLLABORATOR" : "BUSINESS_CONTACT",
        organisation: isCompassionate ? "Compassionate Choice LLC" : "",
        email: emails.find((e) => /kris|leach|kristina/i.test(e)) || emails[0] || "",
        phone: phones[0] || "",
        role: /founder/i.test(m[0]) ? "Founder" : "Owner",
        workspaceHint: isCompassionate ? "compassionate-choice" : "personal",
        confidence: 88,
        evidence: [`Explicit role label: ${m[0].slice(0, 80)}`, `source:${input.filename}`],
        sourcePath,
        sourceDocumentId: input.documentId,
      });
    }
  }

  // Resume owner email — Daniel / Owner personal-career contact (not a customer)
  if (/resume|Remote Job Kit|Dan Coffman|Daniel_Coffman/i.test(sourcePath + input.filename)) {
    const ownerEmail = emails.find((e) => /nearmiss|coffman|daniel/i.test(e)) || emails[0];
    if (ownerEmail && /nearmiss|coffman|daniel|dan@/i.test(ownerEmail)) {
      push({
        displayName: "Daniel Coffman",
        class: "PERSONAL_CONTACT",
        organisation: "",
        email: ownerEmail,
        phone: phones[0] || "",
        role: "Owner",
        workspaceHint: "personal",
        confidence: 90,
        evidence: [`Resume contact block`, `source:${input.filename}`],
        sourcePath,
        sourceDocumentId: input.documentId,
      });
    }
  }

  // Kristina email without name pattern
  for (const email of emails) {
    if (/kris\.leach|kristina/i.test(email)) {
      push({
        displayName: "Kristina Leach",
        class: "COLLABORATOR",
        organisation: "Compassionate Choice LLC",
        email,
        phone: phones.find((p) => /863/.test(p)) || phones[0] || "",
        role: "Founder / Owner",
        workspaceHint: "compassionate-choice",
        confidence: 86,
        evidence: [`Email ${email} in business docs`, `source:${input.filename}`],
        sourcePath,
        sourceDocumentId: input.documentId,
      });
    }
  }

  return out.slice(0, 20);
}

export function mergeContactCandidates(list: ContactCandidateV1[]): ContactCandidateV1[] {
  const byKey = new Map<string, ContactCandidateV1>();
  for (const c of list) {
    const key = c.email
      ? `email:${c.email.toLowerCase()}`
      : `name:${c.displayName.toLowerCase()}|${c.organisation.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...c, evidence: [...c.evidence] });
      continue;
    }
    // Merge evidence; prefer higher confidence and non-empty fields
    prev.confidence = Math.max(prev.confidence, c.confidence);
    prev.evidence = [...new Set([...prev.evidence, ...c.evidence])].slice(0, 12);
    if (!prev.phone && c.phone) prev.phone = c.phone;
    if (!prev.email && c.email) prev.email = c.email;
    if (!prev.organisation && c.organisation) prev.organisation = c.organisation;
    if (!prev.role && c.role) prev.role = c.role;
    if (c.confidence >= prev.confidence) prev.class = c.class;
  }
  return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
}

/** Map external funnel labels onto RelationshipLifecycleV1. */
export function mapFunnelStageToLifecycle(stage: string): string {
  const s = String(stage || "").toUpperCase().replace(/\s+/g, "_");
  const map: Record<string, string> = {
    NEW_LEAD: "prospect",
    LEAD: "prospect",
    CONTACTED: "contacted",
    ENGAGED: "engaged",
    APPOINTMENT: "appointment-set",
    SHOWROOM: "appointment-shown",
    TEST_DRIVE: "appointment-shown",
    NEGOTIATING: "negotiating",
    SOLD: "sold",
    LOST: "lost",
    FOLLOW_UP: "follow-up",
  };
  return map[s] || String(stage || "prospect").toLowerCase();
}
