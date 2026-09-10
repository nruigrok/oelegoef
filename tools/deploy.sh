#!/usr/bin/env bash
# Deploys the current main branch to oelegoef.vanatteveldt.com.
#
# The site runs on societal-analytics.labs.vu.nl: Caddy terminates HTTPS and proxies
# oelegoef.vanatteveldt.com to localhost:3003, where systemd unit oelegoef.service runs
# `node dist/index.js` from /home/nel/oelegoef/server as user nel, on Node 24 installed
# via nvm for that user. This script pulls, builds and restarts there.
#
#   tools/deploy.sh            # deploy origin/main
set -euo pipefail

HOST="${DEPLOY_HOST:-nel@societal-analytics.labs.vu.nl}"

ssh -o BatchMode=yes "$HOST" bash -s <<'EOF'
set -euo pipefail
. ~/.nvm/nvm.sh
cd ~/oelegoef
git pull -q --ff-only
echo "deploying $(git log --oneline -1)"
npm ci --no-audit --no-fund >/dev/null
npm run build >/dev/null
sudo systemctl restart oelegoef.service
sleep 2
systemctl is-active oelegoef.service
curl -s -o /dev/null -w "local http %{http_code}\n" http://localhost:3003/
EOF

curl -s -o /dev/null -w "https://oelegoef.vanatteveldt.com -> %{http_code}\n" https://oelegoef.vanatteveldt.com/
