#!/usr/bin/env bash
# Install ur-remote/ (Arno.PrimeSearch) on the Unified Remote Mac over SSH,
# reload the UR server, and optionally run an action and show its log lines.
#
#   ./ur-deploy.sh                       # install + reload
#   ./ur-deploy.sh run audio             # run an action (no install)
#   ./ur-deploy.sh log                   # last PrimeSearch log lines
#   UR_SSH=user@host ./ur-deploy.sh      # other Mac (default arno@192.168.1.111)
set -euo pipefail
cd "$(dirname "$0")"

SSH_TARGET="${UR_SSH:-arno@192.168.1.111}"
UR_HOST="${SSH_TARGET#*@}"
UR_URL="http://$UR_HOST:9510"
TVCTL="${TVCTL:-http://localhost:8765}"   # tvctl server, does the UR handshake
DIR='Library/Application Support/Unified Remote/Remotes/Custom/PrimeSearch'

log() {
	curl -s -m 10 "$UR_URL/system/log/60/8/" | grep 'Lua: PrimeSearch\|LuaInstance' | grep -v 'Output:' | head -"${1:-6}"
}

case "${1:-install}" in
install)
	ssh "$SSH_TARGET" "mkdir -p ~/'$DIR' && cp -R ~/'$DIR' /tmp/PrimeSearch.bak-\$(date +%s)"
	# cat over ssh: scp mangles the spaces in the path
	for f in meta.prop layout.xml remote.lua; do
		ssh "$SSH_TARGET" "cat > ~/'$DIR'/$f" < "ur-remote/$f"
	done
	[ "$(ssh "$SSH_TARGET" "md5 -q ~/'$DIR'/remote.lua")" = "$(md5sum < ur-remote/remote.lua | cut -d' ' -f1)" ] \
		|| { echo "checksum mismatch after copy" >&2; exit 1; }
	curl -s -m 10 "$UR_URL/system/reload" > /dev/null
	echo "installed on $SSH_TARGET and reloaded $UR_URL (backup in /tmp/PrimeSearch.bak-* on the Mac)"
	;;
run)
	curl -s -m 30 -X POST "$TVCTL/api/ur/run" -H 'Content-Type: application/json' \
		-d "{\"baseUrl\":\"$UR_URL\",\"id\":\"Arno.PrimeSearch\",\"name\":\"$2\"}" > /dev/null
	sleep "${WAIT:-8}"   # runs get no reply; give the action time to log
	log 3
	;;
log)
	log "${2:-10}"
	;;
*)
	sed -n '2,8p' "$0"; exit 1
	;;
esac
