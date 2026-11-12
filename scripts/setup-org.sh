#!/usr/bin/env bash
# Minimal setup after installing the JForm package in an org, so a first form can be published:
#   1. builder access   ACCESS_FORM_BUILDER for the user running this script
#   2. public site      the "jform" Experience site from the jform-experience template
#   3. guest access     JForm_Guest for the site's guest user, and JForm_Payment_Credentials (the org's own permission
#                       set with Read on User External Credentials, which installed permission sets lose) for the guest
#                       user and the user running this script when they lack that Read, so Stripe callouts work
#   4. publish          the site, so the form page is live
# Safe to run again: finished steps are skipped. The repository's template is never edited;
# a temporary copy gets the namespaced component names and this org's site owner.
#
# usage: scripts/setup-org.sh <org alias>
set -euo pipefail
cd "$(dirname "$0")/.."
export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true SF_HIDE_RELEASE_NOTES=true
org="${1:?usage: scripts/setup-org.sh <org alias>}"
ns=jform

say()  { printf '%-8s %s\n' "$1" "$2"; }
json() { python3 -c "import json,sys; r=json.load(sys.stdin); $1"; }
count() {
  sf data query -o "$org" --json -q "$1" 2>/dev/null | json 'print(r["result"]["totalSize"] if r.get("status")==0 else -1)' || echo -1
}

# 0. the package
version=$(sf package installed list -o "$org" --json 2>/dev/null | json "print(next((p['SubscriberPackageVersionNumber'] for p in r.get('result',[]) if p.get('SubscriberPackageNamespace')=='$ns'), ''))")
if [ -z "$version" ]; then
  say "MISSING" "JForm is not installed in $org. Install it first (see README.md), then run this again."
  exit 1
fi
say "OK" "JForm $version installed"

user=$(sf org display -o "$org" --json | json 'print(r["result"]["username"])')
email=$(sf data query -o "$org" --json -q "SELECT Email FROM User WHERE Username = '$user'" | json 'print(r["result"]["records"][0]["Email"])')

# 1. builder access
if [ "$(count "SELECT COUNT() FROM PermissionSetAssignment WHERE Assignee.Username = '$user' AND PermissionSet.Name = 'ACCESS_FORM_BUILDER' AND PermissionSet.NamespacePrefix = '$ns'")" = "0" ]; then
  sf org assign permset -o "$org" -n ACCESS_FORM_BUILDER --json >/dev/null
  say "DONE" "ACCESS_FORM_BUILDER assigned to $user (assign it to every form builder too)"
else
  say "OK" "$user already has ACCESS_FORM_BUILDER"
fi

# 2. Digital Experiences, then the site
if [ "$(count "SELECT COUNT() FROM Network")" = "-1" ]; then
  say "ACTION" "Digital Experiences is not enabled. Setup > Digital Experiences > Settings > Enable Digital Experiences, pick a domain, Save. Then run this again."
  exit 1
fi
if [ "$(count "SELECT COUNT() FROM Site WHERE Name = 'jform'")" = "0" ]; then
  work=$(mktemp -d)
  cp -R jform-experience "$work/"
  rm -rf "$work/jform-experience/main/default/profiles"   # the site creates its own guest profile
  printf '{ "packageDirectories": [{ "path": "jform-experience", "default": true }], "namespace": "", "sourceApiVersion": "66.0" }\n' > "$work/sfdx-project.json"
  SITE_OWNER="$user" SITE_EMAIL="$email" NS="$ns" python3 - "$work/jform-experience" <<'PY'
import os, re, sys
root, user, email, ns = sys.argv[1], os.environ["SITE_OWNER"], os.environ["SITE_EMAIL"], os.environ["NS"]
for d, _, files in os.walk(root):
    for f in files:
        if not f.endswith((".json", ".xml")):
            continue
        p = os.path.join(d, f)
        s = open(p, encoding="utf-8").read()
        t = s.replace('"c:jformRenderer"', f'"{ns}:jformRenderer"').replace("jform.site.owner@example.com", user)
        if f.endswith("network-meta.xml"):
            t = re.sub(r"<emailSenderAddress>[^<]*</emailSenderAddress>", f"<emailSenderAddress>{email}</emailSenderAddress>", t)
        if t != s:
            open(p, "w", encoding="utf-8").write(t)
PY
  result=$( (cd "$work" && sf project deploy start -o "$org" -d jform-experience --wait 30 --json 2>/dev/null) || true)
  echo "$result" | json "
res=r.get('result') or {}
fails=res.get('details',{}).get('componentFailures',[]) if isinstance(res.get('details'),dict) else []
if res.get('status')!='Succeeded':
    print('FAILED   site deploy:', (r.get('message') or '')[:300])
    for e in fails[:8]: print('         ', e.get('componentType'), e.get('fullName'), (e.get('problem') or '')[:200])
    sys.exit(1)
print('DONE     jform site created from the template')"
  rm -rf "$work"
else
  say "OK" "jform site exists"
fi

# 3. guest access
guest=$(sf data query -o "$org" --json -q "SELECT GuestUserId FROM Site WHERE Name = 'jform'" | json 'print(r["result"]["records"][0]["GuestUserId"])')
if [ "$(count "SELECT COUNT() FROM PermissionSetAssignment WHERE AssigneeId = '$guest' AND PermissionSet.Name = 'JForm_Guest' AND PermissionSet.NamespacePrefix = '$ns'")" = "0" ]; then
  ps=$(sf data query -o "$org" --json -q "SELECT Id FROM PermissionSet WHERE Name = 'JForm_Guest' AND NamespacePrefix = '$ns'" | json 'print(r["result"]["records"][0]["Id"])')
  sf data create record -o "$org" -s PermissionSetAssignment -v "AssigneeId=$guest PermissionSetId=$ps" --json >/dev/null
  say "DONE" "JForm_Guest assigned to the site's guest user"
else
  say "OK" "guest user already has JForm_Guest"
fi
# Stripe callouts need Read on User External Credentials, which Salesforce drops from installed permission sets
can_pay() {
  count "SELECT COUNT() FROM PermissionSetAssignment WHERE AssigneeId = '$1' AND PermissionSetId IN (SELECT ParentId FROM ObjectPermissions WHERE SobjectType = 'UserExternalCredential' AND PermissionsRead = true)"
}
me=$(sf data query -o "$org" --json -q "SELECT Id FROM User WHERE Username = '$user'" | json 'print(r["result"]["records"][0]["Id"])')
for who in "$guest" "$me"; do
  [ "$(can_pay "$who")" = "0" ] || continue
  cps=$(sf data query -o "$org" --json -q "SELECT Id FROM PermissionSet WHERE Name = 'JForm_Payment_Credentials' AND NamespacePrefix = null" | json 'print(r["result"]["records"][0]["Id"] if r["result"]["records"] else "")')
  if [ -z "$cps" ]; then
    cps=$(sf data create record -o "$org" -s PermissionSet --json -v "Name=JForm_Payment_Credentials Label='JForm Payment Credentials' Description='Read on User External Credentials, which Stripe callouts need and installed permission sets cannot carry. Created by JForm.'" | json 'print(r["result"]["id"])')
    sf data create record -o "$org" -s ObjectPermissions --json -v "ParentId=$cps SobjectType=UserExternalCredential PermissionsRead=true" >/dev/null
    say "DONE" "JForm_Payment_Credentials created"
  fi
  sf data create record -o "$org" -s PermissionSetAssignment -v "AssigneeId=$who PermissionSetId=$cps" --json >/dev/null
  if [ "$who" = "$guest" ]; then say "DONE" "JForm_Payment_Credentials assigned to the site's guest user"; else say "DONE" "JForm_Payment_Credentials assigned to $user"; fi
done

# 4. publish
sf community publish -o "$org" --name jform --json >/dev/null && say "DONE" "site publish started (takes a minute)"

domain=$(sf data query -o "$org" --json -q "SELECT Domain FROM Domain" | json "print(next((d['Domain'] for d in r['result']['records'] if d['Domain'].endswith('.site.com')), ''))")
echo
say "NEXT" "Open the JForm app > Form Workspace, create a form, publish it."
[ -n "$domain" ] && say "" "Public links look like https://$domain/jform/form?key=<public key>"
echo
say "LATER" "Optional, when you need them (README.md):"
say "" "- spam timing tokens and reCAPTCHA: org default of the Protection Settings custom setting"
say "" "- file upload and signature fields: Setup > Salesforce Files > General Settings > Allow site guest users to upload files"
say "" "- Describe it and the assistant: install JForm Agent in an org with Einstein generative AI"
