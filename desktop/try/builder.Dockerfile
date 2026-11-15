# The machine `npm run desktop:linux` builds the Linux desktop app on: Node.js as mise.toml names it, Docker's client
# (the computer's images and its runtime build run on the engine whose socket is mounted in), and fpm, which
# electron-builder ships only for x64.
FROM docker:29-cli AS docker
FROM node:26-bookworm
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ruby ruby-dev build-essential rpm patch python3 git ca-certificates xz-utils \
	&& gem install --no-document fpm -v 1.16.0 \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
ENV USE_SYSTEM_FPM=true CSC_IDENTITY_AUTO_DISCOVERY=false npm_config_update_notifier=false
