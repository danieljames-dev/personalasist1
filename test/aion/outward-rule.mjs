/**
 * The outward call-site rule, defined once.
 *
 * `test/aion/outward-activation.test.mjs` enforces it and `.aion-local/discovery/campaign-02-runner.mjs`
 * probes it. Campaign 02 originally re-extracted the rule out of the test file with regexes so that
 * it could not be measuring a paraphrase; a shared module is the same guarantee without the
 * fragility, and it means a change to the rule reaches the campaign the moment it is made.
 *
 * This file lives under `test/` and is therefore not itself runtime code — `isRuntimeCandidate`
 * below excludes it, as it excludes every test.
 */

import { execFileSync } from "node:child_process";

/** Tracked *and* untracked-but-not-ignored: a new runtime file is checked before it is staged. */
export function repositoryFiles(repositoryRoot) {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repositoryRoot, maxBuffer: 64 * 1024 * 1024, encoding: "utf8",
  });
  return [...new Set(listed.split(/\r?\n/u).filter(Boolean))];
}

/** Join a repository-relative directory with a relative specifier, in git's own path style. */
export function posixJoin(base, specifier) {
  const parts = base === "." ? [] : base.split("/");
  for (const piece of specifier.split("/")) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") parts.pop();
    else parts.push(piece);
  }
  return parts.join("/");
}

export const CODE_FILE = /\.(mjs|cjs|js|ts)$/u;

/**
 * Which files can execute AION functionality.
 *
 * Deliberately not "files that currently make a network call". A file with no outward call today is
 * exactly where tomorrow's one gets written, and the previous rule's whole failure was scoping
 * itself to where the calls already were.
 */
export function isRuntimeCandidate(file) {
  if (!CODE_FILE.test(file) || file.endsWith(".d.ts")) return false;
  if (/(^|\/)test\//u.test(file) || /\.test\./u.test(file)) return false;      // tests
  if (/(^|\/)(dist|dist-test|node_modules|fixtures)\//u.test(file)) return false; // generated / fixtures
  return file.startsWith("apps/") || /^packages\/[^/]+\/src\//u.test(file) || file.startsWith("scripts/");
}

/**
 * Blank comments, and optionally string bodies, preserving every byte offset.
 *
 * Not a parser, and deliberately not one — §9 of this milestone rules out building a taint
 * analyser. It exists because this repository discusses `fetch` in dozens of comments, and a rule
 * that fires on prose gets exceptions bolted onto it until it means nothing.
 */
export function blankNonCode(source, { keepStrings = false } = {}) {
  const out = source.split("");
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  const REGEX_PRECEDING = new Set(["=", "(", ",", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^", "\n", "\r"]);
  let i = 0;
  let lastSignificant = "\n";
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      let j = i;
      while (j < source.length && source[j] !== "\n") j++;
      blank(i, j); i = j; continue;
    }
    if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < source.length && !(source[j] === "*" && source[j + 1] === "/")) j++;
      blank(i, Math.min(j + 2, source.length)); i = j + 2; continue;
    }
    if (c === "/" && REGEX_PRECEDING.has(lastSignificant)) {
      // A regex literal, skipped whole so that /\/\*/ cannot look like a block comment.
      let j = i + 1; let inClass = false;
      while (j < source.length) {
        const d = source[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        else if (d === "\n") break;
        j++;
      }
      if (source[j] === "/") {
        if (!keepStrings) blank(i + 1, j);
        i = j + 1; lastSignificant = "/"; continue;
      }
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === c || source[j] === "\n") break;
        j++;
      }
      if (!keepStrings) blank(i + 1, j);
      i = j + 1; lastSignificant = c; continue;
    }
    if (c === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === "`") break;
        if (source[j] === "$" && source[j + 1] === "{") {
          let depth = 1; let k = j + 2;
          while (k < source.length && depth > 0) {
            if (source[k] === "{") depth++;
            else if (source[k] === "}") depth--;
            k++;
          }
          j = k; continue;      // an interpolation is real code; leave it alone
        }
        if (!keepStrings && source[j] !== "\n" && source[j] !== "\r") out[j] = " ";
        j++;
      }
      i = j + 1; lastSignificant = "`"; continue;
    }
    if (!/\s/u.test(c)) lastSignificant = c;
    i++;
  }
  return out.join("");
}

/**
 * The primitives a runtime file may not name.
 *
 * The `fetch` rule matches the *identifier*, not the call. `const send = globalThis.fetch; send(u)`
 * was Campaign 02's stated alias case, and a rule written as `fetch\s*\(` misses it, misses
 * `[fetch]`, misses `f(fetch)`, and misses `const { fetch } = globalThis`. Matching the name covers
 * every way of getting hold of the function, which is the thing that matters.
 */
export const NETWORK_PRIMITIVES_V1 = [
  { id: "globalThis.fetch", re: /globalThis\s*\.\s*fetch/gu, strings: false },
  {
    id: "fetch", re: /(?<![.\w$])fetch\b/gu, strings: false,
    // `typeof fetch` is a type position. It cannot execute, and forbidding it would only push
    // connectors to re-declare the same shape by hand.
    ignore: (source, index) => source.slice(Math.max(0, index - 7), index) === "typeof ",
  },
  { id: "node network module", re: /["']node:(https?|net|tls|dgram)["']/gu, strings: true },
  { id: "WebSocket", re: /(?<![.\w$])WebSocket\b/gu, strings: false },
  { id: "EventSource", re: /(?<![.\w$])EventSource\b/gu, strings: false },
  { id: "XMLHttpRequest", re: /(?<![.\w$])XMLHttpRequest\b/gu, strings: false },
  { id: "sendBeacon", re: /\bsendBeacon\b/gu, strings: false },
];

/** Every primitive named in one file, with the line it is on. */
export function primitivesIn(source) {
  const code = blankNonCode(source);
  const codeWithStrings = blankNonCode(source, { keepStrings: true });
  const hits = [];
  for (const rule of NETWORK_PRIMITIVES_V1) {
    const text = rule.strings ? codeWithStrings : code;
    rule.re.lastIndex = 0;
    let match;
    while ((match = rule.re.exec(text)) !== null) {
      if (rule.ignore?.(text, match.index)) continue;
      hits.push({ id: rule.id, line: text.slice(0, match.index).split("\n").length });
    }
  }
  return hits;
}

/*
 * The policy. Every entry is an exemption from the rule above, and every exemption carries the
 * reason it is one — because "it was on the list" is what the previous rule said about the five
 * files it read, and nobody could tell from the list why those five and not the rest.
 */
export const OUTWARD_POLICY_V1 = {
  /*
   * The only module permitted to hold a real transport — one file, for the whole repository.
   *
   * It was briefly two. `packages/local-assistant/src/outward-transport.ts` was going to keep a
   * loopback fetch, until the assistant package's own architecture test objected that its source
   * contains no network implementation. That invariant was right and older than this milestone, so
   * the loopback call moved to the application as a port the application fills. Allowances are
   * exact rather than minimums: an adapter that grows a third transport fails here.
   */
  APPROVED_ADAPTER: {
    "apps/aion/outward-effect-guard.mjs": {
      allow: { "globalThis.fetch": 2, fetch: 0 },
      reason: "the application's outward boundary: outwardFetch and loopbackFetch are the two transports",
    },
  },
  /** Inbound listeners. Enforced below: the import clause may not name a client binding. */
  INBOUND_SERVER: {
    "apps/aion/server.mjs": { module: "node:http", reason: "createServer for the loopback Command Center" },
    "packages/delegated-operator/src/owner-ui.ts": { module: "node:http", reason: "createServer for the local Owner UI" },
    "packages/delegated-operator/src/pipe-server.ts": { module: "node:net", reason: "createServer for a local named pipe" },
  },
  /** Browser code served from this machine over loopback. Same-origin by CSP and by call site. */
  BROWSER_SAME_ORIGIN: {
    "apps/aion/public/app.js": { reason: "the Command Center page; every call is a relative same-origin path" },
    "apps/aion/public/sw.js": { reason: "service worker; passes the browser's own Request through" },
  },
  /** Demonstrations that drive a server this machine started. */
  DEMO_ONLY: {
    "apps/aion-demo.mjs": { reason: "scripted walkthrough against a loopback server it starts itself" },
    "apps/aion-sales-demo.mjs": { reason: "scripted walkthrough against a loopback server it starts itself" },
    "apps/aion-v12-demo.mjs": { reason: "scripted walkthrough against a loopback server it starts itself" },
    "apps/aion-v13-demo.mjs": { reason: "scripted walkthrough against a loopback server it starts itself" },
    "apps/aion-v13-r1-demo.mjs": { reason: "scripted walkthrough against a loopback server it starts itself" },
  },
  /** Operator tooling that talks to a locally running AION. */
  OPERATOR_LOOPBACK: {
    "scripts/r65.1/installed-instance-proof.mjs": { reason: "proves an installed instance answers on 127.0.0.1 and a local named pipe" },
    "scripts/r65.1/r652-live-proof.mjs": { reason: "proves an installed instance answers on 127.0.0.1 and a local named pipe" },
    "scripts/r70/e2e-production-demo.mjs": { reason: "drives a locally running Command Center on 127.0.0.1:31415" },
    "scripts/r70/gmail-phase2-assimilate.mjs": { reason: "drives a locally running Command Center on 127.0.0.1:31415" },
    "scripts/r70/phase3-daily-use-scenario.mjs": { reason: "drives a locally running Command Center on 127.0.0.1:31415" },
    "scripts/r70/pilot-day-start.mjs": { reason: "drives a locally running Command Center on 127.0.0.1:31415" },
    "scripts/r70/production-soak.mjs": { reason: "drives a locally running Command Center on 127.0.0.1:31415" },
    "scripts/r70/smoke-bulk-phone.mjs": { reason: "drives a locally running Command Center on 127.0.0.1:31415" },
  },
  /*
   * Operator tooling that genuinely reaches the public web.
   *
   * These are not classified as harmless. They are hand-run research scripts that predate the
   * outward boundary, they are not reachable from any runtime module — a test below proves that —
   * and Discovery Campaign 02 recorded them as intentional and non-runtime. They stay listed here
   * rather than excluded by a `scripts/**` wildcard so that the exemption is visible and so that
   * adding a twelfth one is a decision somebody has to write down.
   */
  OPERATOR_PUBLIC_WEB: {
    "scripts/inventory-expand.mjs": { reason: "hand-run dealer inventory measurement against public pages; never imported by runtime code" },
    "scripts/r70/probe-inventory.mjs": { reason: "one-shot probe of public dealer inventory pages; never imported by runtime code" },
    "scripts/r70/probe-inventory-fields.mjs": { reason: "one-shot probe of public dealer inventory pages; never imported by runtime code" },
  },
};

export const CLASSIFIED_V1 = new Map();
for (const [klass, entries] of Object.entries(OUTWARD_POLICY_V1)) {
  for (const [file, detail] of Object.entries(entries)) CLASSIFIED_V1.set(file, { klass, ...detail });
}
