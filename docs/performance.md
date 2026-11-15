# Resource bounds search and projections

Priority: **Medium**. Implementation status lives in [Status](status.md).

## Findings

Shell subscribers independently build broad projections; search catch-up visits chats inside a store transaction and uses synchronous SQLite. FTS optimization/VACUUM can block the event loop. JSON request bodies lack bounds, and box/proxy memory limits and per-chat budgets remain gaps.

Entry points: ../src/server/transcript.ts, ../src/core/search.ts, ../src/server/http.ts, ../src/core/routines.ts and ../src/box/container.ts.

## Work and exit criteria

- Bound JSON/upload/MCP/proxy response sizes, timeouts, concurrency, queue pressure and disk growth; set box/proxy
  memory and process limits. Surface budget exhaustion and disk/runtime failures without losing pending work.
- Share expensive shell projections per daemon without creating another authority; move long scans outside commit
  critical sections where the substrate permits a consistent snapshot. Measure synchronous FTS/VACUUM impact.
- Bound history through the substrate's compaction mechanism while preserving accepted state, provenance and pending
  work. Verify cache-prefix stability; defer speculative cache warming until measured demand warrants it.
- Narrow area dependencies around admission, workspace mutation and projections as touched. Keep protocol adapters
  at explicit boundaries; avoid a whole-core rewrite or introducing an event bus to conceal broad dependencies.
- Exit: performance acceptance L1-L4 passes with resources and history representative of sustained personal use.

Performance acceptance L1-L4 is defined in [Verification](verification.md). See [Architecture](architecture.md) for
interface work; resource safety should be pulled forward when an earlier trust-boundary change needs it.

Follow [Delivery](delivery.md) and the relevant gates in [Verification](verification.md).

## Open work

Recheck these items against current code before implementation; an unchecked item is not a freshly verified
defect. Remove it only when its fix and acceptance evidence are recorded in a commit.

- [ ] After a few weeks of heavy use (around 2026-12-01), run `npm run cache:audit -- --home <fork> --window 60` on a fork and
  decide with real numbers: the one-hour cache against the five-minute one, and whether warming earns a place (it was removed:
  it can only buy a faster first reply, never save money)
- [ ] With it, `npm run turn:audit -- --home <fork> --since <the release's date>` against the launch budgets (verification.md): the account sign-in's cache and the owner's message to the first request have too few samples on current code to pass or fail
- [ ] A chat on a model priced by prompt length compacts far above the cheaper band (a small tier at five times its price above 100k tokens, a budget at half of a 1M window): place the budget by price as well as by window
- [ ] Record when a response's first token arrives: the store times a request's start, its end and its thinking, so time to first token has no number and no budget
- [ ] Record why a message waits for its first request (the computer's readiness, a compaction, a queue): a wait of seconds leaves no cause in the store
- [ ] Compaction eval: three agents' chats through three successive compactions keep names, dates, promises and open work (a journey eval); it settles the 50% share in `src/core/compaction.ts`
- [ ] A window under about ten times the prompt (banda's is 5–10k tokens; a 32–64k model) compacts every band of growth: raise its budget, or warn when the owner picks one
- [ ] Raw transcript, still missing: a stacked breakdown of the context (prefix, summary, kept messages, tool results), "what the model saw" at a checkpoint via `context({ at })`, cache writes held 1h, and a compaction's cost (upstream, Substrate)
- [ ] The context meter is read when entries come or a run ends, not live while a compaction runs
- [ ] Recall over a chat's own compacted history: `recall` searches memory only, so detail a summary dropped is lost to the agent though still in the store
- [ ] Follow-up: cache-aware summarizing (summarize as the next message of the chat's own cached request) would make compacting a warm chat cheap; raise upstream once the above is measured
- [ ] A container memory limit for the box (and the proxy)
- [ ] Bound protocol responses, queues, disk growth and projection/search work with accumulated history (performance.md)
- [ ] Request bodies are read whole by the HTTP server
