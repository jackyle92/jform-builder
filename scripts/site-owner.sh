#!/usr/bin/env bash
# Point the jform site metadata at a user of the target org before deploying jform-experience.
# CustomSite and Network metadata name real users, so the repo carries placeholders and this fills them in.
#   scripts/site-owner.sh <org alias>      then   sf project deploy start -o <org alias> -d jform-experience
#   scripts/site-owner.sh --reset          puts the placeholders back (do this before committing)
set -euo pipefail
cd "$(dirname "$0")/.."
site=jform-experience/main/default/sites/jform.site-meta.xml
network=jform-experience/main/default/networks/jform.network-meta.xml
if [ "${1:-}" = "--reset" ]; then
  username="jform.site.owner@example.com"; email="jform.site.owner@example.com"
else
  org="${1:?usage: scripts/site-owner.sh <org alias> | --reset}"
  username=$(sf org display -o "$org" --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["username"])')
  email=$(sf data query -o "$org" --json -q "SELECT Email FROM User WHERE Username = '$username'" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["records"][0]["Email"])')
fi
SITE_OWNER="$username" SITE_EMAIL="$email" python3 - "$site" "$network" <<'PY'
import os, re, sys
site, network = sys.argv[1], sys.argv[2]
user, email = os.environ["SITE_OWNER"], os.environ["SITE_EMAIL"]
s = open(site).read()
s = re.sub(r"<siteAdmin>[^<]*</siteAdmin>", f"<siteAdmin>{user}</siteAdmin>", s)
s = re.sub(r"<siteGuestRecordDefaultOwner>[^<]*</siteGuestRecordDefaultOwner>", f"<siteGuestRecordDefaultOwner>{user}</siteGuestRecordDefaultOwner>", s)
open(site, "w").write(s)
n = open(network).read()
n = re.sub(r"<emailSenderAddress>[^<]*</emailSenderAddress>", f"<emailSenderAddress>{email}</emailSenderAddress>", n)
open(network, "w").write(n)
PY
echo "jform site owner set to $username <$email>"
[ "${1:-}" = "--reset" ] || echo "deploy with: sf project deploy start -o $org -d jform-experience   (then sf community publish --name jform)"
