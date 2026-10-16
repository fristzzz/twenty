#!/usr/bin/env python3
"""Espo -> Twenty spike importer + reconciler.

Run on the tapdata host (it shells out to the Espo MySQL container and posts to Twenty's REST API).

  python3 import_to_twenty.py import   # load sample records
  python3 import_to_twenty.py verify   # reconcile computed fields
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

API = "http://127.0.0.1:8091"
KEY_FILE = "/home/tapdata/app/twenty-deploy/spike-secrets.env"

CATEGORY = {
    "LDP - Perpetual": "LDP_PERPETUAL", "LDP - Subscription": "LDP_SUBSCRIPTION",
    "TAPDB - Subscription": "TAPDB_SUBSCRIPTION", "MDB - License": "MDB_LICENSE",
    "PS - LDP Product Service": "PS_LDP_PRODUCT", "PS - LDP Project Service": "PS_LDP_PROJECT",
    "PS - MDB OPS & MS": "PS_MDB_OPS_MS", "PS - MDB Project Service": "PS_MDB_PROJECT",
}
PRICE_UNIT = {"节点": "NODE", "套": "SET", "人天": "MAN_DAY", "年": "YEAR", "月": "MONTH"}
TAX_RATE = {"13%": "RATE_13", "6%": "RATE_6", "0%": "RATE_0"}
AGREEMENT = {
    "产品及服务订单": "PRODUCT_SERVICE_ORDER", "产品合同": "PRODUCT_CONTRACT",
    "服务合同/协议": "SERVICE_AGREEMENT", "框架协议及订单": "FRAMEWORK_ORDER",
    "项目合同": "PROJECT_CONTRACT",
}
METHOD = {
    "一期结算": "ONE", "分两期结算": "TWO", "分三期结算": "THREE",
    "分四期结算": "FOUR", "分五期结算": "FIVE",
}
INST_STATUS = {
    "待开票": "PENDING_INVOICE", "已开票待收款": "INVOICED_PENDING_PAYMENT",
    "已收款": "PAID", "已收款待开票": "PAID_PENDING_INVOICE",
}


def api_key():
    for line in open(KEY_FILE):
        if line.startswith("TWENTY_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("no api key")


KEY = api_key()


def espo(table, exprs, where="", limit=None):
    """exprs: list of (alias, sql-expression). Returns rows as dicts (one JSON object per row).

    The container's mysql client has no --json, so JSON_OBJECT() does the encoding and
    batch output gives one JSON document per line.
    """
    sql = "select JSON_OBJECT(%s) from %s" % (",".join("'%s',%s" % (a, e) for a, e in exprs), table)
    if where:
        sql += " where " + where
    if limit:
        sql += " limit %d" % limit
    out = subprocess.run(
        ["docker", "exec", "-i", "espocrm-mysql", "sh", "-c",
         'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N --batch --default-character-set=utf8mb4 espocrm'],
        input=sql.encode("utf-8"), capture_output=True, check=True,
    ).stdout.decode("utf-8")
    rows = []
    for line in out.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        rows.append(json.loads(line))
    return rows


def rest(method, path, body=None, params=None):
    url = API + path
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
    })
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:200]
            if e.code == 429 and attempt < 4:
                time.sleep(15)
                continue
            print(f"  !! {method} {path} -> {e.code} {detail}", file=sys.stderr)
            return None
        except Exception as exc:  # noqa: BLE001
            print(f"  !! {method} {path} -> {exc}", file=sys.stderr)
            return None
    return None


def created(resp):
    data = (resp or {}).get("data") or {}
    for value in data.values():
        if isinstance(value, dict):
            return value.get("id")
    return None


def post(path, payload):
    return created(rest("POST", path, {k: v for k, v in payload.items() if v is not None}))


def gql_literal(obj):
    """JSON -> GraphQL value literal (keys unquoted, strings keep double quotes)."""
    return re.sub(r'"([A-Za-z0-9_]+)":', r"\1:", json.dumps(obj, ensure_ascii=False))


STD_CHUNK = int(os.environ.get("SPIKE_STD_CHUNK", 40))
STD_PACE = float(os.environ.get("SPIKE_STD_PACE", 0.7))
CUSTOM_CHUNK = int(os.environ.get("SPIKE_CUSTOM_CHUNK", 10))
CUSTOM_PACE = float(os.environ.get("SPIKE_CUSTOM_PACE", 2.0))


def gql_create(mutation, rows, chunk=None, pace=None):
    """Bulk create; returns the created ids in input order.

    pace keeps us inside the API key bucket (100 requests / 60s) and retries on 429.
    """
    if chunk is None:
        chunk = STD_CHUNK if mutation in ("createCompanies", "createPeople", "createOpportunities") else CUSTOM_CHUNK
    if pace is None:
        pace = STD_PACE if mutation in ("createCompanies", "createPeople", "createOpportunities") else CUSTOM_PACE
    ids = []
    for i in range(0, len(rows), chunk):
        batch = rows[i:i + chunk]
        query = "mutation { %s(data: %s) { id } }" % (mutation, gql_literal(batch))
        for attempt in range(4):
            req = urllib.request.Request(API + "/graphql", data=json.dumps({"query": query}).encode(),
                                         method="POST", headers={"Authorization": f"Bearer {KEY}",
                                                                 "Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    payload = json.loads(resp.read().decode() or "{}")
                break
            except urllib.error.HTTPError as e:
                detail = e.read().decode()[:300]
                if e.code == 429 and attempt < 3:
                    time.sleep(10)
                    continue
                print(f"  !! {mutation} -> {e.code} {detail}", file=sys.stderr)
                return ids
        if payload.get("errors"):
            print(f"  !! {mutation}: {json.dumps(payload['errors'])[:400]}", file=sys.stderr)
            return ids
        created = (payload.get("data") or {}).get(mutation) or []
        ids += [row["id"] for row in created]
        if len(created) != len(batch):
            print(f"  !! {mutation}: sent {len(batch)}, got {len(created)} — id order not trustworthy",
                  file=sys.stderr)
        time.sleep(pace)
    return ids


def connect(record_id):
    """Custom-object relations take the bare FK value; standard objects use the connect form."""
    return record_id


def dedupe(rows, key):
    """Twenty unique fields reject duplicates; Espo has empty/duplicated business numbers."""
    out, seen = [], set()
    for r in rows:
        v = (r.get(key) or "").strip()
        if not v or v in seen:
            continue
        seen.add(v)
        out.append(r)
    return out


def money(value, currency):
    amount = float(value or 0)
    return {"amountMicros": round(amount * 1_000_000), "currencyCode": (currency or "CNY").strip() or "CNY"}


def sel(mapping, value, default=None):
    key = (value or "").strip()
    return mapping.get(key, default)


def CONTRACT_EXPRS():
    e = [("id", "id"), ("name", "name"), ("contract_number", "contract_number"),
         ("sign_date", "sign_date"), ("status", "status"), ("amount", "amount"),
         ("amount_currency", "amount_currency"), ("exchange_rate", "exchange_rate"),
         ("rate_date", "rate_date"), ("rate_source", "rate_source"),
         ("amount_cny", "amount_cny"), ("agreement_type", "agreement_type"),
         ("installment_method", "installment_method"), ("account_id", "account_id"),
         ("payment_received", "payment_received"), ("to_invoiced", "to_invoiced"),
         ("receivable", "receivable"), ("collection_rate", "collection_rate")]
    for n in (1, 2, 3, 4):
        e += [(f"p{n}_percentage", f"p{n}_percentage"), (f"p{n}_amount", f"p{n}_amount"),
              (f"p{n}_due_date", f"p{n}_due_date"), (f"p{n}_status", f"p{n}_status"),
              (f"p{n}_invoice_date", f"p{n}_invoice_date"), (f"p{n}_payment_date", f"p{n}_payment_date")]
    return e


ALL = os.environ.get("SPIKE_ALL") == "1"
LIM = None if ALL else 8          # contracts, foreign-currency
LIM_CNY = None if ALL else 7      # contracts, CNY
LIM_Q = None if ALL else 8        # quotes
LIM_P = None if ALL else 40       # products


def fetch_sample():
    contracts = espo("tapdata_contract", CONTRACT_EXPRS(),
                     "deleted=0 and amount_currency<>'CNY'" + ("" if ALL else " order by modified_at desc"), LIM)
    contracts += espo("tapdata_contract", CONTRACT_EXPRS(),
                      "deleted=0 and amount_currency='CNY' and installment_method is not null "
                      "and trim(installment_method)<>''" + ("" if ALL else " order by modified_at desc"), LIM_CNY)
    if not ALL:
        seen = {c["id"] for c in contracts}
        extra = espo("tapdata_contract", CONTRACT_EXPRS(), "deleted=0", 15)
        contracts += [c for c in extra if c["id"] not in seen]
    contracts = dedupe(contracts, "contract_number")

    if ALL:
        accounts = espo("account", [("id", "id"), ("name", "name"), ("website", "website")],
                        "deleted=0 and name is not null and trim(name)<>''")
    else:
        account_ids = sorted({c["account_id"] for c in contracts if c.get("account_id")})
        accounts = espo("account", [("id", "id"), ("name", "name"), ("website", "website")],
                        "deleted=0 and id in (%s)" % ",".join("'%s'" % a for a in account_ids))
    accounts = dedupe(accounts, "name")

    contacts = espo("contact", [("id", "id"), ("first_name", "first_name"), ("last_name", "last_name"),
                                ("account_id", "account_id")],
                    "deleted=0 and (first_name is not null or last_name is not null)") if ALL else []
    opportunities = espo("opportunity", [("id", "id"), ("name", "name"), ("amount", "amount"),
                                         ("amount_currency", "amount_currency"), ("stage", "stage"),
                                         ("account_id", "account_id"), ("close_date", "close_date")],
                         "deleted=0 and name is not null and trim(name)<>''") if ALL else []

    products = dedupe(espo("tapdata_product", [("id", "id"), ("name", "name"), ("product_code", "product_code"),
                                        ("category", "category"), ("unit_price", "unit_price"),
                                        ("unit_price_currency", "unit_price_currency"),
                                        ("price_unit", "price_unit"), ("tax_rate", "tax_rate"),
                                        ("status", "status")], "deleted=0", LIM_P), "product_code")

    quotes = dedupe(espo("tapdata_quote", [("id", "id"), ("name", "name"), ("quote_number", "quote_number"),
                                    ("stage", "stage"), ("valid_until", "valid_until"),
                                    ("amount", "amount"), ("amount_currency", "amount_currency"),
                                    ("subtotal", "subtotal"), ("subtotal_currency", "subtotal_currency"),
                                    ("discount_amount", "discount_amount"),
                                    ("discount_amount_currency", "discount_amount_currency"),
                                    ("account_id", "account_id")],
                  "deleted=0 and quote_number is not null and trim(quote_number)<>''"
                  + ("" if ALL else " order by modified_at desc"), LIM_Q), "quote_number")
    quote_ids = [q["id"] for q in quotes]
    quote_items = espo("tapdata_quote_item", [("id", "id"), ("quote_id", "quote_id"),
                                              ("product_id", "product_id"), ("product_code", "product_code"),
                                              ("quantity", "quantity"), ("list_price", "list_price"),
                                              ("list_price_currency", "list_price_currency"),
                                              ("unit_price", "unit_price"),
                                              ("unit_price_currency", "unit_price_currency"),
                                              ("discount_percentage", "discount_percentage")],
                       "deleted=0 and quote_id in (%s)" % (",".join("'%s'" % q for q in quote_ids) or "''"))

    contract_ids = [c["id"] for c in contracts]
    contract_items = espo("tapdata_contract_item", [("id", "id"), ("contract_id", "contract_id"),
                                                    ("product_id", "product_id"),
                                                    ("product_code", "product_code"),
                                                    ("quantity", "quantity"), ("unit_price", "unit_price"),
                                                    ("unit_price_currency", "unit_price_currency"),
                                                    ("total_amount", "total_amount")],
                          "deleted=0 and contract_id in (%s)" % (",".join("'%s'" % c for c in contract_ids) or "''"))
    return contracts, accounts, products, quotes, quote_items, contract_items, contacts, opportunities


def do_import():
    contracts, accounts, products, quotes, quote_items, contract_items, contacts, opportunities = fetch_sample()
    print(f"load: {len(contracts)} contracts, {len(accounts)} accounts, {len(contacts)} contacts, "
          f"{len(opportunities)} opportunities, {len(products)} products, {len(quotes)} quotes, "
          f"{len(quote_items)} quote items, {len(contract_items)} contract items")

    company_rows = [{"name": a["name"], "domainName": None} for a in accounts]
    company_ids = gql_create("createCompanies", company_rows)
    company_id = {a["id"]: c for a, c in zip(accounts, company_ids)}
    print(f"companies: {len(company_id)}")

    if contacts:
        people = []
        for ct in contacts:
            first = (ct.get("first_name") or "").strip()
            last = (ct.get("last_name") or "").strip()
            if not (first or last):
                continue
            row = {"name": {"firstName": first, "lastName": last}}
            cid = company_id.get(ct.get("account_id"))
            if cid:
                row["companyId"] = cid
            people.append(row)
        # people needs a display name; Espo stores only first/last
        created = gql_create("createPeople", people)
        print(f"people: {len(created)}")

    if opportunities:
        opps = []
        for o in opportunities:
            close = o.get("close_date")
            row = {"name": o["name"],
                   "amount": money(o.get("amount"), o.get("amount_currency")) if o.get("amount") else None,
                   # opportunity.closeDate is DATE_TIME in Twenty, Espo stores a plain date
                   "closeDate": f"{close}T00:00:00.000Z" if close else None}
            cid = company_id.get(o.get("account_id"))
            if cid:
                row["companyId"] = cid
            opps.append({k: v for k, v in row.items() if v is not None})
        created = gql_create("createOpportunities", opps)
        print(f"opportunities: {len(created)}")

    seen, product_rows = set(), []
    for p in products:
        code = (p.get("product_code") or "").strip()
        if not code or code in seen:
            continue
        seen.add(code)
        product_rows.append((p, {
            "name": p["name"], "productCode": code,
            "category": sel(CATEGORY, p.get("category")),
            "unitPrice": money(p.get("unit_price"), p.get("unit_price_currency")),
            "priceUnit": sel(PRICE_UNIT, p.get("price_unit")),
            "taxRate": sel(TAX_RATE, p.get("tax_rate")),
            "status": (p.get("status") or "ACTIVE").strip().upper(),
        }))
    prod_ids = gql_create("createTapdataProducts", [row for _, row in product_rows])
    product_id = {}
    for (p, _), pid in zip(product_rows, prod_ids):
        product_id[p["id"]] = pid
        product_id[(p.get("product_code") or "").strip()] = pid
    print(f"products: {len(prod_ids)}")

    quote_rows = []
    for q in quotes:
        if not q.get("quote_number"):
            continue
        row = {"name": q["name"], "quoteNumber": q["quote_number"],
               "stage": (q.get("stage") or "DRAFT").strip().upper(),
               "validUntil": q.get("valid_until"),
               "subtotal": money(q.get("subtotal"), q.get("subtotal_currency")),
               "amount": money(q.get("amount"), q.get("amount_currency")),
               "discountAmount": money(q.get("discount_amount"), q.get("discount_amount_currency"))}
        cid = company_id.get(q.get("account_id"))
        if cid:
            row["companyId"] = connect(cid)
        quote_rows.append((q, row))
    quote_ids = gql_create("createTapdataQuotes", [row for _, row in quote_rows])
    quote_pk = {q["id"]: cid for (q, _), cid in zip(quote_rows, quote_ids)}
    print(f"quotes: {len(quote_pk)}")

    # Items go in without unit price / totals so the logic function has to derive them and
    # roll the parent up — the behaviour we are validating.
    qi_rows = [{"quoteId": connect(quote_pk[it["quote_id"]]),
                "quantity": float(it.get("quantity") or 1),
                "listPrice": money(it.get("list_price"), it.get("list_price_currency")),
                "unitPrice": money(it.get("unit_price"), it.get("unit_price_currency")),
                "discountPercentage": float(it.get("discount_percentage") or 0) or None}
               for it in quote_items if it.get("quote_id") in quote_pk]
    for row, it in zip(qi_rows, [i for i in quote_items if i.get("quote_id") in quote_pk]):
        pid = product_id.get(it.get("product_id")) or product_id.get((it.get("product_code") or "").strip())
        if pid:
            row["productId"] = connect(pid)
    gql_create("createTapdataQuoteItems", qi_rows)

    contract_rows = []
    for c in contracts:
        if not c.get("contract_number"):
            continue
        row = {"name": c["name"], "contractNumber": c["contract_number"],
               "signDate": c.get("sign_date"),
               "status": (c.get("status") or "DRAFT").strip().upper(),
               "amount": money(c.get("amount"), c.get("amount_currency")),
               "installmentMethod": sel(METHOD, c.get("installment_method"))}
        if c.get("agreement_type"):
            row["agreementType"] = sel(AGREEMENT, c.get("agreement_type"))
        cid = company_id.get(c.get("account_id"))
        if cid:
            row["companyId"] = connect(cid)
        # All 267 historical rows carry a Zoho-era rate; the Espo hook treats that as an override
        # it must not recompute, so we import it the same way and compare like for like.
        if c.get("exchange_rate"):
            row["exchangeRate"] = float(c["exchange_rate"])
            row["rateDate"] = c.get("rate_date")
            row["rateSource"] = "Manual Override"
        contract_rows.append((c, row))
    con_ids = gql_create("createTapdataContracts", [row for _, row in contract_rows])
    contract_pk = {c["id"]: cid for (c, _), cid in zip(contract_rows, con_ids)}
    print(f"contracts: {len(contract_pk)}")

    ci_rows = [{"contractId": connect(contract_pk[it["contract_id"]]),
                "quantity": float(it.get("quantity") or 1),
                "unitPrice": money(it.get("unit_price"), it.get("unit_price_currency"))}
               for it in contract_items if it.get("contract_id") in contract_pk]
    gql_create("createTapdataContractItems", ci_rows)

    inst_rows = []
    for c in contracts:
        parent = contract_pk.get(c["id"])
        if not parent:
            continue
        for n in (1, 2, 3, 4):
            pct, amt = c.get(f"p{n}_percentage"), c.get(f"p{n}_amount")
            status = sel(INST_STATUS, c.get(f"p{n}_status"))
            if not (pct or amt or status):
                continue
            row = {"name": f"{c['contract_number']} P{n}", "contractId": connect(parent),
                   "sequence": n, "percentage": float(pct) if pct else None,
                   "dueDate": c.get(f"p{n}_due_date"), "status": status}
            if amt:
                row["amount"] = money(amt, c.get("amount_currency"))
            if c.get(f"p{n}_invoice_date"):
                row["invoiceDate"] = c[f"p{n}_invoice_date"]
            if c.get(f"p{n}_payment_date"):
                row["paymentDate"] = c[f"p{n}_payment_date"]
            inst_rows.append(row)
    gql_create("createTapdataInstallments", inst_rows)
    print(f"installments: {len(inst_rows)}")

    json.dump({"contracts": contract_pk, "quotes": quote_pk}, open("/tmp/spike-map.json", "w"))
    print("mapping written to /tmp/spike-map.json")


def amount(value):
    if isinstance(value, dict):
        return round((value.get("amountMicros") or 0) / 1_000_000, 2)
    return None


WS_SCHEMA = "workspace_f3kbulr3ayp5xa7i6f93kbmeq"


def twenty_rows(table, cols):
    """Read the computed values straight from Postgres.

    Twenty's REST list ignores `offset`, and the API key bucket (100 req/min) is far too slow
    for a full-table reconciliation, so the check goes to the database.
    """
    select = ", ".join(cols)
    sql = f'select json_agg(row_to_json(t)) from (select {select} from "{WS_SCHEMA}"."{table}") t;'
    out = subprocess.run(["docker", "exec", "-i", "twenty-db-1", "psql", "-U", "postgres", "-d", "default",
                          "-tA", "-F", ","], input=sql.encode(), capture_output=True, check=True).stdout.decode().strip()
    if not out or out == "null":
        return []
    return json.loads(out)


def micro(value):
    return None if value is None else round(float(value) / 1_000_000, 2)


def do_verify():
    contracts, _, _, quotes, _, _, _, _ = fetch_sample()
    tw = {r["contractnumber"]: r for r in twenty_rows(
        "_tapdataContract",
        ['"contractNumber" as contractnumber', '"exchangeRate" as rate',
         '("amountCnyAmountMicros") as cny', '("paymentReceivedAmountMicros") as received',
         '("toInvoicedAmountMicros") as toinvoiced', '("receivableAmountMicros") as receivable',
         '"collectionRate" as pct', '"rateSource" as source'])}
    twq = {r["quotenumber"]: r for r in twenty_rows(
        "_tapdataQuote",
        ['"quoteNumber" as quotenumber', '("amountAmountMicros") as amount',
         '("subtotalAmountMicros") as subtotal', '("discountAmountAmountMicros") as discount'])}

    fields = [("amountCny", "cny", "amount_cny"), ("paymentReceived", "received", "payment_received"),
              ("toInvoiced", "toinvoiced", "to_invoiced"), ("receivable", "receivable", "receivable"),
              ("collectionRate", "pct", "collection_rate"), ("exchangeRate", "rate", "exchange_rate")]
    missing = compared = diff_count = shown = 0
    for c in contracts:
        r = tw.get(c["contract_number"])
        if not r:
            missing += 1
            continue
        compared += 1
        diffs = []
        for label, key, col in fields:
            tvo = micro(r[key]) if key not in ("pct", "rate") else (None if r[key] is None else round(float(r[key]), 6 if key == "rate" else 2))
            esp = round(float(c.get(col) or 0), 6 if key == "rate" else 2)
            if (tvo or 0) != esp and abs((tvo or 0) - esp) > (1e-6 if key == "rate" else 0.005):
                diffs.append((label, tvo, esp))
        if diffs:
            diff_count += 1
            if shown < 12:
                shown += 1
                print(f"  DIFF {c['contract_number']:22} {diffs}")

    qmissing = qcompared = qdiff = shown = 0
    for q in quotes:
        r = twq.get(q["quote_number"])
        if not r:
            qmissing += 1
            continue
        qcompared += 1
        diffs = []
        for label, key, col in (("amount", "amount", "amount"), ("subtotal", "subtotal", "subtotal"),
                                ("discountAmount", "discount", "discount_amount")):
            tvo = micro(r[key]) or 0
            esp = round(float(q.get(col) or 0), 2)
            if abs(tvo - esp) > 0.005:
                diffs.append((label, tvo, esp))
        if diffs:
            qdiff += 1
            if shown < 12:
                shown += 1
                print(f"  DIFF quote {q['quote_number']:24} {diffs}")

    items = twenty_rows("_tapdataQuoteItem", ['"totalAmountAmountMicros" as total'])
    citems = twenty_rows("_tapdataContractItem", ['"totalAmountAmountMicros" as total'])
    insts = twenty_rows("_tapdataInstallment", ['"amountAmountMicros" as amount'])
    print(f"\ncontracts   compared={compared} missing={missing} mismatched={diff_count}")
    print(f"quotes      compared={qcompared} missing={qmissing} mismatched={qdiff}")
    print(f"quoteItems  totalAmount filled: {sum(1 for i in items if i['total'] is not None)}/{len(items)}")
    print(f"contractItems totalAmount filled: {sum(1 for i in citems if i['total'] is not None)}/{len(citems)}")
    print(f"installments amount filled: {sum(1 for i in insts if i['amount'] is not None)}/{len(insts)}")


if __name__ == "__main__":
    (do_verify() if sys.argv[1:2] == ["verify"] else do_import())
