# A clean desktop of one distribution for `npm run desktop:linux`: a display to draw on (Xvfb, or Weston for Wayland),
# a session bus and an ordinary owner. Nothing the app needs is installed here: the package's own dependencies bring
# that, when linux.sh installs it.
ARG BASE=debian:bookworm-slim
FROM ${BASE}
RUN if command -v apt-get >/dev/null; then \
		apt-get update \
		&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb weston dbus dbus-x11 ca-certificates procps \
		&& rm -rf /var/lib/apt/lists/*; \
	else \
		dnf install -y --setopt=install_weak_deps=False xorg-x11-server-Xvfb weston dbus-daemon dbus-x11 procps-ng util-linux shadow-utils \
		&& dnf clean all; \
	fi
RUN useradd --create-home --shell /bin/bash owner
COPY linux.sh drive.mjs /try/
ENTRYPOINT ["/bin/bash", "/try/linux.sh"]
