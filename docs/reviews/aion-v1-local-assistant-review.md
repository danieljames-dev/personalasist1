# AION V1 local assistant architecture review

Recommendation: **APPROVE**, subject to CTO review.
Implementation status: **Reference Candidate**. Not production, not normative conformance.

## What was reviewed

`@aion/local-assistant` (contracts, adapters, service, developer bridge), the Command Center app
(`apps/aion/`, `apps/aion-command-center.mjs`, `apps/aion-demo.mjs`), the V1 test suites, and the
V1 architecture, threat-model, privacy, and usage documents.

## Boundary findings

- **One domain package, one composition app.** Splitting a package per screen would have added
  dependency ceremony with no independent lifecycle or replacement evidence. The package holds
  versioned records and policy; the app holds transport, adapter selection, executable
  resolution, and Career integration. No domain type imports a transport, filesystem, or process
  API, and the boundary suite enforces this.
- **Every required port is explicit and replaceable.** Storage, clock, ID generation, model
  provider, capability registry, import source, private backup, and developer-agent bridge are
  interfaces with at least two implementations each. The deterministic clock, ID generator,
  provider, in-memory repository, synthetic bridge, and unavailable bridge are the substitution
  evidence, not decoration.
- **The Career engine was integrated, not re-implemented.** The Command Center shells out to the
  accepted CLI through a fixed allow-list with explicit normalized paths and no shell. Matching,
  preparation, and evidence logic remain exactly where Sprint 3 approved them.
- **Authority flows one way.** Providers receive messages and enabled memory context. They may
  propose; the Agent Controller validates, digest-binds, requests a one-shot approval, and
  executes. No capability accepts shell text, and no code path lets provider text approve.

## Directive requirements met

Command Center, Chat, replaceable provider port with a deterministic offline provider and two
boundary adapters, provider configuration UI and health, local conversation history, Memory with
provenance/correction/disablement/deletion/export/conflict preservation, Tasks, Routines, an
in-process scheduler, Planner, capability registry, bounded Agent Controller, explicit one-shot
Approvals, Activity, Career UI over the accepted engine, an Import Center with ChatGPT/Claude/Grok
parser boundaries and mandatory dry run, encrypted private backup with restore verification,
Settings, onboarding, the developer-agent bridge, `npm run aion`, and `npm run aion:demo`.

## Corrections made during the milestone

1. `AgentActionV1` gained `conversationId` and `origin` so a provider proposal is distinguishable
   from an owner one in both storage and audit.
2. Retention, approval expiry, and memory-conflict recomputation were moved into one prune step
   that runs on every write, rather than being a separate sweeper that could drift from state.
3. `sendMessage` was rebuilt on a streaming generator so the streaming requirement is real rather
   than claimed, with `sendMessage` implemented as a drain of the same path.
4. The architecture boundary test flagged `RegExp.exec(` as process execution. The production
   source was changed to `String.match` rather than weakening the assertion; the assertion was
   then made precise about process APIs and extended.
5. Windows developer-agent discovery was corrected. A real Codex `codex.exe` is installed but only
   `.cmd`/`.ps1` shims are on `PATH`, so the naive lookup would have reported unavailable
   incorrectly. Resolution moved to the composition root as a short explicit candidate list; shell
   shims remain deliberately excluded so instruction text is never shell-interpreted.
6. The demo previously printed claims it did not exercise. It now drives the real loopback API,
   proves restart reload and byte-identical rerun, and prints only what it asserted.

## Real-use activation review (AION-V1-R1-REAL-USE-ACTIVATION)

Recommendation: **APPROVE**. The activation milestone extended V1 rather than rebuilding it. No
package was added, no dependency was added, and no accepted decision was superseded.

- **The bridge stayed a port; a second implementation proved it.** `DeveloperAgentBridgeV1` gained
  a mode, a command disclosure, and separated account health, then took a second real
  implementation — Claude Code CLI — beside the preserved Codex CLI. Both share one bounded base
  that owns spawning, timeout, cancellation, output limits, and containment; each subclass supplies
  only its own argument vector and status reading. Selection moved into a `DeveloperAgentRegistryV1`
  port that Settings drives, so vendor choice is owner policy rather than a hard-wired composition
  decision. This is the replaceability claim being exercised, not asserted.
- **Task text left the argument vector entirely.** Instructions now travel on standard input for
  both bridges, which removes the residual flag-injection surface a final positional argument had.
  Control characters are rejected. Each bridge discloses the exact vector it would run, with the
  approved root redacted, so the property is checkable by the owner and by tests rather than only
  by reading the source.
- **The read-only boundary is carried by the digest, not by convention.** Mode is capability input,
  so the approval the owner grants names one boundary and authorises only that one. An absent mode
  resolves to read-only, so the failure direction is safe. This closes the gap where a single
  approval shape covered both reviewing and writing.
- **Availability and account health were conflated and are now separate.** A version probe proves a
  program exists; it says nothing about sign-in. Health is probed only on explicit request, reads
  only the sign-in flag, and never determines paid quota. This directly answers the case where a
  CLI is installed but has no usable account.
- **Two genuine privacy defects were fixed.** The bridge previously reported the full local
  executable path, and would have disclosed the approved repository root in a command, both of
  which reach the browser through `/api/state` and both of which contain the owner's user name.
  Status now reports an executable *name* and the disclosed vector redacts the root.
- **The copy/paste acceptance criterion is met inside the product.** A `developer:` turn in Chat
  becomes an ordinary read-only proposal, revalidated against the registry and queued for approval.
  It gains no authority the proposal protocol did not already grant, and Chat still reaches no
  shell.

Verified by one bounded read-only task through the real Claude Code bridge and the real approval
path — refused before approval, executed once after it, not reusable afterwards, with the working
tree byte-for-byte unchanged. The Codex bridge was verified for discovery, version, account health,
argument construction, and boundary refusals; no Codex task was executed, because executing one
would consume paid quota without proving anything the shared base does not already prove.

## Claims explicitly not made

No normative conformance, production readiness, representative workload, security certification,
or hiring/employability claim. DG-3 and DG-4b remain Open. The Universal Object Contract remains
Pre-stable. Normative fixtures remain unauthorized and were not created. Application submission,
job discovery, email, and browsing do not exist. No real owner data was ingested.

## Conditions carried forward

- Live `state-v1.json` is not encrypted at rest; the encrypted private backup is the protected
  portable form.
- An approved developer-agent task runs a third-party CLI that AION bounds by repository root, task
  mode, a fixed argument vector, and the absence of a shell, but does not otherwise sandbox. A
  `workspace-write` approval is a real grant of write authority inside this repository; the owner
  should prefer read-only and read the disclosed command before approving.
- Remaining credit or quota on a developer-agent account is not knowable without a paid call, so a
  bridge reported `signed-in` can still fail at run time. AION reports what it verified and no more.
- No off-site or offline rotated backup copy exists; this remains a standing operational gap.
