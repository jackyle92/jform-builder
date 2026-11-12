#!/usr/bin/env bash
# Deploy JForm from source into an org, including a brand-new one, and set it up for a first form:
#   1. jform-core, and builder access (ACCESS_FORM_BUILDER) for the user running this script
#   2. the jform Experience site, from a temporary copy of jform-experience with this org's user as site
#      owner. A new org has no guest user licence until the site exists, so the first deploy leaves the
#      guest profile out; the site makes its own
#   3. guest access: JForm_Guest for the site's guest user
#   4. publish the site
# Optional: --with-agent also deploys the Agentforce topic, its actions and Describe it (jform-agent). Only
# for orgs with Einstein generative AI.
# Safe to run again: it redeploys and skips what is already assigned. The repository is never edited.
#
# usage: scripts/deploy-source.sh <org alias> [--with-agent]
set -euo pipefail
cd "$(dirname "$0")/.."
export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true SF_HIDE_RELEASE_NOTES=true
org="${1:?usage: scripts/deploy-source.sh <org alias> [--with-agent]}"
with_agent="${2:-}"

say()  { printf '%-8s %s\n' "$1" "$2"; }
json() { python3 -c "import json,sys; r=json.load(sys.stdin); $1"; }
deploy() {
  sf project deploy start -o "$org" "$@" --wait 30 --json 2>/dev/null | json "
res=r.get('result') or {}
if res.get('status')!='Succeeded':
    d=res.get('details') or {}; f=d.get('componentFailures') or []; f=[f] if isinstance(f,dict) else f
    print('FAILED', (r.get('message') or '')[:300]); [print('   ', x.get('fullName'), (x.get('problem') or '')[:200]) for x in f[:8]]; sys.exit(1)"
}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

user=$(sf org display -o "$org" --json | json 'print(r["result"]["username"])')
email=$(sf data query -o "$org" --json -q "SELECT Email FROM User WHERE Username = '$user'" | json 'print(r["result"]["records"][0]["Email"])')

# 1. core and builder access
deploy -d jform-core
say "DONE" "jform-core deployed"
if [ "$with_agent" = "--with-agent" ]; then
  deploy -x manifest/jform-agent.xml
  say "DONE" "jform-agent deployed (topic, actions, Describe it)"
fi
sf org assign permset -o "$org" -n ACCESS_FORM_BUILDER --json >/dev/null 2>&1 || true
say "DONE" "ACCESS_FORM_BUILDER assigned to $user (assign it to every form builder, admins too)"

# 2. the site
sites=$(sf data query -o "$org" --json -q "SELECT COUNT() FROM Site WHERE Name = 'jform'" | json 'print(r["result"]["totalSize"])')
cp -R jform-experience "$tmp/"
[ "$sites" = "0" ] && rm -rf "$tmp/jform-experience/main/default/profiles"
printf '{ "packageDirectories": [{ "path": "jform-experience", "default": true }], "namespace": "", "sourceApiVersion": "66.0" }\n' > "$tmp/sfdx-project.json"
SITE_OWNER="$user" SITE_EMAIL="$email" python3 - "$tmp/jform-experience" <<'PY'
import os, re, sys
root, user, email = sys.argv[1], os.environ["SITE_OWNER"], os.environ["SITE_EMAIL"]
for d, _, files in os.walk(root):
    for f in files:
        if f.endswith((".json", ".xml")):
            p = os.path.join(d, f); s = open(p, encoding="utf-8").read()
            t = s.replace("jform.site.owner@example.com", user)
            if f.endswith("network-meta.xml"):
                t = re.sub(r"<emailSenderAddress>[^<]*</emailSenderAddress>", f"<emailSenderAddress>{email}</emailSenderAddress>", t)
            if t != s:
                open(p, "w", encoding="utf-8").write(t)
PY
(cd "$tmp" && deploy -d jform-experience)
say "DONE" "jform site deployed"

# 3. guest access
guest=$(sf data query -o "$org" --json -q "SELECT GuestUserId FROM Site WHERE Name = 'jform'" | json 'print(r["result"]["records"][0]["GuestUserId"])')
ps=$(sf data query -o "$org" --json -q "SELECT Id FROM PermissionSet WHERE Name = 'JForm_Guest' AND NamespacePrefix = null" | json 'print(r["result"]["records"][0]["Id"])')
sf data create record -o "$org" -s PermissionSetAssignment -v "AssigneeId=$guest PermissionSetId=$ps" --json >/dev/null 2>&1 || true
say "DONE" "JForm_Guest assigned to the site's guest user"

# 4. publish
sf community publish -o "$org" --name jform --json >/dev/null && say "DONE" "site publish started (takes a minute; publish again if the page still redirects to login)"
echo
say "NEXT" "Open the JForm app, create a form and publish it. The Setup tab lists the optional settings."
