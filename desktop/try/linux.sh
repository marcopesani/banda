#!/bin/bash
# Inside a clean distribution (linux.Dockerfile): install the package as its owner would, with only the dependencies it
# declares, then use the app as an ordinary user on a display. /package holds the one package; /out takes the evidence.
set -euo pipefail
session=${1:-x11}
package=$(find /package -maxdepth 1 -type f \( -name '*.deb' -o -name '*.rpm' \) | head -n 1)
test -n "$package"
{
	cat /etc/os-release
	if command -v apt-get >/dev/null; then
		apt-get update
		DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$package"
	else
		dnf install -y --setopt=install_weak_deps=False "$package"
	fi
} >/out/install.log 2>&1 || {
	tail -n 40 /out/install.log
	echo "the package did not install"
	exit 1
}
chown owner /out
runtime=/run/user/$(id -u owner)
mkdir -p "$runtime"
chown owner "$runtime"
chmod 700 "$runtime"
exec su owner -c "cd && XDG_RUNTIME_DIR=$runtime dbus-run-session -- /opt/banda/resources/banda/node/node /try/drive.mjs $session /out"
