# Installation updates and support

Priority: **High**. Implementation status lives in [Status](status.md).

## Findings

Process restart is well considered, but packaged runtime delivery, least-authority supervision, clean-machine installation, complete restore and update recovery are not established. Local dependency pins do not alone make every image/toolchain build reproducible or an update safe.

Entry points: ../src/cli/index.ts, ../src/daemon.ts, ../src/box/container.ts, ../box/Dockerfile, ../proxy/Dockerfile, ../src/home.ts and ../package.json.

## Work and exit criteria

- Package and supervise the selected runtime with the least host authority; isolate Docker socket access and prove
  rootless operation or an equivalent supported boundary. Pin and verify artifacts and dependency versions.
- Provide clean installation, provider setup, autostart, shutdown, sleep/wake and offline behavior. The app must
  explain a missing runtime, full disk, provider outage or failed update with a concrete next action.
- Spike signed distribution/update installation on the selected platform. Updates stop work safely, back up first,
  verify artifacts and activate atomically. A later build opens the home an earlier one left (DESIGN.md "Home"); a
  migration step exists for a shape that changed, never ahead of one. Binary rollback alone is not data rollback: a
  home a newer build converted goes back only as the backup taken before its first step.
- Add owner-controlled diagnostics with redaction, explicit export and retention. Document token rotation, backup key
  loss, uninstall/data retention and recovery. No telemetry or outbound support upload without owner action.
- Exit: a clean supported machine installs, runs, updates and recovers without CLI or hand-installed Docker.

Follow [Delivery](delivery.md) and the relevant gates in [Verification](verification.md).

## Native packaging

Native packaging compiles the pinned Microsandbox source with banda's existing-only execution patch. The packaging
helper verifies source, compiler and guest-agent inputs, uses a private Rust 1.99.1 toolchain and Cargo cache under
`release/cache/computer/runtime`, and records the build inputs and actual executable hash in the installed manifest.
The original vendor archive remains a verified firmware input. A source build failure has no fallback to ordinary exec.

Mac packaging needs the platform's C toolchain and targets macOS 14. Linux packaging runs the source build inside the
upstream digest-pinned manylinux 2.28 Docker image and checks that baseline before installation. Those are packaging
requirements. The installed native Mac and Linux applications use their bundled executables and need neither Rust
nor Docker. Windows keeps its existing backend until native qualification.

## Sources and notices

The Mac and Linux downloads carry GPL and LGPL code: the kernel inside the firmware, and the Debian packages of the
guest images. A release offers their source from the same place as the downloads. The release workflow assembles it
from its own builds, never by hand: it reads what each built computer contains (the installed manifest, each image's
package database and Python distributions) and fetches the source of exactly that. Every fetched file is checked
against a hash: one pinned in the repository (Microsandbox, the firmware, the kernel), one the pinned Cargo.lock
gives (crates), or one the distribution's own index gives (Debian's snapshot, PyPI). `release-materials.json` binds
the set to each download by SHA-256, and a tag publishes nothing when a source is missing, fails its hash, or the
index does not name the exact files being published.

Review is a person's act, so nothing a workflow writes says `reviewed`. The installed manifest's `redistribution`
is decided when the bundle is staged, before its bytes exist to be read: it is `reviewed` only for inputs the owner
recorded in `scripts/computer-distribution.json` (the alpha.12 Mac bundle), and `review-required` for every build
since. The release's index can only say `unreviewed`. What the set leaves out is written in the index and in
`RELEASE-SOURCES.md`, never implied.

A notice travels with the copy it covers, so every download carries its own in `app/licenses`, written when the tree
is staged from what was just staged: the npm packages' license texts from `node_modules`, the texts of every crate of
the pinned Cargo.lock, and each guest package's copyright path inside its image, which is where the image carries it.
`README.txt` there is the index and also names what lives elsewhere (Node.js, the computer's notices, Electron's
files). A package with no license to show stops the staging; an npm package without a license file is listed by its
declared license only once it is named in `scripts/notices.ts`. The desktop app's tray menu shows the folder.

The desktop packages carry FFmpeg as Electron's own shared library, under the LGPL-2.1-or-later. Its source is in
the release's set: Chromium's fork at the commit the DEPS file of Electron's Chromium names, and Electron's source,
which holds the patches it applies. `ELECTRON_SOURCE` pins them to the Electron in `desktop/package.json`, and
staging and the tests stop when the two differ, so a new Electron cannot ship with the old library's source.

## Open work

- [ ] Qualify native recovery through host sleep/wake and prolonged outages, the tether to the proxy held through
  both. A command and each ask of the proxy (a pass, a take, the receipts) still bring the whole computer up first:
  reduce that cost as a browser effect's was, without losing proxy recovery or retrying interrupted actions. Run the
  new restoration fault sweeps in CI.
- [ ] Qualify the bundled Linux computer on x64 and ARM64 with KVM: staged runtime and image hashes,
  guarded networking, persistent folders, lazy browser loading, desktop/phone-width use and complete cleanup.
  The release workflow's optional native-computer check runs `scripts/verify-computer.ts`; ordinary release
  smoke checks do not exercise the VM. By default the browser archive is supplied locally with its exact pinned
  bytes. `BANDA_VERIFY_PUBLIC_BROWSER=1` exercises its published URL; public delivery remains a separate check.
- [ ] Dispatch `release acceptance` for the first release after 0.1.0-alpha.14 (upgrading from it) and for 0.1.0,
  and settle what its first runs show: the installed app's sandbox and `/dev/kvm` on both Ubuntu runners, a Mac
  runner's app with its computer offline, and the two releases' API agreeing on what is made before the upgrade.
  Then check by hand, on a Mac that never ran banda, what no runner sees: Gatekeeper's Open Anyway on the
  downloaded image, and the computer starting from `/Applications`.
- [ ] Spike the Windows native computer's directory ACLs, local named-pipe permissions and VM mount isolation
  before selecting it in the desktop app. The current runtime ships Windows binaries and requires WHP;
  the banda adapter is not qualified for Windows. The native Mac computer requires Apple silicon and macOS 14 or newer.

Recheck these items against current code before implementation; an unchecked item is not a freshly verified
defect. Remove it only when its fix and acceptance evidence are recorded in a commit.

- [ ] The app on an origin of its own, for a phone with no shell to install: `web/vercel.json` is a Vercel project
  rooted at `web/` that builds only the branch `app`, sends the app's files with the headers the daemon sends, and
  installs with its worker (`node test/smoke/hosted.ts`). There the app is a device through the browser's own Iroh
  endpoint (`web/iroh`, built into `web/iroh/pkg` by its `build.sh` and committed), paired from the code Settings →
  Devices shows, which the page scans with the phone's camera, or from its link, opened or pasted. Open: a release
  moving `app` to its tag, by hand until then; a real iPhone, since only Chrome and a WebKit build on a Mac have run
  it, and the camera those tests scan with is a drawing of the code; the notices of the crates compiled into the
  committed endpoint, which THIRD_PARTY_NOTICES.md does not name; one origin serving daemons of more than one
  version; the endpoint built in CI instead of committed, which alone would show its build came from its sources; a
  relay of the owner's own, which that origin's policy does not name; a daemon whose relay changed since it was
  paired, whose new address n0's lookup gives with the trailing dot WebKit refuses (only a ticket's address has it
  taken off); two tabs of one browser, which do not hear of each other's pairing or forgetting; a browser that
  clears a site's storage it has not seen for a while, which makes a new device of it; and the pairing screens'
  words, which say "phone" on any browser
- [ ] What a device is sent, which is what it waits for where a relay throttles (n0's: about 46 KB/s from one endpoint,
  measured, and its log says so). In a home that is lived in the shell's first push is 1.44 MB, of which coding
  sessions are 707 KB (`harnesses.sessions`) and the connections' tools 589 KB (`capabilities`), each sent again whole
  when one changes; the skills list is 948 KB, read for its names; a chat's first page is 70 KB to 2 MB. Packed they
  are a fifth to a third of that, and `test/hosted-app.browser.test.ts` holds an idle device to asking nothing. Open:
  the shell without the sessions' and the tools' bulk, a skills list of names, a chat's first page by weight, the
  phone's shell asking for packed answers as the browser's does, and a relay of the owner's own.
- [ ] Run the release workflow's `materials` job once by hand (`build_target: all`, no tag) before the next tag: it
  has only run on a development Mac against alpha.14's downloads, never on a runner. Watch its disk use and its time
- [ ] Decide how the owner's review of a release's sources and notices is recorded. The set exists only after the
  build, so no committed record can name its hashes beforehand. Either the tag run drafts the release and the owner
  publishes it after reading `release-materials.json`, or a manual workflow run attaches a review record that names
  the published index's SHA-256 and who accepted it. Until then every release says `unreviewed`
- [ ] alpha.14 is published without sources or notices. Attach the set this collector makes from its downloads, or
  replace it with a release that has one
- [ ] Sources the set leaves out: CPython in the proxy image, pi-env and the guest agent's C library (permissive
  licenses)
- [ ] FFmpeg: its source is in the set, but two things are unproven. That Chromium's fork at the pinned commit with
  Electron's `patches/ffmpeg` rebuilds the library Electron ships (it needs Chromium's build system, which the set
  does not hold); and that a rebuilt library can replace the shipped one in the installed app, on a Mac in
  particular, where the bundle is sealed by an ad hoc signature (LGPL-2.1 section 6)
- [ ] Native addons inside npm packages: `@number0/iroh-*` and `@resvg/resvg-js-*` are compiled Rust, and their npm
  packages carry no license file and no notices for the crates built into them. `npm-packages.txt` lists them by
  declared license alone. Gather their notices from their upstream sources at the pinned versions; resvg is MPL-2.0,
  which asks that a recipient be told where its source is
- [ ] The seven `@earendil-works/*` packages and seven others ship no license file in their npm tarballs
  (`NPM_WITHOUT_LICENSE_FILE`): ask upstream to include it, or carry the text from their repositories
- [ ] The notices are reachable from the desktop tray and by path in the command-line archive. Nothing in the web
  app shows them, so a phone or a browser has no way to them, and the tray item has not been tried in a packaged app
- [ ] Verify the OpenPGP signature of each Debian source control file against Debian's keyrings; today a `.dsc` is
  trusted by the hash snapshot.debian.org's index gives over HTTPS
- [ ] Rootless box, and a supervisor that alone holds the Docker socket
- [ ] Bring a qualified native runtime on every platform. The reviewed Apple-silicon bundle includes it; Windows
  keeps its existing backend and Linux native acceptance remains open
- [ ] Sign and notarize the desktop app (Developer ID, Windows code signing), then add updates that back up first and
  activate atomically. Deferred by the owner's decision and not a gate for 0.1.0: there is no Apple Developer
  account, so the Mac app ships signed ad hoc, opened as Apple describes for an unidentified developer, and every
  platform updates by hand
- [ ] Run the release workflow end to end and fix what each runner turns up (Windows fast tests, linux arm64 deb).
  Then install each artifact on a clean machine: the desktop app and the CLI archive are tried only on macOS arm64
- [ ] Windows: a graceful daemon stop (Quit ends the process outright), and a pass over atomic renames and paths
- [ ] A smaller release: the proxy's image (the whole mitmproxy image, about a fifth of the download), Electron's
  unused locales, and whether one Node could serve the app and the CLI
- [ ] A signed release APK: the release workflow builds the APK unsigned, then signs it as
  `banda-<version>-android-arm64.apk` in a job of its own that runs no npm or Gradle, and refuses to tag one without
  banda's key in the repository's secrets (BANDA_ANDROID_KEYSTORE_BASE64, _KEYSTORE_PASSWORD, _KEY_ALIAS,
  _KEY_PASSWORD). The key is set; a signed workflow run still needs trying, and the APK
  installing over the one before
- [ ] The phone's shell on iOS: out of scope for now. It implements the same plugin contract as Android's
  (`BandaPlugin` in `web/src/lib/transport.ts`) with iroh-ffi's Swift bindings, and needs a real iPhone to try
- [ ] The phone's shell, once paired: a device revoked while the app is open goes to the pairing screen (covered by
  tests, not yet tried on a phone), and the app's files come with the shell, so a new build reaches the phone only as
  a new APK
- [ ] Windows endpoint-key publication: Node flushes the key file before rename, but does not expose directory
  fsync on Windows; qualify power-loss recovery on a Windows filesystem
- [ ] Push notifications that carry no content
- [ ] Qualify recoverable updates, owner-controlled diagnostics and the exact packaged candidate (operations.md, verification.md)
- [ ] Qualify an upgrade through the installed app: a home the published release made, opened by its successor on
  each platform, with what the app says while steps run and when one fails. The migration runner's kill sweep
  (test/home-format.faults.test.ts) has not yet run in CI, and no build has a real step
- [ ] The daemon runs the checkout's code: merged work takes effect only at a restart
