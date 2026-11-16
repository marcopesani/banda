#!/bin/sh
# Git for the computer banda ships, staged as an agent installs software there: under /tools, without root. Its box
# image carries no git, so the git suite brings one: Debian's own, with the libraries it loads, taken from the box's
# image itself so they match it, behind a wrapper in /tools/bin. Then it is tried as the box's user on that image,
# with /tools read-only, so a git that cannot run fails here and not in a suite.
#
# Usage: box-git.sh <box image> <fresh folder>. The folder's contents belong in a home's /tools; `BANDA_TEST_BOX_TOOLS`
# names it to the box suites (test/fixtures/real-box.ts).
set -eu
if [ "$#" -ne 2 ]; then
	printf '%s\n' 'Usage: box-git.sh <box image> <fresh folder>' >&2
	exit 1
fi
image=$1
mkdir "$2"
out=$(cd "$2" && pwd)

docker run --rm --interactive --user 0 --env "OWNER=$(id -u):$(id -g)" --env DEBIAN_FRONTEND=noninteractive \
	--volume "$out:/out" --entrypoint /bin/sh "$image" -eu -s <<'STAGE'
# a script read from stdin: nothing it runs may read the rest of it
apt-get update -q < /dev/null
apt-get install -y -q --no-install-recommends git < /dev/null
mkdir -p /out/bin /out/git/libexec /out/git/lib
cp -L /usr/lib/git-core/git /usr/lib/git-core/git-remote-http /out/git/libexec/
ln -s git-remote-http /out/git/libexec/git-remote-https
cp -R /usr/share/git-core/templates /out/git/templates
# every library they load, but the C library's own: those stay the box's, which its loader belongs to
for binary in /out/git/libexec/git /out/git/libexec/git-remote-http; do ldd "$binary"; done |
	awk '$2 == "=>" && $3 ~ /^\// { print $3 }' | sort -u |
	while read -r library; do
		case "${library##*/}" in
			libc.so.* | libm.so.* | libdl.so.* | libpthread.so.* | librt.so.* | libresolv.so.*) ;;
			*) cp -L "$library" /out/git/lib/ ;;
		esac
	done
# as the container's image sets them for its own git (box/Dockerfile)
printf '%s\n' '[user]' '	name = banda' '	email = banda@box' '[safe]' '	directory = *' > /out/git/gitconfig
cat > /out/bin/git <<'WRAPPER'
#!/bin/sh
# git under /tools, as an agent installs software on this computer: its own libraries, helpers and settings
LD_LIBRARY_PATH=/tools/git/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
GIT_EXEC_PATH=/tools/git/libexec
GIT_TEMPLATE_DIR=/tools/git/templates
GIT_CONFIG_SYSTEM=/tools/git/gitconfig
export LD_LIBRARY_PATH GIT_EXEC_PATH GIT_TEMPLATE_DIR GIT_CONFIG_SYSTEM
exec /tools/git/libexec/git "$@"
WRAPPER
chmod 0755 /out/bin/git
chown -R "$OWNER" /out
STAGE

docker run --rm --interactive --user 1000:1000 --volume "$out:/tools:ro" --entrypoint /bin/sh "$image" -eu -s <<'TRY'
command -v git
git --version
git init -q /tmp/probe < /dev/null
git -C /tmp/probe commit -q --allow-empty -m probe < /dev/null
git -C /tmp/probe log --format='%an <%ae> %s' < /dev/null
# its HTTP helper loads too: without a remote it says how it is used
git remote-http 2>&1 < /dev/null | grep 'usage: git remote-curl'
TRY
