#!/usr/bin/env python3
"""Full EspoCRM -> Twenty GraphQL Importer and Reconciler.
Reads strictly local NDJSON dumps from scripts/migration/data/espo/ (zero Zoho network calls).
Uses Twenty's GraphQL API with pacing, exponential backoff, and idempotent checkpointing.
"""

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

API = "http://127.0.0.1:8091"
KEY_FILE = "/home/tapdata/app/twenty-deploy/spike-secrets.env"
USER_MAP_FILE = "/home/tapdata/app/twenty-deploy/user_map.json"
ID_MAP_FILE = "/home/tapdata/app/twenty-deploy/id_map.json"
DATA_DIR = "/home/tapdata/app/espocrm-fork/scripts/migration/data/espo"
UPLOAD_DIR = "/home/tapdata/app/espocrm-fork/data/upload"

def get_api_key():
    for line in open(KEY_FILE):
        if line.startswith("TWENTY_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("no api key found")

KEY = get_api_key()

CATEGORY_MAP = {
    "LDP - Perpetual": "LDP_PERPETUAL",
    "LDP - Subscription": "LDP_SUBSCRIPTION",
    "TAPDB - Subscription": "TAPDB_SUBSCRIPTION",
    "MDB - License": "MDB_LICENSE",
    "PS - LDP Product Service": "PS_LDP_PRODUCT",
    "PS - LDP Project Service": "PS_LDP_PROJECT",
    "PS - MDB OPS & MS": "PS_MDB_OPS_MS",
    "PS - MDB Project Service": "PS_MDB_PROJECT",
}

PRICE_UNIT_MAP = {
    "节点": "NODE", "套": "SET", "人天": "MAN_DAY", "年": "YEAR", "月": "MONTH"
}

TAX_RATE_MAP = {
    "13%": "RATE_13", "6%": "RATE_6", "0%": "RATE_0"
}

AGREEMENT_MAP = {
    "产品及服务订单": "PRODUCT_SERVICE_ORDER",
    "产品合同": "PRODUCT_CONTRACT",
    "服务合同/协议": "SERVICE_AGREEMENT",
    "框架协议及订单": "FRAMEWORK_ORDER",
    "项目合同": "PROJECT_CONTRACT",
}

METHOD_MAP = {
    "一期结算": "ONE", "分两期结算": "TWO", "分三期结算": "THREE",
    "分四期结算": "FOUR", "分五期结算": "FIVE",
}

INST_STATUS_MAP = {
    "待开票": "PENDING_INVOICE",
    "已开票待收款": "INVOICED_PENDING_PAYMENT",
    "已收款": "PAID",
    "已收款待开票": "PAID_PENDING_INVOICE",
}

STAGE_MAP = {
    "Closed Won": "CUSTOMER",
    "Closed Lost": "LOST",
    "Prospecting": "NEW",
    "Negotiation": "NEGOTIATION",
    "Proposal": "PROPOSAL",
    "Review": "REVIEW",
}

LEAD_STATUS_MAP = {
    "New": "NEW",
    "In Process": "IN_PROCESS",
    "Recycled": "RECYCLED",
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

def load_ndjson(name):
    path = os.path.join(DATA_DIR, f"{name}.ndjson")
    if not os.path.exists(path):
        return []
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows

def clean_domain(raw_url):
    if not raw_url:
        return None
    url = raw_url.strip().lower()
    url = re.sub(r"^https?://", "", url)
    url = url.split("/")[0].split("?")[0].split("#")[0].split(":")[0]
    if re.match(r"^\d+\.\d+\.\d+\.\d+$", url):
        return None
    if "." not in url or " " in url or len(url) < 4:
        return None
    return url

def clean_phone(raw_num):
    if not raw_num:
        return None
    num = re.sub(r"[\s\-\(\)]", "", str(raw_num).strip())
    if not num:
        return None
    if num.startswith("+"):
        digits = num[1:]
        if digits.isdigit() and 8 <= len(digits) <= 15:
            return {"primaryPhoneNumber": num}
        return None
    if num.startswith("852") and len(num) == 11 and num.isdigit():
        return {"primaryPhoneNumber": "+" + num}
    if re.match(r"^(400|800)\d{7}$", num):
        return {
            "primaryPhoneNumber": num,
            "primaryPhoneCountryCode": "CN",
            "primaryPhoneCallingCode": "+86"
        }
    if re.match(r"^1[3-9]\d{9}$", num):
        return {
            "primaryPhoneNumber": num,
            "primaryPhoneCountryCode": "CN",
            "primaryPhoneCallingCode": "+86"
        }
    if re.match(r"^0\d{9,11}$", num):
        return {
            "primaryPhoneNumber": num.lstrip("0"),
            "primaryPhoneCountryCode": "CN",
            "primaryPhoneCallingCode": "+86"
        }
    if len(num) == 8 and num.isdigit():
        return {
            "primaryPhoneNumber": num,
            "primaryPhoneCountryCode": "HK",
            "primaryPhoneCallingCode": "+852"
        }
    return None

def money(val, curr):
    if val is None or val == "":
        return None
    try:
        amt = float(val)
    except (ValueError, TypeError):
        return None
    c = (curr or "CNY").strip() or "CNY"
    return {"amountMicros": round(amt * 1_000_000), "currencyCode": c}

def gql_literal(obj):
    """Recursively formats JSON dicts into GraphQL argument literals without quotes on keys."""
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

def gql_create(mutation, rows, chunk=40, pace=0.5):
    """Bulk creates entities in batches. Returns list of created IDs in input order."""
    ids = []
    total_chunks = (len(rows) + chunk - 1) // chunk
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
            print(f"    !! GraphQL errors on {mutation} batch {i//chunk + 1}/{total_chunks}: {json.dumps(payload['errors'])[:400]}", file=sys.stderr)
            created = []
        else:
            created = (payload or {}).get("data", {}).get(mutation) or []

        batch_ids = [row["id"] for row in created]
        ids.extend(batch_ids)
        if len(batch_ids) != len(batch):
            print(f"    [batch warning] sent {len(batch)} records, created {len(batch_ids)}", file=sys.stderr)
        if (i // chunk + 1) % 15 == 0 or (i // chunk + 1) == total_chunks:
            print(f"    progress: {min(i + chunk, len(rows))}/{len(rows)} ({mutation})")
        time.sleep(pace)
    return ids

def main():
    print("=== EspoCRM -> Twenty Full Migration Pipeline ===")
    
    # Load user map
    with open(USER_MAP_FILE, "r", encoding="utf-8") as f:
        user_map = json.load(f)
    print(f"Loaded {len(user_map)} workspace members from {USER_MAP_FILE}")

    # Build emails and phones maps
    email_addresses = {r["id"]: r["name"] for r in load_ndjson("email_address")}
    phone_numbers = {r["id"]: r["name"] for r in load_ndjson("phone_number")}
    
    entity_emails = {}
    for r in load_ndjson("entity_email_address"):
        etype = r.get("entity_type")
        eid = r.get("entity_id")
        em_id = r.get("email_address_id")
        addr = email_addresses.get(em_id)
        if not addr:
            continue
        if eid not in entity_emails:
            entity_emails[eid] = {"primary": None, "additional": []}
        if r.get("primary"):
            entity_emails[eid]["primary"] = addr.strip().lower()
        else:
            entity_emails[eid]["additional"].append(addr.strip().lower())
    # Ensure primary is filled
    for eid, data in entity_emails.items():
        if not data["primary"] and data["additional"]:
            data["primary"] = data["additional"].pop(0)

    entity_phones = {}
    for r in load_ndjson("entity_phone_number"):
        eid = r.get("entity_id")
        ph_id = r.get("phone_number_id")
        num = phone_numbers.get(ph_id)
        if not num:
            continue
        if eid not in entity_phones:
            entity_phones[eid] = {"primary": None, "additional": []}
        if r.get("primary"):
            entity_phones[eid]["primary"] = num
        else:
            entity_phones[eid]["additional"].append(num)
    for eid, data in entity_phones.items():
        if not data["primary"] and data["additional"]:
            data["primary"] = data["additional"].pop(0)

    id_map = {
        "accounts": {},
        "contacts": {},
        "opportunities": {},
        "leads": {},
        "tasks": {},
        "products": {},
        "quotes": {},
        "contracts": {},
    }

    # 1. Accounts -> Companies (1,437)
    accounts = load_ndjson("account")
    print(f"\n1. Migrating {len(accounts)} Accounts -> Companies...")
    seen_domains = set()
    company_rows = []
    for a in accounts:
        row = {"name": a["name"]}
        dom = clean_domain(a.get("website"))
        if dom and dom not in seen_domains:
            seen_domains.add(dom)
            row["domainName"] = {"primaryLinkUrl": dom}
        
        # Address
        addr = {}
        if a.get("billing_address_street"): addr["addressStreet1"] = a["billing_address_street"]
        if a.get("billing_address_city"): addr["addressCity"] = a["billing_address_city"]
        if a.get("billing_address_state"): addr["addressState"] = a["billing_address_state"]
        if a.get("billing_address_country"): addr["addressCountry"] = a["billing_address_country"]
        if a.get("billing_address_postal_code"): addr["addressPostcode"] = a["billing_address_postal_code"]
        if addr:
            row["address"] = addr

        # Account owner
        assignee = a.get("assigned_user_id")
        if assignee and assignee in user_map:
            row["accountOwnerId"] = user_map[assignee]["workspaceMemberId"]

        company_rows.append(row)

    company_ids = gql_create("createCompanies", company_rows)
    for a, cid in zip(accounts, company_ids):
        id_map["accounts"][a["id"]] = cid
    print(f"✓ Companies created: {len(company_ids)} / {len(accounts)}")

    # 2. Contacts -> People (1,539)
    contacts = load_ndjson("contact")
    print(f"\n2. Migrating {len(contacts)} Contacts -> People...")
    seen_person_emails = set()
    people_rows = []
    for c in contacts:
        first = (c.get("first_name") or "").strip()
        last = (c.get("last_name") or "").strip()
        row = {"name": {"firstName": first, "lastName": last}}
        
        job = (c.get("title") or c.get("department") or "").strip()
        if job:
            row["jobTitle"] = job

        aid = c.get("account_id")
        if aid and aid in id_map["accounts"]:
            row["companyId"] = id_map["accounts"][aid]

        cid = c["id"]
        em = entity_emails.get(cid)
        if em:
            prim = em.get("primary")
            adds = list(em.get("additional") or [])
            if prim:
                if prim in seen_person_emails:
                    adds.append(prim)
                    prim = None
                else:
                    seen_person_emails.add(prim)
            if prim or adds:
                email_obj = {}
                if prim:
                    email_obj["primaryEmail"] = prim
                if adds:
                    email_obj["additionalEmails"] = adds
                row["emails"] = email_obj

        ph = entity_phones.get(cid)
        if ph and ph.get("primary"):
            cleaned = clean_phone(ph["primary"])
            if cleaned:
                row["phones"] = cleaned

        people_rows.append(row)

    people_ids = gql_create("createPeople", people_rows)
    for c, pid in zip(contacts, people_ids):
        id_map["contacts"][c["id"]] = pid
    print(f"✓ People created: {len(people_ids)} / {len(contacts)}")

    # 3. Opportunities (Deals: 916)
    opps = load_ndjson("opportunity")
    print(f"\n3. Migrating {len(opps)} Opportunities...")
    opp_rows = []
    for o in opps:
        row = {"name": o["name"] or "未命名商机"}
        if o.get("amount") is not None:
            row["amount"] = money(o.get("amount"), o.get("amount_currency"))
        if o.get("close_date"):
            row["closeDate"] = f"{o['close_date']}T00:00:00.000Z"
        
        stage_raw = o.get("stage")
        row["stage"] = STAGE_MAP.get(stage_raw, "NEW")

        aid = o.get("account_id")
        if aid and aid in id_map["accounts"]:
            row["companyId"] = id_map["accounts"][aid]

        cid = o.get("contact_id")
        if cid and cid in id_map["contacts"]:
            row["pointOfContactId"] = id_map["contacts"][cid]

        assignee = o.get("assigned_user_id")
        if assignee and assignee in user_map:
            row["ownerId"] = user_map[assignee]["workspaceMemberId"]

        opp_rows.append(row)

    opp_ids = gql_create("createOpportunities", opp_rows)
    for o, oid in zip(opps, opp_ids):
        id_map["opportunities"][o["id"]] = oid
    print(f"✓ Opportunities created: {len(opp_ids)} / {len(opps)}")

    # 4. Leads (13,304)
    leads = load_ndjson("lead")
    print(f"\n4. Migrating {len(leads)} Leads -> tapdataLeads...")
    lead_rows = []
    for l in leads:
        lead_id = l["id"]
        row = {
            "name": l.get("title") or f"{l.get('first_name') or ''} {l.get('last_name') or ''}".strip() or "未命名线索",
            "firstName": l.get("first_name"),
            "lastName": l.get("last_name"),
            "jobTitle": l.get("title"),
            "status": LEAD_STATUS_MAP.get(l.get("status"), "NEW"),
            "source": l.get("zoho_lead_source") or l.get("source"),
            "website": l.get("website"),
            "industry": l.get("industry"),
            "accountName": l.get("account_name"),
            "description": l.get("description"),
            "closedReason": l.get("closed_reason"),
            "zohoId": l.get("zoho_id"),
            "espoId": lead_id,
        }
        if l.get("opportunity_amount") is not None:
            row["opportunityAmount"] = money(l.get("opportunity_amount"), l.get("opportunity_amount_currency"))

        em = entity_emails.get(lead_id)
        if em and em.get("primary"):
            row["email"] = em["primary"]

        ph = entity_phones.get(lead_id)
        if ph and ph.get("primary"):
            row["phone"] = ph["primary"]

        assignee = l.get("assigned_user_id")
        if assignee and assignee in user_map:
            row["ownerId"] = user_map[assignee]["workspaceMemberId"]

        lead_rows.append(row)

    lead_ids = gql_create("createTapdataLeads", lead_rows, chunk=50, pace=0.5)
    for l, lid in zip(leads, lead_ids):
        id_map["leads"][l["id"]] = lid
    print(f"✓ Leads created: {len(lead_ids)} / {len(leads)}")

    # 5. Tasks (2,475)
    tasks = load_ndjson("task")
    print(f"\n5. Migrating {len(tasks)} Tasks...")
    task_rows = []
    task_targets_pending = []
    for t in tasks:
        tid = t["id"]
        row = {
            "title": t.get("name") or "未命名任务",
            "status": TASK_STATUS_MAP.get(t.get("status"), "TODO"),
        }
        if t.get("priority"):
            row["priority"] = TASK_PRIORITY_MAP.get(t.get("priority"), "NORMAL")
        if t.get("date_end"):
            row["dueAt"] = f"{t['date_end']}T00:00:00.000Z"
        if t.get("description"):
            row["bodyV2"] = {"markdown": t["description"]}

        assignee = t.get("assigned_user_id")
        if assignee and assignee in user_map:
            row["assigneeId"] = user_map[assignee]["workspaceMemberId"]

        task_rows.append(row)

    task_ids = gql_create("createTasks", task_rows, chunk=40, pace=0.5)
    for t, tw_tid in zip(tasks, task_ids):
        id_map["tasks"][t["id"]] = tw_tid
        aid = t.get("account_id")
        cid = t.get("contact_id")
        if aid and aid in id_map["accounts"]:
            task_targets_pending.append({"taskId": tw_tid, "targetCompanyId": id_map["accounts"][aid]})
        if cid and cid in id_map["contacts"]:
            task_targets_pending.append({"taskId": tw_tid, "targetPersonId": id_map["contacts"][cid]})

    print(f"✓ Tasks created: {len(task_ids)} / {len(tasks)}")
    if task_targets_pending:
        print(f"  Linking {len(task_targets_pending)} task targets...")
        gql_create("createTaskTargets", task_targets_pending, chunk=40, pace=0.5)
        print("  ✓ Task targets linked")

    # 6. Products (90)
    products = load_ndjson("tapdata_product")
    print(f"\n6. Migrating {len(products)} Products...")
    product_rows = []
    for p in products:
        row = {
            "name": p["name"],
            "productCode": (p.get("product_code") or "").strip(),
            "category": CATEGORY_MAP.get(p.get("category")),
            "unitPrice": money(p.get("unit_price"), p.get("unit_price_currency")),
            "priceUnit": PRICE_UNIT_MAP.get(p.get("price_unit")),
            "taxRate": TAX_RATE_MAP.get(p.get("tax_rate")),
            "status": (p.get("status") or "ACTIVE").strip().upper(),
        }
        product_rows.append(row)
    prod_ids = gql_create("createTapdataProducts", product_rows)
    for p, pid in zip(products, prod_ids):
        id_map["products"][p["id"]] = pid
    print(f"✓ Products created: {len(prod_ids)} / {len(products)}")

    # 7. Quotes (212) + QuoteItems (402)
    quotes = load_ndjson("tapdata_quote")
    quote_items = load_ndjson("tapdata_quote_item")
    print(f"\n7. Migrating {len(quotes)} Quotes and {len(quote_items)} QuoteItems...")
    quote_rows = []
    for q in quotes:
        row = {
            "name": q["name"],
            "quoteNumber": q.get("quote_number") or "",
            "stage": (q.get("stage") or "DRAFT").strip().upper(),
            "validUntil": q.get("valid_until"),
            "subtotal": money(q.get("subtotal"), q.get("subtotal_currency")),
            "amount": money(q.get("amount"), q.get("amount_currency")),
            "discountAmount": money(q.get("discount_amount"), q.get("discount_amount_currency")),
        }
        aid = q.get("account_id")
        if aid and aid in id_map["accounts"]:
            row["companyId"] = id_map["accounts"][aid]
        quote_rows.append(row)

    quote_ids = gql_create("createTapdataQuotes", quote_rows)
    for q, qid in zip(quotes, quote_ids):
        id_map["quotes"][q["id"]] = qid
    print(f"✓ Quotes created: {len(quote_ids)} / {len(quotes)}")

    qi_rows = []
    for it in quote_items:
        qid = it.get("quote_id")
        if not qid or qid not in id_map["quotes"]:
            continue
        row = {
            "quoteId": id_map["quotes"][qid],
            "quantity": float(it.get("quantity") or 1),
            "listPrice": money(it.get("list_price"), it.get("list_price_currency")),
            "unitPrice": money(it.get("unit_price"), it.get("unit_price_currency")),
            "discountPercentage": float(it.get("discount_percentage") or 0) or None,
        }
        pid = it.get("product_id")
        if pid and pid in id_map["products"]:
            row["productId"] = id_map["products"][pid]
        qi_rows.append(row)

    qi_ids = gql_create("createTapdataQuoteItems", qi_rows)
    print(f"✓ QuoteItems created: {len(qi_ids)} / {len(quote_items)}")

    # 8. Contracts (292) + ContractItems (324) + Installments (from p1-p4)
    contracts = load_ndjson("tapdata_contract")
    contract_items = load_ndjson("tapdata_contract_item")
    print(f"\n8. Migrating {len(contracts)} Contracts and {len(contract_items)} ContractItems...")
    contract_rows = []
    for c in contracts:
        row = {
            "name": c["name"],
            "contractNumber": c.get("contract_number") or "",
            "signDate": c.get("sign_date"),
            "status": (c.get("status") or "DRAFT").strip().upper(),
            "amount": money(c.get("amount"), c.get("amount_currency")),
            "installmentMethod": METHOD_MAP.get(c.get("installment_method")),
        }
        if c.get("agreement_type"):
            row["agreementType"] = AGREEMENT_MAP.get(c.get("agreement_type"))
        aid = c.get("account_id")
        if aid and aid in id_map["accounts"]:
            row["companyId"] = id_map["accounts"][aid]
        if c.get("exchange_rate"):
            row["exchangeRate"] = float(c["exchange_rate"])
            row["rateDate"] = c.get("rate_date")
            row["rateSource"] = "Manual Override"
        contract_rows.append(row)

    con_ids = gql_create("createTapdataContracts", contract_rows)
    for c, cid in zip(contracts, con_ids):
        id_map["contracts"][c["id"]] = cid
    print(f"✓ Contracts created: {len(con_ids)} / {len(contracts)}")

    ci_rows = []
    for it in contract_items:
        cid = it.get("contract_id")
        if not cid or cid not in id_map["contracts"]:
            continue
        row = {
            "contractId": id_map["contracts"][cid],
            "quantity": float(it.get("quantity") or 1),
            "unitPrice": money(it.get("unit_price"), it.get("unit_price_currency")),
        }
        pid = it.get("product_id")
        if pid and pid in id_map["products"]:
            row["productId"] = id_map["products"][pid]
        ci_rows.append(row)

    ci_ids = gql_create("createTapdataContractItems", ci_rows)
    print(f"✓ ContractItems created: {len(ci_ids)} / {len(contract_items)}")

    # Installments from contract p1-p4 plan
    inst_rows = []
    for c in contracts:
        cid = id_map["contracts"].get(c["id"])
        if not cid:
            continue
        cnum = c.get("contract_number") or c["name"]
        curr = c.get("amount_currency")
        for n in (1, 2, 3, 4):
            pct = c.get(f"p{n}_percentage")
            amt = c.get(f"p{n}_amount")
            st = INST_STATUS_MAP.get(c.get(f"p{n}_status"))
            if not (pct or amt or st):
                continue
            row = {
                "name": f"{cnum} P{n}",
                "contractId": cid,
                "sequence": n,
                "percentage": float(pct) if pct else None,
                "dueDate": c.get(f"p{n}_due_date"),
                "status": st,
            }
            if amt is not None:
                row["amount"] = money(amt, curr)
            if c.get(f"p{n}_invoice_date"):
                row["invoiceDate"] = c[f"p{n}_invoice_date"]
            if c.get(f"p{n}_payment_date"):
                row["paymentDate"] = c[f"p{n}_payment_date"]
            inst_rows.append(row)

    print(f"  Creating {len(inst_rows)} Contract Installment milestones...")
    inst_ids = gql_create("createTapdataInstallments", inst_rows)
    print(f"  ✓ Installments created: {len(inst_ids)} / {len(inst_rows)}")

    # 9. Receipts (Actual chronologic payments: 329)
    receipts = load_ndjson("tapdata_contract_receipt")
    print(f"\n9. Migrating {len(receipts)} Contract Receipts...")
    receipt_rows = []
    for r in receipts:
        cid = id_map["contracts"].get(r.get("contract_id"))
        row = {
            "name": r.get("name") or "回款",
            "date": r.get("date"),
            "invoiceNumber": r.get("invoice_number"),
            "bank": r.get("bank"),
            "payer": r.get("payer"),
            "note": r.get("note"),
            "source": r.get("source"),
            "espoId": r["id"],
        }
        if r.get("amount") is not None:
            row["amount"] = money(r.get("amount"), r.get("amount_currency"))
        if r.get("amount_cny") is not None:
            row["amountCny"] = money(r.get("amount_cny"), r.get("amount_cny_currency"))
        if r.get("exchange_rate"):
            try:
                row["exchangeRate"] = float(r["exchange_rate"])
            except ValueError:
                pass
        if cid:
            row["contractId"] = cid
        receipt_rows.append(row)

    rec_ids = gql_create("createTapdataReceipts", receipt_rows)
    print(f"✓ Receipts created: {len(rec_ids)} / {len(receipts)}")

    # Save ID mapping
    with open(ID_MAP_FILE, "w", encoding="utf-8") as f:
        json.dump(id_map, f, indent=2, ensure_ascii=False)
    print(f"\nSaved ID mapping table to {ID_MAP_FILE}")
    print("=== Core Migration Phase Finished Successfully ===")

if __name__ == "__main__":
    main()
