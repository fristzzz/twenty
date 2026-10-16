#!/usr/bin/env python3
"""Upload all contract attachments from EspoCRM disk to Twenty CRM.
Maps attachment.parent_id -> contract -> Twenty targetTapdataContractId.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
import subprocess

API = "http://127.0.0.1:8091"
KEY_FILE = "/home/tapdata/app/twenty-deploy/spike-secrets.env"
DATA_DIR = "/home/tapdata/app/espocrm-fork/scripts/migration/data/espo"
UPLOAD_DIR = "/home/tapdata/app/espocrm-fork/data/upload"
WS_SCHEMA = "workspace_f3kbulr3ayp5xa7i6f93kbmeq"

def get_api_key():
    for line in open(KEY_FILE):
        if line.startswith("TWENTY_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("no api key found")

KEY = get_api_key()

def psql(sql):
    return subprocess.run(
        ["docker", "exec", "-i", "twenty-db-1", "psql", "-U", "postgres", "-d", "default", "-tA"],
        input=sql.encode("utf-8"), capture_output=True, check=True
    ).stdout.decode("utf-8").strip()

def post_meta(query):
    req = urllib.request.Request(
        f"{API}/metadata",
        data=json.dumps({"query": query}).encode("utf-8"),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    )
    return json.loads(urllib.request.urlopen(req, timeout=120).read())

def post_gql(query):
    req = urllib.request.Request(
        f"{API}/graphql",
        data=json.dumps({"query": query}).encode("utf-8"),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    )
    return json.loads(urllib.request.urlopen(req, timeout=120).read())

def main():
    print("=== Uploading Contract Attachments to Twenty CRM ===")
    
    # 1. Load contracts map
    contracts_by_id = {}
    for line in open(os.path.join(DATA_DIR, "tapdata_contract.ndjson"), "r", encoding="utf-8"):
        r = json.loads(line)
        contracts_by_id[r["id"]] = r

    # 2. Query Twenty contracts
    sql = f'SELECT id, "contractNumber", name FROM "{WS_SCHEMA}"."_tapdataContract"'
    out = psql(sql)
    twenty_by_cnum = {}
    twenty_by_name = {}
    for l in out.splitlines():
        if "|" in l:
            cid, cnum, cname = l.split("|", 2)
            if cnum:
                twenty_by_cnum[cnum] = cid
            if cname:
                twenty_by_name[cname] = cid

    print(f"Loaded {len(twenty_by_cnum)} Twenty contracts by number, {len(twenty_by_name)} by name.")

    # 3. Filter contract attachments
    atts = []
    for line in open(os.path.join(DATA_DIR, "attachment.ndjson"), "r", encoding="utf-8"):
        a = json.loads(line)
        if a.get("parent_type") == "TapdataContract":
            atts.append(a)

    print(f"Total contract attachments in Espo: {len(atts)}")
    
    uploaded = 0
    skipped = 0
    failed = 0

    for idx, a in enumerate(atts, 1):
        pid = a.get("parent_id")
        espo_con = contracts_by_id.get(pid)
        tw_cid = None
        if espo_con:
            cnum = espo_con.get("contract_number")
            cname = espo_con.get("name")
            if cnum and cnum in twenty_by_cnum:
                tw_cid = twenty_by_cnum[cnum]
            elif cname and cname in twenty_by_name:
                tw_cid = twenty_by_name[cname]

        fpath = os.path.join(UPLOAD_DIR, a["id"])
        if not tw_cid:
            print(f"[{idx}/{len(atts)}] SKIP (contract not found): {a['name']}")
            skipped += 1
            continue

        if not os.path.exists(fpath):
            print(f"[{idx}/{len(atts)}] SKIP (file missing on disk): {a['name']} at {fpath}")
            skipped += 1
            continue

        fname = a["name"]
        file_bytes = open(fpath, "rb").read()
        file_size = len(file_bytes)
        mime = a.get("type") or "application/octet-stream"

        try:
            # 1. createFileUpload
            q1 = f"""
            mutation {{
              createFileUpload(
                filename: {json.dumps(fname)}
                size: {file_size}
                fileFolder: FilesField
                fieldMetadataUniversalIdentifier: "20202020-15db-460e-8166-c7b5d87ad4be"
              ) {{
                fileId
                uploadUrl
              }}
            }}
            """
            r1 = post_meta(q1)
            target = r1["data"]["createFileUpload"]
            file_id = target["fileId"]
            raw_url = target["uploadUrl"]
            url = raw_url.replace("100.64.208.4:8091", "127.0.0.1:8091")

            # 2. PUT file bytes
            put_req = urllib.request.Request(url, data=file_bytes, method="PUT", headers={"Content-Type": mime})
            urllib.request.urlopen(put_req, timeout=120)

            # 3. completeFileUpload
            q2 = f"""
            mutation {{
              completeFileUpload(fileId: "{file_id}") {{
                id
              }}
            }}
            """
            post_meta(q2)

            # 4. createAttachment
            q3 = f"""
            mutation {{
              createAttachment(data: {{
                name: {json.dumps(fname)}
                file: [{{ fileId: "{file_id}", label: {json.dumps(fname)} }}]
                targetTapdataContractId: "{tw_cid}"
              }}) {{
                id
              }}
            }}
            """
            r3 = post_gql(q3)
            if r3.get("data", {}).get("createAttachment"):
                uploaded += 1
                if idx % 10 == 0 or idx == len(atts):
                    print(f"[{idx}/{len(atts)}] ✓ Uploaded {fname} ({file_size} bytes)")
            else:
                print(f"[{idx}/{len(atts)}] !! Attachment creation error on {fname}: {r3.get('errors')}")
                failed += 1
        except Exception as exc:
            print(f"[{idx}/{len(atts)}] !! Error on {fname}: {exc}")
            failed += 1

        time.sleep(0.3)

    print(f"\n=== Attachments Upload Summary ===")
    print(f"Total: {len(atts)}, Uploaded: {uploaded}, Skipped: {skipped}, Failed: {failed}")

if __name__ == "__main__":
    main()
