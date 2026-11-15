#!/bin/bash
# On a CI runner where the package is installed (release acceptance): use the app as the ordinary user who installed
# it, with what the release notes ask of an owner and nothing more: membership of the kvm group, taken up by signing
# in again (here, `sg kvm`), on a display and a session
# bus started for this run. The home and the port are the ones an owner gets: ~/.banda and the default.
#
#   runner.sh <out> [NAME=value ...]    the evidence folder, then drive.mjs's own settings (BANDA_TRY_COMPUTER=1 ...)
set -euo pipefail
out=$1
shift
here=$(cd "$(dirname "$0")" && pwd -P)
user=$(id -un)
# each requirement says so when it is not met: a bare `test` under `set -e` ends the run without a word
need() {
	local what=$1
	shift
	"$@" || {
		echo "runner.sh: $what" >&2
		ls -l /dev/kvm >&2 || true
		id >&2
		exit 1
	}
}
need "this runs as an ordinary user, not root" test "$(id -u)" -ne 0
need "the package is not installed at /opt/banda" test -x /opt/banda/banda-desktop
need "this machine has no /dev/kvm" test -c /dev/kvm
need "the user could not be added to the kvm group" sudo -n usermod -aG kvm "$user"
# the membership is taken up as signing in again would, with `sg`, which reads the group file as it is now: on
# Ubuntu 26.04 `sudo -u` to the same user keeps the groups the session started with
need "the user cannot read /dev/kvm after joining the kvm group" sg kvm -c "test -r /dev/kvm"
need "the user cannot write /dev/kvm after joining the kvm group" sg kvm -c "test -w /dev/kvm"
mkdir -p "$out"
# drive.mjs waits for display :99's socket: one left by a server that is gone would answer before the new one is up
if ! pgrep -x Xvfb >/dev/null; then
	sudo -n rm -f /tmp/.X11-unix/X99 /tmp/.X99-lock
fi
runtime=$(mktemp -d)
chmod 700 "$runtime"
command=$(printf '%q ' env -i \
	PATH=/usr/local/bin:/usr/bin:/bin \
	HOME="$HOME" \
	LANG=C.UTF-8 \
	XDG_RUNTIME_DIR="$runtime" \
	"$@" \
	dbus-run-session -- /opt/banda/resources/banda/node/node "$here/drive.mjs" x11 "$out")
exec sg kvm -c "$command"
