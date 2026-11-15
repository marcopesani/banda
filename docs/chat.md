# The chat

Priority: **Highest**. Implementation status lives in [Status](status.md).

The app is three surfaces (DESIGN.md "The app"): the sidebar, the chat and its panel, with settings as sheets or plain
pages. It is built specimen first: the design language is revamped and every screen and card exists as static UI with
fixture data, reviewed by the owner at desktop and phone width in light and dark, before the daemon is wired behind
it. Components the design does not name are deleted, not kept; the specimen is rebuilt from scratch and the old one
goes with them. Each slice, once wired, is end to end: its tests, its fault points where it is durable, a manual run
against a throwaway home, and the owner's review before the next.

Entry points: ../web/src/App.tsx, ../web/src/components/AppShell.tsx, ../web/src/routes/Chat.tsx,
../web/src/routes/Specimen.tsx, ../web/src/specimen/, ../web/src/components/ and ../web/src/styles/theme.css.

## Open work

- [ ] Voice in the composer, decided before promising complete behaviour (DESIGN.md "Open")
- [ ] Agents that say too much or the same thing twice: watched in every slice's app use, fixed at the prompt or the tool's result that caused it
- [ ] A PDF's pages drawn as pictures: the daemon reads its page count, title and first page's words, never rasterizes it (no renderer that is not code to trust); the viewer is not paged
- [ ] Slice 10 tried at phone width: the browser used for app runs cannot be narrowed
- [ ] An approval with the owner's signed-in session reads as what it does ("Send this form on amazon.es as you?"), never a raw address as its title
- [ ] The panel's tab when switching agents: the one that fits what happens in that chat
- [ ] A page handed over that the owner cannot get through in the agent's browser (a bot check that keeps checking) offers "Open in your browser": the same address in the owner's own browser
- [ ] Long chats: "Earlier messages" and opening at a search hit, tried on a chat of hundreds of entries
- [ ] Stop has no control in the app: a chat's or a group's run stops only through the daemon (`POST /chats/<chat>/stop`, `POST /groups/<room>/stop`), the browser's Stop or archiving; the owner decides whether and where it returns

## Search tools

Agents use the same retrieval path as Cmd+K for direct messages, shared group logs and artifact titles/latest text.
Source links show an icon for their kind; explicit labels are preserved, and empty labels resolve to the source
name or a bounded message excerpt. Unavailable sources retain a generic, usable link.
`search` returns bounded excerpts, source references, app links and a continuation cursor; `read_search_result` reads
bounded source context. Recall stays memory-only. Hidden execution chats are excluded before ranking and limiting.
The text coverage of an artifact is its first 200 KB; binary contents, workspace files and live services are outside
this slice. Source changes can change pagination; restart the query for a fresh traversal.

- [ ] Extend shared search to agent/group names and routine/watch definitions
- [ ] Search attachment contents and workspace files only through an explicit indexing and access mechanism

The tool-access specimen (`#/specimen/toolsets`) is a local proposal: Connections, Permissions, then Tools, with
icons, per-tool descriptions and syntax-highlighted input schemas. Built-in schemas are generated from registrations
by `node scripts/specimen-tools.ts`; live connection schemas are not fabricated. Its switches do not change daemon
settings. Wiring tool access is a separate slice.
