#!/usr/bin/env python3
"""Finish Tasks migration and gap-fill companies and opportunities to 100% exact parity.
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
USER_MAP_FILE = "/home/tapdata/app/twenty-deploy/user_map.json"
DATA_DIR = "/home/tapdata/app/espocrm-fork/scripts/migration/data/espo"
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

def load_ndjson(name):
    path = os.path.join(DATA_DIR, f"{name}.ndjson")
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows

def format_datetime(s):
    if not s:
        return None
    s = s.strip()
    if " " in s:
        d, t = s.split(" ", 1)
        t = t.split(".")[0]
        return f"{d}T{t}.000Z"
    if "T" in s:
        return s.split(".")[0] + ".000Z"
    return f"{s}T00:00:00.000Z"

def money(val, curr):
    if val is None or val == "":
        return None
    try:
        amt = float(val)
    except (ValueError, TypeError):
        return None
    c = (curr or "CNY").strip() or "CNY"
    return {"amountMicros": round(amt * 1_000_000), "currencyCode": c}

STAGE_MAP = {
    "Closed Won": "CUSTOMER",
    "Closed Lost": "LOST",
    "Prospecting": "NEW",
    "Negotiation": "NEGOTIATION",
    "Proposal": "PROPOSAL",
    "Review": "REVIEW",
}

TASK_STATUS_MAP = {
    "Not Started": "TODO",
    "Started": "IN_PROGRESS",
    "Completed": "DONE",
}

TASK_PRIORITY_MAP = {
    "High": "HIGH",
    "Normal": "NORMAL",
    "Low": "LOW",
}

def gql_literal(obj):
    if obj is None:
        return "null"
    if isinstance(obj, bool):
        return "true" if obj else "false"
    if isinstance(obj, (int, float)):
        return str(obj)
    if isinstance(obj, str):
        return json.dumps(obj, ensure_ascii=False)
    if isinstance(obj, list):
        return "[" + ", ".join(gql_literal(x) for x in obj) + "]"
    if isinstance(obj, dict):
        pairs = []
        for k, v in obj.items():
            if v is not None:
                pairs.append(f"{k}: {gql_literal(v)}")
        return "{" + ", ".join(pairs) + "}"
    return json.dumps(obj, ensure_ascii=False)

def gql_create(mutation, rows, chunk=40, pace=0.6):
    ids = []
    total = (len(rows) + chunk - 1) // chunk
    for i in range(0, len(rows), chunk):
        batch = rows[i:i + chunk]
        query = f"mutation {{ {mutation}(data: {gql_literal(batch)}) {{ id }} }}"
        payload = None
        for attempt in range(5):
            req = urllib.request.Request(
                API + "/graphql",
                data=json.dumps({"query": query}).encode("utf-8"),
                method="POST",
                headers={
                    "Authorization": f"Bearer {KEY}",
                    "Content-Type": "application/json"
                }
            )
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    payload = json.loads(resp.read().decode("utf-8") or "{}")
                break
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", errors="ignore")[:300]
                if e.code == 429 and attempt < 4:
                    wait_sec = 12 * (attempt + 1)
                    print(f"    [429 rate limit] backing off {wait_sec}s...", file=sys.stderr)
                    time.sleep(wait_sec)
                    continue
                print(f"    !! HTTPError {e.code} on {mutation}: {detail}", file=sys.stderr)
                break
            except Exception as exc:
                print(f"    !! Exception on {mutation} attempt {attempt}: {exc}", file=sys.stderr)
                time.sleep(3)
                continue

        if payload and payload.get("errors"):
            print(f"    !! GraphQL errors on {mutation} batch {i//chunk + 1}/{total}: {json.dumps(payload['errors'])[:400]}", file=sys.stderr)
            created = []
        else:
            created = (payload or {}).get("data", {}).get(mutation) or []

        batch_ids = [row["id"] for row in created]
        ids.extend(batch_ids)
        if (i // chunk + 1) % 15 == 0 or (i // chunk + 1) == total:
            print(f"    progress: {min(i + chunk, len(rows))}/{len(rows)} ({mutation})")
        time.sleep(pace)
    return ids

def main():
    print("=== Completing Tasks and Reconciling Counts ===")
    with open(USER_MAP_FILE, "r", encoding="utf-8") as f:
        user_map = json.load(f)

    # 1. Company Map
    company_out = psql(f'SELECT id, name FROM "{WS_SCHEMA}"."company"')
    twenty_companies_by_name = {}
    for line in company_out.splitlines():
        if "|" in line:
            cid, cname = line.split("|", 1)
            twenty_companies_by_name[cname] = cid

    # 2. People Map
    person_out = psql(f'SELECT id, "nameFirstName", "nameLastName" FROM "{WS_SCHEMA}"."person"')
    twenty_people_by_name = {}
    for line in person_out.splitlines():
        if "|" in line:
            parts = line.split("|")
            pid = parts[0]
            first = parts[1] if len(parts) > 1 else ""
            last = parts[2] if len(parts) > 2 else ""
            full = f"{first} {last}".strip()
            twenty_people_by_name[full] = pid

    # Check missing companies
    accounts = load_ndjson("account")
    print(f"Accounts in Espo: {len(accounts)}, Companies currently in Twenty: {len(twenty_companies_by_name)}")
    missing_accounts = [a for a in accounts if a["name"] not in twenty_companies_by_name]
    print(f"Missing companies to insert: {len(missing_accounts)}")
    if missing_accounts:
        missing_rows = []
        for a in missing_accounts:
            row = {"name": a["name"]}
            assignee = a.get("assigned_user_id")
            if assignee and assignee in user_map:
                row["accountOwnerId"] = user_map[assignee]["workspaceMemberId"]
            missing_rows.append(row)
        cids = gql_create("createCompanies", missing_rows)
        print(f"✓ Added {len(cids)} missing companies.")
        # Refresh map
        company_out = psql(f'SELECT id, name FROM "{WS_SCHEMA}"."company"')
        twenty_companies_by_name = {}
        for line in company_out.splitlines():
            if "|" in line:
                cid, cname = line.split("|", 1)
                twenty_companies_by_name[cname] = cid

    # Check missing opportunities
    opps = load_ndjson("opportunity")
    curr_opp_count = int(psql(f'SELECT count(*) FROM "{WS_SCHEMA}"."opportunity"'))
    print(f"Opportunities in Espo: {len(opps)}, currently in Twenty: {curr_opp_count}")
    if curr_opp_count < len(opps):
        opp_out = psql(f'SELECT id, name FROM "{WS_SCHEMA}"."opportunity"')
        twenty_opps_by_name = set(l.split("|", 1)[1] for l in opp_out.splitlines() if "|" in l)
        missing_opps = [o for o in opps if (o["name"] or "未命名商机") not in twenty_opps_by_name]
        print(f"Missing opportunities to insert: {len(missing_opps)}")
        if missing_opps:
            missing_opp_rows = []
            for o in missing_opps:
                row = {"name": o["name"] or "未命名商机"}
                if o.get("amount") is not None:
                    row["amount"] = money(o.get("amount"), o.get("amount_currency"))
                if o.get("close_date"):
                    row["closeDate"] = f"{o['close_date']}T00:00:00.000Z"
                stage_raw = o.get("stage")
                row["stage"] = STAGE_MAP.get(stage_raw, "NEW")
                aid = o.get("account_id")
                # find company name from accounts
                for acc in accounts:
                    if acc["id"] == aid:
                        if acc["name"] in twenty_companies_by_name:
                            row["companyId"] = twenty_companies_by_name[acc["name"]]
                        break
                assignee = o.get("assigned_user_id")
                if assignee and assignee in user_map:
                    row["ownerId"] = user_map[assignee]["workspaceMemberId"]
                missing_opp_rows.append(row)
            oids = gql_create("createOpportunities", missing_opp_rows)
            print(f"✓ Added {len(oids)} missing opportunities.")

    # 3. Tasks (2,475)
    tasks = load_ndjson("task")
    curr_tasks = int(psql(f'SELECT count(*) FROM "{WS_SCHEMA}"."task"'))
    print(f"\nTasks in Espo: {len(tasks)}, currently in Twenty: {curr_tasks}")
    if curr_tasks < len(tasks):
        print(f"Migrating {len(tasks)} Tasks...")
        task_rows = []
        task_targets_pending = []
        for t in tasks:
            row = {
                "title": t.get("name") or "未命名任务",
                "status": TASK_STATUS_MAP.get(t.get("status"), "TODO"),
            }
            if t.get("priority"):
                row["priority"] = TASK_PRIORITY_MAP.get(t.get("priority"), "NORMAL")
            if t.get("date_end"):
                row["dueAt"] = format_datetime(t["date_end"])
            if t.get("description"):
                row["bodyV2"] = {"markdown": t["description"]}

            assignee = t.get("assigned_user_id")
            if assignee and assignee in user_map:
                row["assigneeId"] = user_map[assignee]["workspaceMemberId"]

            task_rows.append(row)

        task_ids = gql_create("createTasks", task_rows, chunk=40, pace=0.5)
        print(f"✓ Tasks created: {len(task_ids)} / {len(tasks)}")

        # Link Task Targets
        account_id_to_name = {a["id"]: a["name"] for a in accounts}
        contacts = load_ndjson("contact")
        contact_id_to_name = {c["id"]: f"{c.get('first_name') or ''} {c.get('last_name') or ''}".strip() for c in contacts}

        for t, tw_tid in zip(tasks, task_ids):
            aid = t.get("account_id")
            cid = t.get("contact_id")
            if aid and aid in account_id_to_name:
                aname = account_id_to_name[aid]
                if aname in twenty_companies_by_name:
                    task_targets_pending.append({"taskId": tw_tid, "targetCompanyId": twenty_companies_by_name[aname]})
            if cid and cid in contact_id_to_name:
                cname = contact_id_to_name[cid]
                if cname in twenty_people_by_name:
                    task_targets_pending.append({"taskId": tw_tid, "targetPersonId": twenty_people_by_name[cname]})

        if task_targets_pending:
            print(f"  Linking {len(task_targets_pending)} task targets...")
            gql_create("createTaskTargets", task_targets_pending, chunk=40, pace=0.5)
            print("  ✓ Task targets linked")

    print("\n=== Verification of DB Counts ===")
    counts_sql = f"""
    SELECT 'company', count(*) FROM "{WS_SCHEMA}"."company"
    UNION ALL SELECT 'person', count(*) FROM "{WS_SCHEMA}"."person"
    UNION ALL SELECT 'opportunity', count(*) FROM "{WS_SCHEMA}"."opportunity"
    UNION ALL SELECT 'lead', count(*) FROM "{WS_SCHEMA}"."_tapdataLead"
    UNION ALL SELECT 'task', count(*) FROM "{WS_SCHEMA}"."task"
    UNION ALL SELECT 'product', count(*) FROM "{WS_SCHEMA}"."_tapdataProduct"
    UNION ALL SELECT 'quote', count(*) FROM "{WS_SCHEMA}"."_tapdataQuote"
    UNION ALL SELECT 'contract', count(*) FROM "{WS_SCHEMA}"."_tapdataContract"
    UNION ALL SELECT 'installment', count(*) FROM "{WS_SCHEMA}"."_tapdataInstallment"
    UNION ALL SELECT 'receipt', count(*) FROM "{WS_SCHEMA}"."_tapdataReceipt";
    """
    print(psql(counts_sql))

if __name__ == "__main__":
    main()
