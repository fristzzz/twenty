#!/usr/bin/env python3
"""Emits src/{ids.ts,objects/*.ts,fields/*.field.ts} for the Tapdata CRM spike app.

Run: APP_DIR=<app root> python3 gen_app.py
Identifiers are written once into src/ids.ts and must never be regenerated —
a changed universalIdentifier is read by the Twenty sync as delete+create.
"""
import os, uuid, pathlib, json

OUT = pathlib.Path(os.environ["APP_DIR"])
pool = [uuid.uuid4() for _ in range(400)]
seq = [0]
IDS = {}

def ident(key):
    if key not in IDS:
        seq[0] += 1
        IDS[key] = str(pool[seq[0] - 1])
    return IDS[key]

OBJECTS = {
    "product":      ("tapdataProduct",     "tapdataProducts",     "Tapdata 产品",    "Tapdata 产品",  "IconPackage"),
    "quote":        ("tapdataQuote",       "tapdataQuotes",       "Tapdata 报价单",  "Tapdata 报价单", "IconReceipt2"),
    "quoteItem":    ("tapdataQuoteItem",   "tapdataQuoteItems",   "报价行",          "报价行",        "IconList"),
    "contract":     ("tapdataContract",    "tapdataContracts",    "Tapdata 合同",    "Tapdata 合同",  "IconFileInvoice"),
    "contractItem": ("tapdataContractItem","tapdataContractItems","合同行",          "合同行",        "IconList"),
    "installment":  ("tapdataInstallment", "tapdataInstallments", "回款分期",        "回款分期",      "IconCashRegister"),
}
for k in OBJECTS:
    ident(f"object:{k}")

SELECTS = {
    "productCategory": [("LDP_PERPETUAL","LDP - Perpetual"),("LDP_SUBSCRIPTION","LDP - Subscription"),("TAPDB_SUBSCRIPTION","TAPDB - Subscription"),("MDB_LICENSE","MDB - License"),("PS_LDP_PRODUCT","PS - LDP Product Service"),("PS_LDP_PROJECT","PS - LDP Project Service"),("PS_MDB_OPS_MS","PS - MDB OPS & MS"),("PS_MDB_PROJECT","PS - MDB Project Service")],
    "priceUnit":       [("NODE","节点"),("SET","套"),("MAN_DAY","人天"),("YEAR","年"),("MONTH","月")],
    "taxRate":         [("RATE_13","13%"),("RATE_6","6%"),("RATE_0","0%")],
    "productStatus":   [("ACTIVE","Active"),("INACTIVE","Inactive")],
    "quoteStage":      [("DRAFT","Draft"),("NEGOTIATING","Negotiating"),("APPROVED","Approved"),("DELIVERED","Delivered"),("ACCEPTED","Accepted"),("DECLINED","Declined")],
    "contractStatus":  [("DRAFT","草稿"),("PENDING","待签"),("SIGNED","已签"),("EXECUTING","执行中"),("COMPLETED","已完成"),("CANCELLED","已作废")],
    "agreementType":   [("PRODUCT_SERVICE_ORDER","产品及服务订单"),("PRODUCT_CONTRACT","产品合同"),("SERVICE_AGREEMENT","服务合同/协议"),("FRAMEWORK_ORDER","框架协议及订单"),("PROJECT_CONTRACT","项目合同")],
    "installmentMethod": [("ONE","一期结算"),("TWO","分两期结算"),("THREE","分三期结算"),("FOUR","分四期结算"),("FIVE","分五期结算")],
    "installmentStatus": [("PENDING_INVOICE","待开票"),("INVOICED_PENDING_PAYMENT","已开票待收款"),("PAID","已收款"),("PAID_PENDING_INVOICE","已收款待开票")],
}
COLORS = ["gray", "orange", "purple", "blue", "green", "red", "sky", "pink"]
ICONS = {"TEXT": "IconAbc", "NUMBER": "IconNumber123", "CURRENCY": "IconCoins", "DATE": "IconCalendar", "SELECT": "IconSelector"}

FIELDS = []
def F(obj, name, ftype, label, **kw):
    key = f"field:{obj}.{name}"
    ident(key)
    if "optionsKey" in kw:
        kw["options"] = [
            {"optKey": f"option:{kw['optionsKey']}:{i}", "optId": ident(f"option:{kw['optionsKey']}:{i}"),
             "value": code, "label": label, "position": i, "color": COLORS[i % len(COLORS)]}
            for i, (code, label) in enumerate(SELECTS[kw["optionsKey"]])
        ]
    FIELDS.append(dict(key=key, obj=obj, name=name, type=ftype, label=label, **kw))

F("product", "name", "TEXT", "名称")
F("product", "productCode", "TEXT", "产品编码", isUnique=True)
F("product", "category", "SELECT", "类别", optionsKey="productCategory")
F("product", "unitPrice", "CURRENCY", "标准单价")
F("product", "priceUnit", "SELECT", "计价单位", optionsKey="priceUnit")
F("product", "taxRate", "SELECT", "税率", optionsKey="taxRate")
F("product", "status", "SELECT", "状态", optionsKey="productStatus", default="ACTIVE")

F("quote", "name", "TEXT", "名称")
F("quote", "quoteNumber", "TEXT", "报价编号", isUnique=True)
F("quote", "stage", "SELECT", "阶段", optionsKey="quoteStage", default="DRAFT")
F("quote", "validUntil", "DATE", "有效期至")
F("quote", "subtotal", "CURRENCY", "小计")
F("quote", "discountAmount", "CURRENCY", "折扣金额")
F("quote", "amount", "CURRENCY", "报价总额")
F("quote", "termsAndConditions", "TEXT", "条款与条件")

F("quoteItem", "description", "TEXT", "描述")
F("quoteItem", "quantity", "NUMBER", "数量")
F("quoteItem", "listPrice", "CURRENCY", "目录价")
F("quoteItem", "unitPrice", "CURRENCY", "成交单价")
F("quoteItem", "discountPercentage", "NUMBER", "折扣(%)")
F("quoteItem", "totalAmount", "CURRENCY", "行金额")

F("contract", "name", "TEXT", "名称")
F("contract", "contractNumber", "TEXT", "合同编号", isUnique=True)
F("contract", "signDate", "DATE", "签约日期")
F("contract", "status", "SELECT", "状态", optionsKey="contractStatus", default="DRAFT")
F("contract", "agreementType", "SELECT", "协议类型", optionsKey="agreementType")
F("contract", "amount", "CURRENCY", "合同金额(原币)")
F("contract", "exchangeRate", "NUMBER", "汇率")
F("contract", "rateDate", "DATE", "汇率日期")
F("contract", "rateSource", "TEXT", "汇率来源")
F("contract", "amountCny", "CURRENCY", "合同金额(CNY)")
F("contract", "installmentMethod", "SELECT", "结算方式", optionsKey="installmentMethod")
F("contract", "paymentReceived", "CURRENCY", "已回款")
F("contract", "toInvoiced", "CURRENCY", "待开票")
F("contract", "receivable", "CURRENCY", "未回款")
F("contract", "collectionRate", "NUMBER", "回款率(%)")

F("contractItem", "description", "TEXT", "描述")
F("contractItem", "quantity", "NUMBER", "数量")
F("contractItem", "unitPrice", "CURRENCY", "单价")
F("contractItem", "totalAmount", "CURRENCY", "行金额")

F("installment", "name", "TEXT", "期次名称")
F("installment", "sequence", "NUMBER", "期次")
F("installment", "percentage", "NUMBER", "比例(%)")
F("installment", "amount", "CURRENCY", "本期金额")
F("installment", "dueDate", "DATE", "应收日期")
F("installment", "status", "SELECT", "开票/收款状态", optionsKey="installmentStatus", default="PENDING_INVOICE")
F("installment", "invoiceDate", "DATE", "开票日期")
F("installment", "paymentDate", "DATE", "收款日期")

RELATIONS = {}
def R(a_obj, a_name, a_label, b_obj, b_name, b_label, join_column, on_delete="SET_NULL"):
    a_key, b_key = f"field:{a_obj}.{a_name}", f"field:{b_obj}.{b_name}"
    ident(a_key); ident(b_key)
    RELATIONS[a_key] = dict(obj=a_obj, name=a_name, label=a_label, target=b_obj, targetField=b_key,
                            kind="MANY_TO_ONE", joinColumn=join_column, onDelete=on_delete)
    RELATIONS[b_key] = dict(obj=b_obj, name=b_name, label=b_label, target=a_obj, targetField=a_key,
                            kind="ONE_TO_MANY", joinColumn=None, onDelete=None)

R("quoteItem", "quote", "所属报价单", "quote", "items", "报价行", "quoteId", on_delete="CASCADE")
R("contractItem", "contract", "所属合同", "contract", "items", "合同行", "contractId", on_delete="CASCADE")
R("installment", "contract", "所属合同", "contract", "installments", "回款分期", "contractId", on_delete="CASCADE")
R("quoteItem", "product", "产品", "product", "quoteItems", "报价行", "productId")
R("contractItem", "product", "产品", "product", "contractItems", "合同行", "productId")
R("contract", "quote", "来源报价单", "quote", "contracts", "关联合同", "quoteId")
R("quote", "company", "客户公司", "std_company", "quotes", "报价单", "companyId")
R("contract", "company", "客户公司", "std_company", "contracts", "合同", "companyId")

# ------------------------------------------------------------------ emitters
def ts(v):
    return json.dumps(v, ensure_ascii=False)

def field_literal(f):
    out = [f"universalIdentifier: IDS[{ts(f['key'])}]",
           f"type: FieldType.{f['type']}",
           f"name: {ts(f['name'])}",
           f"label: {ts(f['label'])}",
           f"icon: {ts(ICONS[f['type']])}"]
    if f["type"] == "SELECT":
        opts = ",\n      ".join(
            "{ id: IDS[%s], value: %s, label: %s, position: %d, color: %s }" %
            (ts(o["optKey"]), ts(o["value"]), ts(o["label"]), o["position"], ts(o["color"]))
            for o in f["options"])
        out.append("options: [\n      " + opts + ",\n    ]")
    if f.get("default"):
        out.append("defaultValue: %s" % ts("'" + f["default"] + "'"))
    else:
        out.append("isNullable: true")
        out.append("defaultValue: null")
    if f.get("isUnique"):
        out.append("isUnique: true")
    return "    {\n      " + ",\n      ".join(out) + ",\n    }"

def ui_ref(obj_key):
    if obj_key == "std_company":
        return "STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier"
    return f"OBJECT_UI[{ts(obj_key)}]"

for key, (name_s, name_p, lab_s, lab_p, icon) in OBJECTS.items():
    own = [f for f in FIELDS if f["obj"] == key]
    body = ",\n".join(field_literal(f) for f in own)
    src = f"""import {{ defineObject, FieldType }} from 'twenty-sdk/define';
import {{ IDS, OBJECT_UI }} from '../ids';

export const {key.upper()}_UI = OBJECT_UI[{ts(key)}];

export default defineObject({{
  universalIdentifier: {key.upper()}_UI,
  nameSingular: {ts(name_s)},
  namePlural: {ts(name_p)},
  labelSingular: {ts(lab_s)},
  labelPlural: {ts(lab_p)},
  description: {ts('Spike 建模：' + lab_s)},
  icon: {ts(icon)},
  labelIdentifierFieldMetadataUniversalIdentifier: IDS[{ts(own[0]['key'])}],
  fields: [
{body},
  ],
}});
"""
    (OUT / "src" / "objects").mkdir(parents=True, exist_ok=True)
    (OUT / "src" / "objects" / f"{key}.object.ts").write_text(src)

(OUT / "src" / "fields").mkdir(parents=True, exist_ok=True)
for rel_key, rel in RELATIONS.items():
    settings = f"    relationType: RelationType.{rel['kind']},\n"
    if rel["kind"] == "MANY_TO_ONE":
        settings += (
            f"    onDelete: OnDeleteAction.{rel['onDelete']},\n"
            f"    joinColumnName: {ts(rel['joinColumn'])},\n"
        )
    src = (
        "import {\n"
        "  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,\n"
        "  defineField,\n"
        "  FieldType,\n"
        "  OnDeleteAction,\n"
        "  RelationType,\n"
        "} from 'twenty-sdk/define';\n"
        "import { IDS, OBJECT_UI } from '../ids';\n\n"
        f"export const FIELD_ID = IDS[{ts(rel_key)}];\n\n"
        "export default defineField({\n"
        "  universalIdentifier: FIELD_ID,\n"
        f"  objectUniversalIdentifier: {ui_ref(rel['obj'])},\n"
        "  type: FieldType.RELATION,\n"
        f"  name: {ts(rel['name'])},\n"
        f"  label: {ts(rel['label'])},\n"
        "  icon: 'IconRelationManyToMany',\n"
        "  isNullable: true,\n"
        f"  relationTargetObjectMetadataUniversalIdentifier: {ui_ref(rel['target'])},\n"
        f"  relationTargetFieldMetadataUniversalIdentifier: IDS[{ts(rel['targetField'])}],\n"
        "  universalSettings: {\n"
        + settings +
        "  },\n"
        "});\n"
    )
    safe = rel_key.split(":")[1].replace(".", "__")
    (OUT / "src" / "fields" / f"{safe}.field.ts").write_text(src)

lines = ["// Stable identifiers for every entity in this app.",
         "// Do not regenerate: the sync diff reads a changed universalIdentifier as delete + create.",
         "export const IDS = {"]
for k, v in sorted(IDS.items()):
    lines.append(f"  {ts(k)}: {ts(v)},")
lines += ["} as const;", "", "export const OBJECT_UI = {"]
for k in OBJECTS:
    lines.append(f"  {ts(k)}: IDS[{ts('object:' + k)}],")
lines += ["} as const;", ""]
(OUT / "src").mkdir(parents=True, exist_ok=True)
(OUT / "src" / "ids.ts").write_text("\n".join(lines))
print(f"objects={len(OBJECTS)} fields={len(FIELDS)} relation_fields={len(RELATIONS)} identifiers={len(IDS)}")
