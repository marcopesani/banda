# Product scope and reproducible development

The release keeps the browser and current feature scope, including groups, memory, artifacts, routines,
connections and current provider choices. Qualify their existing supported behavior rather than
hiding features to obtain a passing release. Keep the one-daemon architecture and product vocabulary.

0.1.0's desktop and CLI release targets are macOS 14 or newer on Apple silicon, and Linux x64 on Debian 12 or newer
and Ubuntu 22.04 or newer (the desktop as a .deb). The phone release targets Android ARM64. Windows x64 and Linux
ARM64 are built in CI and are not release targets. Intel Macs are unsupported.

0.1.0 states two limits instead of fixing them. The agents share one computer, so the box does not separate one
agent or chat from another ([Box isolation](isolation.md)); the README and SECURITY.md say so to the owner. The Mac
app is signed ad hoc, not with a Developer ID, and nothing updates itself: releases are installed by hand
([Operations](operations.md)).

## Work

- Inventory every exposed UI action, API route, model tool and resumable task. Name the supported operations,
  protocol subsets, provider models, authentication modes and platform/runtime combinations.
- Recheck recent provider setup work before treating app-based provider selection as missing. Validate setup,
  disconnect, restart and missing credentials through the actual app and API.
- Qualify the packaged platforms through clean-machine spikes. Hold each launch workflow to the latency and cost
  budgets in [Verification](verification.md), and measure the workflows and provider/model paths that have none.
- Repair lint traversal of nested worktrees and make toolchain, install, build and test commands reproducible.
  Pin exact dependencies and keep pi-durable, pi-ai, pi-env and chord in lockstep.
- Preserve current capabilities while resolving their blockers. An unsupported operation must explain its limits;
  silently broadening authority or lowering a privacy claim is not a substitute for a fix.

## Launch workflows

1. Install, configure a provider in the app, choose a name and face, and obtain a useful first answer.
2. Delegate research, inspect sources and progress, steer, stop, and deliberately recover interrupted work.
3. Receive an artifact, edit while work continues, inspect versions, restore one, and retain concurrent changes.
4. Review an exact send, edit/approve/decline, revoke permission, and resolve an uncertain external outcome.
5. Create a routine, leave the app, return to its event and reply in the chat, inspect its next run, and pause background work.
6. Use the browser live, take over for sign-in, hand it back, approve supported sends, and sign out.

Also accept existing memory, group and provider flows. Responsive phone-width review remains
required; the phone app's remaining work is in [Operations](operations.md).

## Acceptance

The support matrix accounts for every current surface. Checks run from an isolated checkout without discovering
nested worktree configurations. Browser qualification is mandatory. Provider/model quality, cost and latency have
concrete reviewed budgets before release. Features DESIGN.md no longer names are deleted by the chat slices, not hidden.

Entry points: ../biome.json, ../mise.toml, ../package.json, ../src/server/routes/providers.ts,
../src/core/provider-credentials.ts and ../web/src/components/TierPick.tsx.

## Open work

Recheck these items against current code before implementation; an unchecked item is not a freshly verified
defect. Remove it only when its fix and acceptance evidence are recorded in a commit.

- [ ] Inventory the current feature/provider/platform support contract and make checks independent of nested worktrees (scope.md)
- [ ] Launch budgets, a first answer on a fresh home: no history holds one. On a throwaway home per run (`npm run eval:journeys -- fresh`, then `start first-use`), ten runs for each model a tier names on each supported provider, then `npm run turn:audit -- --home <that home>`; set the `answer` line for a chat's first run from them
- [ ] Launch budgets, artifacts and the browser: the `artifacts` and `browser` journeys on a throwaway home until `turn:audit` counts 30 runs of each (a run that publishes needs a kind of its own first), then set their lines
- [ ] Launch budgets, paths: name the provider/model paths 0.1.0 supports; each needs 30 `answer` runs in `turn:audit` or the owner's acceptance by name. Measured so far: Anthropic's small tier by API key, OpenAI's large tier
- [ ] Decide whether the cost ceilings are one per workflow or one per tier: a large tier's run costs several times a small tier's
- [ ] The small Anthropic tier ends about a third of the owner's runs without answering, and each is nudged into another round of requests: fix the cause in the prompt or the speaking tool, or name another small-tier default
