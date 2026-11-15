# Persistence backup and restoration

Priority: **High**. Implementation status lives in [Status](status.md).

## Findings

Blob writes sync file contents before rename, but explicit destination-directory persistence is missing. SIGKILL is not evidence of power-loss ordering. Recoverable truth includes the durable store, blobs, authoritative workspace files, auth/configuration and browser sessions; restoring only durable.db cannot recreate the band.

Entry points: ../src/core/blobs.ts, ../src/core/store.ts, ../src/home.ts, ../src/box/container.ts and ../src/core/search.ts.

## Work and exit criteria

- Verify blob file and directory persistence ordering on the selected platform before a referring store commit.
  Separate SIGKILL claims from filesystem/power-loss claims; do not describe one as proof of the other.
- Define the recovery set: durable store and its SQLite side files as applicable, referenced blobs, accepted and
  workspace-only definitions, memory, required workspace outputs, configuration and auth. Include browser state; identify disposable caches, tool downloads and search indexes explicitly.
- Establish one consistent snapshot boundary without syncing a second authority. Protect secrets in exported backups;
  document key custody and what cannot be recovered if the owner loses the key.
- Implement backup/restore progress and failures in the app. Validate manifests and hashes before activating a
  restored home; do not overwrite the current home during validation. Rebuild derived state afterward.
- Restore on a fresh home and fresh containers, then resume pending work. Unknown external outcomes still ask;
  restoration must not replay already completed sends merely because the backup predates them.
- An upgrade that converts the home takes a backup first, and converts nothing when the backup fails. The backup is
  of the home before any step: a start that goes on after a kill never takes it again over a home half converted.
- Exit: recovery acceptance R1-R4 passes, including a corrupted or incomplete backup and pending approvals.

Follow [Delivery](delivery.md) and the relevant gates in [Verification](verification.md).

## Open work

Recheck these items against current code before implementation; an unchecked item is not a freshly verified
defect. Remove it only when its fix and acceptance evidence are recorded in a commit.

- [ ] Prove blob file and directory persistence ordering on the supported filesystem (recovery.md)
- [ ] Use the app's restore in the desktop app itself, on each platform: starting again from Settings, the restore
  finished before the window opens, a second launch meanwhile, and Windows, where a folder with an open file does not
  move. Its parts are tested; the whole was only used in a browser against a daemon started again by hand
- [ ] Restore into a home that is new or does not start: first run and the desktop app's failure page offer nothing,
  and `banda restore <backup>` is the only way
- [ ] Show how far a long copy is in bytes, not only which step it is on, and let the owner stop it
- [ ] Back up a container box's volumes (workspace, work, tools, browser): a backup carries the native computer's
  folders only (and host mode's), so the app restores none where Docker keeps them
- [ ] Stop a box a killed daemon left before a restore takes the home's place: it holds the earlier home's folders
- [ ] Protect the secrets in a backup that leaves the computer: encryption, key custody, and what a lost key costs
- [ ] Take backups on a schedule and before an update, and decide how many are kept
- [ ] Qualify a restored home (R1, R2, R4): pending asks, routines and write-backs resume, completed sends are not
  replayed, requests the proxy held at the backup are settled, and a sign-in renewed after the backup asks again
- [ ] Hash the large computer folders (work, tools, browser), which a manifest only counts, where that is cheap
- [ ] Make a backup hold through power loss, not only a kill: only the store and the manifest are synced before the
  rename
- [ ] Keep the backup an upgrade takes until the owner lets it go, and offer to restore it when a step fails for good
  or the owner returns to the earlier build (operations.md)
