/**
 * Bounds that a flooding executor used to blow through, and redaction a silent drop would hide.
 *
 * Each size bound is asserted one byte under, exactly at, and one byte over. A test that only
 * checks "large input gets smaller" stays green while the marker lies about how many bytes
 * were lost, or while the head is kept and the tail — the failure — is what goes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createBoundedLog,
  createFixedClock,
  createMemoryLogSink,
  FILE_LOG_BYTES,
  LIVE_TAIL_BYTES,
  RUN_LOG_BYTES,
  redactLogText,
  truncationMarker,
  type BoundedLogV1,
  type MemoryLogSinkV1,
} from "../src/bounded-log.js";

const NOW = "2026-08-13T12:00:00.000Z";

function logger(): {
  log: BoundedLogV1;
  stdout: MemoryLogSinkV1;
  stderr: MemoryLogSinkV1;
} {
  const stdout = createMemoryLogSink();
  const stderr = createMemoryLogSink();
  const log = createBoundedLog({
    clock: createFixedClock(NOW),
    sinks: { stdout, stderr },
  });
  return { log, stdout, stderr };
}

/** 0x78 is not a secret-starter prefix, so a bound flood is not held back one byte. */
function fill(bytes: number, code = 0x78): Buffer {
  return Buffer.alloc(bytes, code);
}

// ---------------------------------------------------------------------------
// Live tail: 256 KiB, one under / exactly / one over
// ---------------------------------------------------------------------------

test("live tail one byte under the bound is kept in full with no marker", () => {
  const { log } = logger();
  log.write("stdout", fill(LIVE_TAIL_BYTES - 1));
  const report = log.report();
  assert.equal(report.stdout.liveTruncated, false);
  assert.equal(report.stdout.droppedLiveBytes, 0);
  assert.equal(log.liveTail("stdout").length, LIVE_TAIL_BYTES - 1);
  assert.equal(log.liveTail("stdout").includes(Buffer.from("AION_LOG_TRUNCATED")), false);
});

test("live tail exactly at the bound is kept in full with no marker", () => {
  const { log } = logger();
  log.write("stdout", fill(LIVE_TAIL_BYTES));
  const report = log.report();
  assert.equal(report.stdout.liveTruncated, false);
  assert.equal(report.stdout.droppedLiveBytes, 0);
  assert.equal(log.liveTail("stdout").length, LIVE_TAIL_BYTES);
  assert.equal(log.liveTail("stdout").includes(Buffer.from("AION_LOG_TRUNCATED")), false);
});

test("live tail one byte over the bound drops the head, keeps the tail, and names the lost byte", () => {
  const { log } = logger();
  log.write("stdout", Buffer.concat([fill(LIVE_TAIL_BYTES), Buffer.from("Z")]));
  const report = log.report();
  assert.equal(report.stdout.liveTruncated, true);
  assert.equal(report.stdout.droppedLiveBytes, 1);
  assert.equal(report.stdout.truncatedAt, NOW);

  const live = log.liveTail("stdout");
  const marker = Buffer.from(truncationMarker(1));
  assert.deepEqual(live.subarray(0, marker.length), marker);
  const payload = live.subarray(marker.length);
  assert.equal(payload.length, LIVE_TAIL_BYTES);
  assert.equal(payload[0], 0x78);
  assert.equal(payload[payload.length - 1], 0x5a);
});

test("when the live tail is truncated the head is what goes and the tail is what remains", () => {
  const { log } = logger();
  const head = Buffer.from("HEAD-UNIQUE-MARKER");
  const tail = Buffer.from("TAIL-UNIQUE-MARKER");
  const mid = fill(LIVE_TAIL_BYTES - tail.length);
  log.write("stdout", Buffer.concat([head, mid, tail]));

  const live = log.liveTail("stdout").toString("utf8");
  assert.equal(live.includes("HEAD-UNIQUE-MARKER"), false, "the head is what was dropped");
  assert.equal(live.includes("TAIL-UNIQUE-MARKER"), true, "the tail is what a debugger needs");
  assert.equal(log.report().stdout.droppedLiveBytes, head.length);
  assert.match(live, new RegExp(`dropped=${head.length}`));
});

// ---------------------------------------------------------------------------
// Per-file: 8 MiB, one under / exactly / one over
// ---------------------------------------------------------------------------

test("file log one byte under the bound is appended in full with no marker", () => {
  const { log, stdout } = logger();
  log.write("stdout", fill(FILE_LOG_BYTES - 1));
  const report = log.report();
  assert.equal(report.stdout.fileTruncated, false);
  assert.equal(report.stdout.droppedFileBytes, 0);
  assert.equal(stdout.contents().length, FILE_LOG_BYTES - 1);
  assert.equal(stdout.contents().includes(Buffer.from("AION_LOG_TRUNCATED")), false);
  assert.deepEqual(stdout.contents(), log.fileImage("stdout"));
});

test("file log exactly at the bound is appended in full with no marker", () => {
  const { log, stdout } = logger();
  log.write("stdout", fill(FILE_LOG_BYTES));
  const report = log.report();
  assert.equal(report.stdout.fileTruncated, false);
  assert.equal(report.stdout.droppedFileBytes, 0);
  assert.equal(stdout.contents().length, FILE_LOG_BYTES);
  assert.equal(stdout.contents().includes(Buffer.from("AION_LOG_TRUNCATED")), false);
});

test("file log one byte over the bound replaces the sink with marker plus tail", () => {
  const { log, stdout } = logger();
  log.write("stdout", Buffer.concat([fill(FILE_LOG_BYTES), Buffer.from("Z")]));
  const report = log.report();
  assert.equal(report.stdout.fileTruncated, true);
  assert.equal(report.stdout.droppedFileBytes, 1);
  assert.equal(report.mustHalt, false, "8 MiB + 1 is under the 16 MiB run bound");

  const image = stdout.contents();
  const marker = Buffer.from(truncationMarker(1));
  assert.deepEqual(image.subarray(0, marker.length), marker);
  const payload = image.subarray(marker.length);
  assert.equal(payload.length, FILE_LOG_BYTES);
  assert.equal(payload[payload.length - 1], 0x5a);
  assert.deepEqual(image, log.fileImage("stdout"));
});

test("when the file bound is exceeded the head is dropped and the tail is what the sink holds", () => {
  const { log, stdout } = logger();
  const head = Buffer.from("FILE-HEAD-UNIQUE");
  const tail = Buffer.from("FILE-TAIL-UNIQUE");
  const mid = fill(FILE_LOG_BYTES - tail.length, 0x63);
  log.write("stdout", Buffer.concat([head, mid, tail]));

  const text = stdout.contents().toString("utf8");
  assert.equal(text.includes("FILE-HEAD-UNIQUE"), false);
  assert.equal(text.includes("FILE-TAIL-UNIQUE"), true);
  assert.equal(log.report().stdout.droppedFileBytes, head.length);
  assert.match(text, new RegExp(`dropped=${head.length}`));
});

// ---------------------------------------------------------------------------
// Per-run: 16 MiB across both streams, then halt
// ---------------------------------------------------------------------------

test("run log one byte under the bound does not halt", () => {
  const { log } = logger();
  log.write("stdout", fill(RUN_LOG_BYTES - 1, 0x64));
  const report = log.report();
  assert.equal(report.runBytesIn, RUN_LOG_BYTES - 1);
  assert.equal(report.mustHalt, false);
  assert.equal(report.haltReason, null);
  assert.equal(report.haltedAt, null);
});

test("run log exactly at the bound does not halt", () => {
  const { log } = logger();
  log.write("stdout", fill(FILE_LOG_BYTES, 0x64));
  log.write("stderr", fill(FILE_LOG_BYTES, 0x65));
  const report = log.report();
  assert.equal(report.runBytesIn, RUN_LOG_BYTES);
  assert.equal(report.mustHalt, false);
  assert.equal(report.haltReason, null);
});

test("run log one byte over the bound reports that the executor must be halted and killed", () => {
  const { log } = logger();
  log.write("stdout", fill(FILE_LOG_BYTES, 0x64));
  log.write("stderr", fill(FILE_LOG_BYTES, 0x65));
  const result = log.write("stdout", Buffer.from("X"));
  assert.equal(result.mustHalt, true);
  assert.match(result.haltReason ?? "", /must be halted and the process killed/);
  const report = log.report();
  assert.equal(report.runBytesIn, RUN_LOG_BYTES + 1);
  assert.equal(report.mustHalt, true);
  assert.equal(report.haltedAt, NOW);
  assert.match(report.haltReason ?? "", /16777216/);
});

test("the clock stamp on halt and truncation is the injected instant, not the wall clock", () => {
  const { log } = logger();
  log.write("stdout", fill(LIVE_TAIL_BYTES + 1));
  assert.equal(log.report().stdout.truncatedAt, NOW);
  assert.equal(log.report().lastWriteAt, NOW);
});

// ---------------------------------------------------------------------------
// Redaction: each shape, surrounding context survives
// ---------------------------------------------------------------------------

test("a Bearer token is redacted and the rest of the line survives", () => {
  const { log } = logger();
  log.write("stdout", "retry Bearer tok_live_debug_value leftover=1\n");
  const text = log.liveTail("stdout").toString("utf8");
  assert.equal(text.includes("tok_live_debug_value"), false);
  assert.match(text, /retry Bearer \[REDACTED\] leftover=1/);
});

test("an Authorization header value is redacted and the rest of the line survives", () => {
  const { log } = logger();
  log.write("stdout", "hdr Authorization: Bearer tok_hdr_secret_xx debug=yes\n");
  const text = log.liveTail("stdout").toString("utf8");
  assert.equal(text.includes("tok_hdr_secret_xx"), false);
  assert.match(text, /hdr Authorization: Bearer \[REDACTED\] debug=yes/);
});

test("non-Bearer Authorization schemes redact the credential, not only the scheme word", () => {
  const cases: ReadonlyArray<{ line: string; leaked: string }> = [
    { line: "Authorization: Basic dXNlcjpodW50ZXIyLXByb2Q=\n", leaked: "dXNlcjpodW50ZXIyLXByb2Q=" },
    { line: "Proxy-Authorization: Basic dXNlcjpodW50ZXIyLXByb2Q=\n", leaked: "dXNlcjpodW50ZXIyLXByb2Q=" },
    { line: "authorization: basic dXNlcjpodW50ZXIyLXByb2Q=\n", leaked: "dXNlcjpodW50ZXIyLXByb2Q=" },
    { line: "Authorization: Token tok_hdr_secret_xx\n", leaked: "tok_hdr_secret_xx" },
  ];
  for (const item of cases) {
    const { log, stdout } = logger();
    log.write("stdout", item.line);
    log.flush();
    const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}`;
    assert.equal(text.includes(item.leaked), false, item.line);
    assert.match(text, /\[REDACTED\]/);
  }
});

test("a ghp_ token is redacted and the rest of the line survives", () => {
  const { log } = logger();
  log.write("stdout", "clone ghp_abcdefghijklmnopqrstuvwxyz012345 extra\n");
  const text = log.liveTail("stdout").toString("utf8");
  assert.equal(text.includes("ghp_abcdefghijklmnopqrstuvwxyz012345"), false);
  assert.match(text, /clone \[REDACTED\] extra/);
});

test("a github_pat_ token is redacted and the rest of the line survives", () => {
  const { log } = logger();
  log.write("stdout", "auth github_pat_11AAAAAAA_abcdefghijklmnopqrstuvwxyz extra\n");
  const text = log.liveTail("stdout").toString("utf8");
  assert.equal(text.includes("github_pat_11AAAAAAA_abcdefghijklmnopqrstuvwxyz"), false);
  assert.match(text, /auth \[REDACTED\] extra/);
});

test("an sk- API key is redacted and the rest of the line survives", () => {
  const { log } = logger();
  log.write("stdout", "key sk-abcdefghijklmnopqrstuvwxyz extra\n");
  const text = log.liveTail("stdout").toString("utf8");
  assert.equal(text.includes("sk-abcdefghijklmnopqrstuvwxyz"), false);
  assert.match(text, /key \[REDACTED\] extra/);
});

test("an AWS access key id is redacted and the rest of the line survives", () => {
  const { log } = logger();
  log.write("stdout", "id AKIAIOSFODNN7EXAMPLE extra\n");
  const text = log.liveTail("stdout").toString("utf8");
  assert.equal(text.includes("AKIAIOSFODNN7EXAMPLE"), false);
  assert.match(text, /id \[REDACTED\] extra/);
});

test("a private key block is redacted and the surrounding lines survive", () => {
  const { log } = logger();
  log.write(
    "stdout",
    [
      "before",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKFAKESECRETBLOCK",
      "-----END RSA PRIVATE KEY-----",
      "after",
      "",
    ].join("\n"),
  );
  const text = log.liveTail("stdout").toString("utf8");
  assert.equal(text.includes("MIIEowIBAAKFAKESECRETBLOCK"), false);
  assert.match(text, /before/);
  assert.match(text, /after/);
  assert.match(text, /-----BEGIN RSA PRIVATE KEY-----\n\[REDACTED\]\n-----END RSA PRIVATE KEY-----/);
});

// ---------------------------------------------------------------------------
// Secrets split across two writes
// ---------------------------------------------------------------------------

test("a ghp_ token split across two writes is still redacted", () => {
  const { log } = logger();
  log.write("stdout", "clone ghp_");
  log.write("stdout", "abcdefghijklmnopqrstuvwxyz012345 extra\n");
  const text = log.liveTail("stdout").toString("utf8");
  assert.equal(text.includes("ghp_abcdefghijklmnopqrstuvwxyz012345"), false);
  assert.equal(text.includes("abcdefghijklmnopqrstuvwxyz012345"), false);
  assert.match(text, /clone \[REDACTED\] extra/);
});

test("an Authorization header split across two writes is still redacted", () => {
  const { log } = logger();
  log.write("stdout", "hdr Authorization: Bearer ");
  log.write("stdout", "tok_split_secret_xx leftover=1\n");
  const text = log.liveTail("stdout").toString("utf8");
  assert.equal(text.includes("tok_split_secret_xx"), false);
  assert.match(text, /hdr Authorization: Bearer \[REDACTED\] leftover=1/);
});

test("a private key block split across two writes is still redacted", () => {
  const { log } = logger();
  log.write("stdout", "before\n-----BEGIN RSA PRIVATE KEY-----\nMIIE-PART-ONE");
  log.write("stdout", "MIIE-PART-TWO\n-----END RSA PRIVATE KEY-----\nafter\n");
  const text = log.liveTail("stdout").toString("utf8");
  assert.equal(text.includes("MIIE-PART-ONE"), false);
  assert.equal(text.includes("MIIE-PART-TWO"), false);
  assert.match(text, /before/);
  assert.match(text, /after/);
  assert.match(text, /\[REDACTED\]/);
});

test("every split point of each secret shape redacts the raw token", () => {
  const pem = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEowIBAAKCAQEA_THIS_IS_THE_PRIVATE_KEY_MATERIAL_9911",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n");
  const secrets: ReadonlyArray<{ line: string; token: string }> = [
    { line: "clone ghp_abcdefghijklmnopqrstuvwxyz012345 extra\n", token: "ghp_abcdefghijklmnopqrstuvwxyz012345" },
    { line: "key: sk-abcdefghijklmnopqrstuvwxyz012345\n", token: "sk-abcdefghijklmnopqrstuvwxyz012345" },
    { line: "aws=AKIAIOSFODNN7EXAMPLE extra\n", token: "AKIAIOSFODNN7EXAMPLE" },
    { line: "pat=github_pat_abcdefghijklmnopqrstuvwxyz extra\n", token: "github_pat_abcdefghijklmnopqrstuvwxyz" },
    { line: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig\n", token: "eyJhbGciOiJIUzI1NiJ9.payload.sig" },
    { line: `before\n${pem}\nafter\n`, token: "MIIEowIBAAKCAQEA_THIS_IS_THE_PRIVATE_KEY_MATERIAL_9911" },
  ];
  for (const secret of secrets) {
    for (let cut = 0; cut <= secret.line.length; cut += 1) {
      const { log, stdout } = logger();
      log.write("stdout", secret.line.slice(0, cut));
      log.write("stdout", secret.line.slice(cut));
      log.flush();
      const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}`;
      assert.equal(
        text.includes(secret.token),
        false,
        `token leaked at cut=${cut} for ${secret.token.slice(0, 12)}…: ${text}`,
      );
    }
  }
});

test("a 358-char bearer token is redacted at overflow cut points", () => {
  const token = `eyJ${"A".repeat(200)}.${"B".repeat(80)}.${"C".repeat(56)}rEaLsIgNaTuRe9911`;
  assert.equal(token.length, 358);
  const line = `calling api\nAuthorization: Bearer ${token}\n`;
  for (const cut of [60, 120, 150, 160, 200, 260, 300]) {
    const { log, stdout } = logger();
    log.write("stdout", line.slice(0, cut));
    log.write("stdout", line.slice(cut));
    log.flush();
    const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}`;
    assert.equal(text.includes(token), false, `358-char token leaked at cut=${cut}`);
    assert.equal(text.includes("rEaLsIgNaTuRe9911"), false, `signature leaked at cut=${cut}`);
    assert.match(text, /\[REDACTED\]/);
  }
});

test("a 1 MiB non-secret flood still completes promptly", () => {
  const { log } = logger();
  const started = Date.now();
  const chunk = "the quick brown fox jumps over the lazy dog\n";
  let written = 0;
  while (written < 1024 * 1024) {
    log.write("stdout", chunk);
    written += chunk.length;
  }
  log.flush();
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 15_000, `1 MiB flood took ${elapsed}ms`);
  assert.ok(log.liveTail("stdout").length > 0);
});

test("an unterminated key is not released when a later BEGIN arrives", () => {
  const { log, stdout } = logger();
  log.write("stdout", "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA_SECRET_BODY\n");
  log.write("stdout", "-----BEGIN CERTIFICATE-----\n");
  const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}`;
  assert.equal(text.includes("MIIEowIBAAKCAQEA_SECRET_BODY"), false);
});

test("a mismatched PRIVATE KEY end label still redacts the body", () => {
  const block = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEowIBAAKCAQEA_SECRET_BODY_LINE_1",
    "SECRET_BODY_LINE_2",
    "-----END PRIVATE KEY-----",
    "",
  ].join("\n");
  const { log, stdout } = logger();
  log.write("stdout", block);
  const text = `${log.liveTail("stdout").toString("utf8")}\n${stdout.contents().toString("utf8")}`;
  assert.equal(text.includes("MIIEowIBAAKCAQEA_SECRET_BODY_LINE_1"), false);
  assert.equal(redactLogText(block).includes("MIIEowIBAAKCAQEA_SECRET_BODY_LINE_1"), false);
});
