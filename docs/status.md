# Work status

## Current work

0.1.0-alpha.18 is published as a pre-release for Apple silicon Macs and Linux x64 (.deb), with both command-line
archives, the Android APK, and the source and notice archives its own tag run assembled; the landing links its
downloads. `release acceptance` passed on what it published: clean installs on a Mac runner and on Ubuntu 22.04 and
the newest Ubuntu runner, and an upgrade from alpha.14 on Mac and Linux that kept the home. The published Mac app
opened the owner's home (format 4) and is in daily use there. The computer banda ships is the default box on Mac and
Linux; Docker is used only by name, on Windows, and once to bring an earlier home's files. alpha.13, alpha.15 and
alpha.16 were tagged but published nothing.

Open before 0.1.0: the owner's walk through the six launch workflows on the candidate; the computer starting on a
Mac that never ran banda, and a person installing the x64 .deb on a physical Linux machine (no runner shows either);
and how the owner's review of a release's sources and notices is recorded, since every release so far says nobody
reviewed its set. The launch budgets hold on what was measured: artifacts, the browser and a fresh home's first
answer were measured on one provider's small tier only, and `test/launch-budgets.json` names the rest as unmeasured.

The native-computer candidate is rebased onto current main. Routine requests now retain their original agent and
execution after the run ends, and their existing approvals appear in that agent's chat. Archiving cancels retained
requests and queued result continuations. Captured tool authority prevents permissions and pending drafts from
crossing a tool's removal or definition replacement, while preserving same-definition sign-in and relisting.
Focused backend checks, desktop/phone app walkthroughs and independent source review pass. Combined qualification
covers the full ordinary suite, an earlier candidate's Mac package and fresh candidate-ref fault and Docker CI.
Linux x64 staged native use now passes. Installed Linux desktop and final release-artifact qualification remain open.

General shows shared browser preparation, verified-download progress, safe failures and an explicit retry, separately
from running pages. Opening Settings leaves browser preparation lazy. Ordinary backend checks and desktop/phone
walkthroughs against throwaway daemons pass; independent review found no reproduced blocker. The exact packaged
Mac shell lifecycle passes for the published alpha.12. Its native proxy-recovery walkthrough and public asset
delivery pass. The rebased candidate's packaged qualification and owner review remain open.

Agent-definition publication is integrated into the native-computer candidate. Owner saves compare
their accepted base inside the commit, keep publication intent with the accepted bytes, and preserve competing
workspace versions. The app retains stale personality drafts and exposes saved and workspace history. Native
insertion-race, open-descriptor and CI fault checks pass. The hands-on desktop/phone walkthrough and owner acceptance
remain open. Combined ordinary checks, types, build and contrast pass. Artifact, routine, watch and memory
publication remain in [Workspace](workspace.md).

The bundled computer candidate targets Apple silicon Mac and Linux x64 desktops. The landing page advertises
those desktops and command-line archives, with Android in its separate phone section. Windows, Intel Mac and Linux
ARM downloads are no longer advertised. Local ordinary checks and independent desktop/phone-width landing review pass.
The integration is on main and shipped in 0.1.0-alpha.14.

The published macOS ARM64 alpha.12 has packaged desktop/phone-width walkthrough evidence, including lazy browser
preparation, guarded sends and restart persistence. Its public-download and source reconstruction checks pass.
The owner accepted its source and notice packet and verified Mac sleep/wake. The rebased candidate's exact packaged
Mac qualification and alpha.13 source and notice review remain open. Mac support requires Apple silicon and macOS 14.

Linux x64 staged native app use passes at desktop and phone widths, including command and browser use, proxy repair,
guarded sends, persistent folders and complete cleanup. Only the KVM supplementary group is added to the ordinary
runner identity. Distinct VM generations retain files and every recorded history entry. This restart occurs within
one verifier process. Browser delivery uses a local pinned archive, so Linux public download delivery remains open.
Actual Debian inspection binds its embedded runtime and shell to the staged proof. Explicit runtime library and
glibc requirements are declared; clean Debian APT installation and binary loading still need CI evidence.
The inert Linux service experiment preserves original main exits 0 and 23 with live detached descendants, then
cleans each owned cgroup, including after an injected observer failure. Installed Electron startup, effective renderer
confinement, natural Quit and persistence across a new daemon process remain open. Linux ARM64 has source-build and
smoke evidence but no KVM runner. It is not a desktop release target. Windows retains its existing backend for development.

Guest command sessions connect only to running VMs and proxy startup follows policy updates. Native packaging builds
that capability from pinned source. Ordinary suites, native execution-boundary checks, packaged Mac recovery
walkthroughs and fresh six-shard fault and Docker CI pass. Workspace refreshes come from tool completion and owner
actions; startup and explicit reads reconcile missed changes. Concurrent native Mac homes have recovery evidence.
Prolonged outages, broader recovery qualification, preflight latency and clean-machine distribution remain open.

banda is a chat: a band of agents in a sidebar, one conversation each, groups, a panel, and no other screen, as
DESIGN.md says. The specimen and the wiring slices are in code; what remains of them is each section's open work.

The inspirations studied for the surface: Grok Bot (the bot, not the conversation, as the core object; a roster
sidebar with a latest-message preview; one timeline where prose, events and cards share the transcript; the bot's
computer as a status icon, a pinned preview and a take-over; routines in a bot-specific list with their runs in the
transcript; groups of up to six; approvals as cards with Allow once, Deny and Always) and Meta's Muse (one long
conversation like a text thread; the agent's current activity in one line under its avatar, the full log and the
approved permissions a tap away; browsing allowed by default and irreversible actions checked in; artifacts in the
chat; a name, an avatar and a style the owner chooses; notifications only when something is meaningfully new).

## Updating status

Keep only current state here: the active slice, remaining gates, owner review and next action. Work descriptions
and checkboxes live in their section files; update them there rather than adding another task list. Test evidence,
findings triage, decisions and caveats belong in commit messages and executable tests. Mark a slice accepted only
after the required checks and app use, followed by owner review. Detailed history remains in git.
