#!/usr/bin/env python3
"""Align Twenty CRM records with original Zoho CRM historical timestamps.
Restores real 2019-2026 Created_Time, Modified_Time, Closing_Date, and Due_Date,
fixing timezone distortion (UTC midnight cross-day shift) and import-time flattening.
"""

import json
import subprocess
import sys

D_ZOHO = "/home/kenny/app/twenty-deploy/data/zoho/"
D_ESPO = "/home/kenny/app/twenty-deploy/data/espo/"
WS_SCHEMA = "workspace_f3kbulr3ayp5xa7i6f93kbmeq"

def run_sql(sql):
    res = subprocess.run(
        ["docker", "exec", "-i", "twenty-db-1", "psql", "-U", "postgres", "-d", "default", "-v", "ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True
    )
    if res.returncode != 0:
        print("SQL Error:", res.stderr[:500], file=sys.stderr)
        raise RuntimeError("SQL execution failed")
    return res.stdout.strip()

def main():
    print("=== Aligning Twenty CRM Dates with Original Zoho & Espo Timestamps ===")

    # 1. Leads (13,304)
    print("\n1. Aligning Leads createdAt / updatedAt from Zoho...")
    leads_zoho = json.load(open(D_ZOHO + "leads_full.json"))
    lead_values = []
    for l in leads_zoho:
        zid = l.get("id")
        c_time = l.get("Created_Time")
        m_time = l.get("Modified_Time") or c_time
        if zid and c_time:
            lead_values.append(f"('{zid}', '{c_time}'::timestamptz, '{m_time}'::timestamptz)")

    chunk_size = 1000
    for i in range(0, len(lead_values), chunk_size):
        chunk = lead_values[i:i + chunk_size]
        values_str = ",\n".join(chunk)
        sql = f"""
        UPDATE "{WS_SCHEMA}"."_tapdataLead" AS t
        SET "createdAt" = v.c_time,
            "updatedAt" = v.m_time
        FROM (VALUES
        {values_str}
        ) AS v(zid, c_time, m_time)
        WHERE t."zohoId" = v.zid;
        """
        run_sql(sql)
    print(f"✓ Leads aligned: {len(lead_values)} records")

    # 2. Opportunities (Deals: 897)
    print("\n2. Aligning Opportunities createdAt / updatedAt / closeDate from Zoho...")
    deals_zoho = json.load(open(D_ZOHO + "deals_full.json"))
    deal_values = []
    for d in deals_zoho:
        name = (d.get("Deal_Name") or "").replace("'", "''")
        c_time = d.get("Created_Time")
        m_time = d.get("Modified_Time") or c_time
        close = d.get("Closing_Date")
        close_val = f"'{close} 12:00:00+08'::timestamptz" if close else "NULL"
        if name and c_time:
            deal_values.append(f"('{name}', '{c_time}'::timestamptz, '{m_time}'::timestamptz, {close_val})")

    values_str = ",\n".join(deal_values)
    sql = f"""
    UPDATE "{WS_SCHEMA}"."opportunity" AS o
    SET "createdAt" = v.c_time,
        "updatedAt" = v.m_time,
        "closeDate" = COALESCE(v.close_val, o."closeDate")
    FROM (VALUES
    {values_str}
    ) AS v(name, c_time, m_time, close_val)
    WHERE o.name = v.name;
    """
    run_sql(sql)
    print(f"✓ Opportunities aligned: {len(deal_values)} records")

    # 3. Contacts / People (1,539)
    print("\n3. Aligning People createdAt / updatedAt from Zoho...")
    contacts_zoho = {c["id"]: c for c in json.load(open(D_ZOHO + "contacts_full.json"))}
    people_values = []
    for line in open(D_ESPO + "contact.ndjson"):
        r = json.loads(line)
        first = (r.get("first_name") or "").replace("'", "''")
        last = (r.get("last_name") or "").replace("'", "''")
        zid = r.get("zoho_id")
        zc = contacts_zoho.get(zid)
        if zc and zc.get("Created_Time"):
            c_time = zc["Created_Time"]
            m_time = zc.get("Modified_Time") or c_time
            people_values.append(f"('{first}', '{last}', '{c_time}'::timestamptz, '{m_time}'::timestamptz)")

    for i in range(0, len(people_values), chunk_size):
        chunk = people_values[i:i + chunk_size]
        values_str = ",\n".join(chunk)
        sql = f"""
        UPDATE "{WS_SCHEMA}"."person" AS p
        SET "createdAt" = v.c_time,
            "updatedAt" = v.m_time
        FROM (VALUES
        {values_str}
        ) AS v(first, last, c_time, m_time)
        WHERE COALESCE(p."nameFirstName", '') = v.first
          AND COALESCE(p."nameLastName", '') = v.last;
        """
        run_sql(sql)
    print(f"✓ People aligned: {len(people_values)} records")

    # 4. Companies (Accounts: 1,399)
    print("\n4. Aligning Companies createdAt / updatedAt from Zoho...")
    accs_zoho = json.load(open(D_ZOHO + "accounts_full.json"))
    comp_values = []
    for a in accs_zoho:
        name = (a.get("Account_Name") or "").replace("'", "''")
        c_time = a.get("Created_Time")
        m_time = a.get("Modified_Time") or c_time
        if name and c_time:
            comp_values.append(f"('{name}', '{c_time}'::timestamptz, '{m_time}'::timestamptz)")

    for i in range(0, len(comp_values), chunk_size):
        chunk = comp_values[i:i + chunk_size]
        values_str = ",\n".join(chunk)
        sql = f"""
        UPDATE "{WS_SCHEMA}"."company" AS c
        SET "createdAt" = v.c_time,
            "updatedAt" = v.m_time
        FROM (VALUES
        {values_str}
        ) AS v(name, c_time, m_time)
        WHERE c.name = v.name;
        """
        run_sql(sql)
    print(f"✓ Companies aligned: {len(comp_values)} records")

    # 5. Tasks (2,475)
    print("\n5. Aligning Tasks createdAt / updatedAt / dueAt from Zoho...")
    tasks_zoho = json.load(open(D_ZOHO + "tasks_full.json"))
    task_values = []
    for t in tasks_zoho:
        title = (t.get("Subject") or "").replace("'", "''")
        c_time = t.get("Created_Time")
        m_time = t.get("Modified_Time") or c_time
        due = t.get("Due_Date")
        due_val = f"'{due} 18:00:00+08'::timestamptz" if due else "NULL"
        if title and c_time:
            task_values.append(f"('{title}', '{c_time}'::timestamptz, '{m_time}'::timestamptz, {due_val})")

    for i in range(0, len(task_values), chunk_size):
        chunk = task_values[i:i + chunk_size]
        values_str = ",\n".join(chunk)
        sql = f"""
        UPDATE "{WS_SCHEMA}"."task" AS t
        SET "createdAt" = v.c_time,
            "updatedAt" = v.m_time,
            "dueAt" = COALESCE(v.due_val, t."dueAt")
        FROM (VALUES
        {values_str}
        ) AS v(title, c_time, m_time, due_val)
        WHERE t.title = v.title;
        """
        run_sql(sql)
    print(f"✓ Tasks aligned: {len(task_values)} records")

    # 6. Contracts (292)
    print("\n6. Aligning Contracts createdAt / updatedAt / signDate...")
    con_values = []
    for line in open(D_ESPO + "tapdata_contract.ndjson"):
        r = json.loads(line)
        cnum = r.get("contract_number")
        c_time = r.get("created_at")
        m_time = r.get("modified_at") or c_time
        sign = r.get("sign_date")
        sign_val = f"'{sign}'::date" if sign else "NULL"
        if cnum and c_time:
            con_values.append(f"('{cnum}', '{c_time}'::timestamptz, '{m_time}'::timestamptz, {sign_val})")

    if con_values:
        values_str = ",\n".join(con_values)
        sql = f"""
        UPDATE "{WS_SCHEMA}"."_tapdataContract" AS c
        SET "createdAt" = v.c_time,
            "updatedAt" = v.m_time,
            "signDate" = COALESCE(v.sign_val, c."signDate")
        FROM (VALUES
        {values_str}
        ) AS v(cnum, c_time, m_time, sign_val)
        WHERE c."contractNumber" = v.cnum;
        """
        run_sql(sql)
    # Also set createdAt to signDate if present
    run_sql(f"""
        UPDATE "{WS_SCHEMA}"."_tapdataContract"
        SET "createdAt" = ("signDate"::text || ' 10:00:00+08')::timestamptz
        WHERE "signDate" IS NOT NULL;
    """)
    print(f"✓ Contracts aligned: {len(con_values)} records")

    # 7. Receipts (329)
    print("\n7. Aligning Receipts createdAt / updatedAt / date...")
    rec_values = []
    for line in open(D_ESPO + "tapdata_contract_receipt.ndjson"):
        r = json.loads(line)
        eid = r.get("id")
        c_time = r.get("created_at")
        m_time = r.get("modified_at") or c_time
        rdate = r.get("date")
        date_val = f"'{rdate}'::date" if rdate else "NULL"
        if eid and c_time:
            rec_values.append(f"('{eid}', '{c_time}'::timestamptz, '{m_time}'::timestamptz, {date_val})")

    if rec_values:
        values_str = ",\n".join(rec_values)
        sql = f"""
        UPDATE "{WS_SCHEMA}"."_tapdataReceipt" AS r
        SET "createdAt" = v.c_time,
            "updatedAt" = v.m_time,
            "date" = COALESCE(v.date_val, r."date")
        FROM (VALUES
        {values_str}
        ) AS v(eid, c_time, m_time, date_val)
        WHERE r."espoId" = v.eid;
        """
        run_sql(sql)
    run_sql(f"""
        UPDATE "{WS_SCHEMA}"."_tapdataReceipt"
        SET "createdAt" = ("date"::text || ' 10:00:00+08')::timestamptz
        WHERE "date" IS NOT NULL;
    """)
    print(f"✓ Receipts aligned: {len(rec_values)} records")
    print("\n=== Date Alignment Completed Successfully ===")

if __name__ == "__main__":
    main()
