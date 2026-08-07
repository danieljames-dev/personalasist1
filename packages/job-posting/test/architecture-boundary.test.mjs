import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");
const execFileAsync = promisify(execFile);

async function files(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else output.push(path);
  }
  return output;
}

async function pathSignature(path, statPath = stat) {
  try {
    const state = await statPath(path);
    return { exists: true, size: state.size, modified: state.mtimeMs };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
}

test("Job Posting production dependencies remain inside the accepted Phase 8 boundary", async () => {
  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), [
    "@aion/career-evidence", "@aion/career-input", "@aion/identity", "@aion/object", "@aion/privacy-boundary",
  ]);
  const source = (await Promise.all((await files(join(packageRoot, "src"))).map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(source, /node:(?:http|https|net|tls|dns)|fetch\s*\(|XMLHttpRequest|WebSocket|puppeteer|playwright/i);
  assert.doesNotMatch(source, /openai|anthropic|embedding|vector.?store|telemetry|analytics|database|postgres|sqlite/i);
});

test("public API exposes import only and contains no matching, scoring, ranking, or drafting behavior", async () => {
  const api = await readFile(join(packageRoot, "src", "index.ts"), "utf8");
  assert.match(api, /dryRunJobPostingImportV1/);
  assert.match(api, /importJobPostingV1/);
  assert.doesNotMatch(api, /match(?:ing)?|score|rank|draft|application/i);
});

test("production source performs no scanning, copy, Identity write, Relationship write, or automatic import", async () => {
  const sourceFiles = await files(join(packageRoot, "src"));
  const source = (await Promise.all(sourceFiles.map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(source, /readdir|glob|walkDirectory|copyFile|writeFile|mkdir|IdentityStateRepository|createRelationshipObject/i);
  assert.doesNotMatch(source, /Desktop|Documents|Downloads|assistant.?archive|Gmail|LinkedIn|job.?board/i);
});

test("an absent private root is valid and only ENOENT is accepted as absence", async (t) => {
  const cleanRoot = await mkdtemp(join(tmpdir(), "aion-job-posting-clean-root-"));
  t.after(() => rm(cleanRoot, { recursive: true, force: true }));
  const privateRoot = join(cleanRoot, "private");

  assert.deepEqual(await pathSignature(privateRoot), { exists: false });

  for (const code of ["EACCES", "EIO", "EINVAL"]) {
    const unexpected = Object.assign(new Error(`synthetic ${code}`), { code });
    await assert.rejects(
      pathSignature(privateRoot, async () => { throw unexpected; }),
      (error) => error === unexpected,
    );
  }
  assert.deepEqual(await pathSignature(privateRoot), { exists: false });
});

test("an existing synthetic private root stays ignored, unstaged, and outside the source backup tree", async (t) => {
  const syntheticRoot = await mkdtemp(join(tmpdir(), "aion-job-posting-private-root-"));
  t.after(() => rm(syntheticRoot, { recursive: true, force: true }));
  const privateFile = "private/job-posting/incoming/synthetic.txt";
  const localFile = ".aion-local/handoffs/synthetic.md";

  await writeFile(join(syntheticRoot, ".gitignore"), await readFile(join(repositoryRoot, ".gitignore"), "utf8"), "utf8");
  await writeFile(join(syntheticRoot, "tracked.txt"), "synthetic tracked source\n", "utf8");
  await mkdir(dirname(join(syntheticRoot, privateFile)), { recursive: true });
  await writeFile(join(syntheticRoot, privateFile), "synthetic private boundary\n", "utf8");
  await mkdir(dirname(join(syntheticRoot, localFile)), { recursive: true });
  await writeFile(join(syntheticRoot, localFile), "synthetic local control state\n", "utf8");

  await execFileAsync("git", ["init", "-b", "main"], { cwd: syntheticRoot });
  await execFileAsync("git", ["config", "user.name", "AION Job Posting Test"], { cwd: syntheticRoot });
  await execFileAsync("git", ["config", "user.email", "job-posting-test@invalid.example"], { cwd: syntheticRoot });
  await execFileAsync("git", ["add", ".gitignore", "tracked.txt"], { cwd: syntheticRoot });
  await execFileAsync("git", ["commit", "-m", "synthetic tracked baseline"], { cwd: syntheticRoot });

  const ignored = await execFileAsync("git", ["check-ignore", "--no-index", privateFile, localFile], { cwd: syntheticRoot });
  assert.deepEqual(ignored.stdout.trim().split(/\r?\n/).sort(), [localFile, privateFile].sort());
  const status = await execFileAsync("git", ["status", "--porcelain=v1", "-uall"], { cwd: syntheticRoot });
  assert.equal(status.stdout, "");
  const sourceTree = await execFileAsync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: syntheticRoot });
  assert.deepEqual(sourceTree.stdout.trim().split(/\r?\n/).sort(), [".gitignore", "tracked.txt"]);
});

test("module import has no private-state or Object persistence side effect", async () => {
  const knownRoots = [
    join(repositoryRoot, "private", "career"),
    join(repositoryRoot, "private", "identity"),
    join(repositoryRoot, "private", "object-store"),
  ];
  const before = await Promise.all(knownRoots.map((path) => pathSignature(path)));
  await import(`../dist/index.js?architecture=${Date.now()}`);
  const after = await Promise.all(knownRoots.map((path) => pathSignature(path)));
  assert.deepEqual(after, before);
});
