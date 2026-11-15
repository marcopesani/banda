Unsigned pre-release for Apple silicon Macs on macOS 14 or newer, and for Linux x64 on Debian 12 or newer and Ubuntu 22.04 or newer.

- Each agent's computer is a small virtual machine banda ships. It starts with the app, and with `banda serve`; Docker is not required. `banda serve --box container` still uses Docker when asked.
- The browser downloads on first use. General settings shows its preparation and running pages.
- Files and installed tools persist under `~/.banda/computer`.
- Settings, General, Backups takes a backup of everything banda keeps, lists the backups in `~/.banda-backups` and restores one: banda starts again with it, and the home it replaced is kept there until you delete it. A backup is not encrypted and holds your keys and sign-ins.

**Mac.** Open the DMG and drag banda to Applications. This build is not signed with an Apple Developer ID and not notarized, so macOS refuses to open it the first time. Follow [Apple's instructions for opening an unidentified app](https://support.apple.com/en-us/102445) (System Settings, Privacy & Security, Open Anyway) if you choose to install it.

**Updating.** banda does not update itself. To update, download the new release and install it over the old one.

**Linux.** Install the package with `sudo apt install ./banda-*-linux-amd64.deb`. The computer needs hardware virtualization: your account must be able to read and write `/dev/kvm` (on most distributions, `sudo usermod -aG kvm $USER`, then sign in again). It runs under X11 and Wayland.

**Coming from an earlier pre-release.** A home whose computer ran in Docker brings its workspace, work folder and installed tools into `~/.banda/computer` the first time this version opens it, if Docker is running then; the Docker volumes are only read and stay where they are. The browser's signed-in sites are not brought. Keep a backup of an existing `~/.banda` before upgrading; a home from a much older pre-release may still need a fresh start.

The command-line archive includes Node.js. Unpack it and put `banda/bin` on your PATH. The desktop app and `banda serve` use the same home.

`SHA256SUMS` covers every file here. The Mac and Linux downloads carry a virtual machine with a Linux kernel and Debian guest images. Their source code and license notices are the `banda-*-sources-*.tar` and `banda-*-notices.tar` files of this release, and `release-materials.json` binds them to each download by SHA-256. `RELEASE-SOURCES.md` says what they hold, what they leave out and how to check them. The release workflow assembled them; no person reviewed this set before publication.

Each download also carries the third-party license notices for what is inside it: `banda/app/licenses` in the command-line archive, and the same folder inside the desktop app, which its tray menu opens (Third-party licenses). `README.txt` there says which file covers what. The desktop app includes FFmpeg as a shared library built by Electron, licensed under the LGPL, version 2.1 or later; its source code is in the `banda-*-sources-*.tar` files.
