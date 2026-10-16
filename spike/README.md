# Twenty CRM 迁移可行性 Spike（Tapdata order-to-cash）

目的：用最小成本验证「Twenty CRM 能不能替代当前 EspoCRM fork」。做法：把 fork 的
Product / Quote(+Item) / Contract(+Item+分期) 建模 + 核心算价/汇率/回款逻辑移植成
Twenty app，灌入真实历史数据，与 Espo 存量值逐分对账。

日期：2026-10-12。Twenty 版本：**v2.45.0**（fork：`github.com/fristzzz/twenty`，
本地克隆 `~/app/twenty`，检出 tag `twenty/v2.45.0`）。

## 现在能看什么

| 项 | 值 |
|---|---|
| 地址 | http://100.64.208.4:8091/ |
| 登录 | `admin@tapdata.dev` / `TapSpike2026`（workspace：Tapdata Spike） |
| 侧边栏 | Tapdata 合同 / 报价单 / 产品 / 回款分期 / 合同行 / 报价行 |
| 数据量 | 15 合同、24 分期、8 报价、19 报价行、19 合同行、40 产品、9 公司（均从 Espo 真实记录抽取） |
| 服务端 | tapdata `~/app/twenty-deploy`（compose）；容器 `twenty-server` `twenty-worker` `twenty-db`(PG16) `twenty-redis`，restart=always |
| App 源码 | 服务器 `~/app/twenty-spike/tapdata-crm`；本目录 `tapdata-crm/src` 是同一份（改完 rsync 过去再 `twenty apply`） |

## 对账结果（Twenty 实时计算 vs Espo 存量值，精确到分）

| 指标 | 结果 |
|---|---|
| 报价单 amount / subtotal / discountAmount | **8/8 完全一致**（行 unitPrice、totalAmount 由移植逻辑反推，未导入） |
| 合同 amountCny、exchangeRate | **15/15 一致**（历史汇率按 `Manual Override` 导入后逻辑不再重算，与 Espo 同规则） |
| paymentReceived / receivable / collectionRate | **15/15 一致** |
| toInvoiced | 14/15；唯一差异 `20260701P001`：Espo 存量 66,666.66，而它自己的 p1..p4 行合计上限只有 38,000 → **Espo 侧脏数据（汇总只在合同行 save 时刷新）**，Twenty 实时算出 19,000 |
| 实时汇率链路 | 单独验证：改合同 amount → 异步重算，Frankfurter 2026-01-15 USD→CNY **6.9673**，amountCny 随之更新（2–5s） |

结论：**领域模型与财务逻辑可以移植且结果可复现**；差异点全部来自 Twenty 缺少
before-save 钩子/汇总字段，需要用逻辑函数 + 值比较防递归来实现。

## 移植时的真实约束（都是踩出来的，不是查文档查到的）

1. **枚举 value 必须是 ASCII 大写码**（`INVALID_FIELD_INPUT: Value must be in UPPER_CASE and follow snake_case`）。
   fork 里把中文当枚举值（`已收款`、`13%`）的做法必须改成 `value=PAID` + `label=已收款`；
   而 Twenty 一个选项只有一个 label，**没有 Espo 那种 en_US/zh_CN 双份选项文案**——双语 UI 是缺口。
2. **`position` 是保留字段名**，分期表只能改名 `sequence`。
3. **汇总/公式/必填字段没有**：官方 FAQ 说 formula fields「H2 2026」，自定义字段不能必填。
   fork 的 4 段 PHP 钩子逻辑全部变成 TypeScript 逻辑函数（`databaseEventTriggerSettings`）。
4. **没有 before-save**：只有 after 事件 → 自己写「值不同才更新」的幂等守卫防递归回环。
5. **自托管默认跑不了逻辑函数**：`LOGIC_FUNCTION_TYPE` 默认 Disabled，而且官方 docker-compose.yml
   根本没转发这个变量。不加 → 逻辑函数静默不执行。见 `deploy/docker-compose.yml`（本 spike 已加）。
6. **数据库事件里函数报错不在 worker 日志里暴露**；把同一段逻辑再挂一个 HTTP route 函数
   （本 spike 的 `/s/tapdata/recalculate`）能直接拿到错误文本，是有效的排错入口。
7. **API key 限流 100 次 / 60 秒**：按 5.8k 条记录逐行 REST 写入完全不可行；
   改用 GraphQL 批量 `createTapdataXxx(data: [...])`，115 行 / ~10 请求 / 1.2 秒完成。
8. **REST 的关系写入传外键值**（`companyId`），`{connect:{id}}` 形式在 REST 与 workspace GraphQL 上都被拒。
9. **Currency 是复合值** `{amountMicros, currencyCode}`；未赋值的字段返回
   `{amountMicros: null, currencyCode: null}` 而不是 null——判空必须看 amountMicros，
   否则派生单价那类逻辑会静默算成 0（本 spike 第一版就踩了这个）。
10. **自定义对象表在工作区 schema 里带下划线前缀**（`_tapdataContract`），运维/查库要知道。
11. **首次 workspace 必须 activate**：`signUp` + `signUpInNewWorkspace` 之后对象/角色都还没装，
    要调 `activateWorkspace`，否则 API key 都建不出来。headless 全流程见 `bootstrap-workspace.sh`。

## 目录

```
spike/
  bootstrap-workspace.sh          # signUp → activateWorkspace → createApiKey → generateApiKeyToken
  gen_app.py                      # 生成 src/{ids.ts,objects/*,fields/*}（UUID 已冻结，勿再重跑生成）
  tapdata-crm/src/                # Twenty app：6 对象、48 字段、16 关系字段、4 逻辑函数
  tools/import_to_twenty.py       # Espo 抽取 + GraphQL 批量灌入 + 逐分对账（import|verify）
  tools/inspect_inst.py           # 单合同分期原始值查看（排错用）
  deploy/docker-compose.yml       # 加了 LOGIC_FUNCTION_TYPE 的官方 compose
  deploy/twenty-cli.sh            # node:24 容器里跑 yarn twenty（host 只有 node 22）
```

在服务器上的操作循环：

```bash
rsync -az --delete ~/app/twenty/spike/tapdata-crm/src/ tapdata@100.64.208.4:~/app/twenty-spike/tapdata-crm/src/
ssh tapdata@100.64.208.4 'cd ~/app/twenty-spike/tapdata-crm && ~/app/twenty-spike/twenty-cli.sh twenty apply --force'
ssh tapdata@100.64.208.4 'cd ~/app/twenty-spike/tools && python3 import_to_twenty.py import && python3 import_to_twenty.py verify'
```

## 还没验证的（下一步要看才知道）

看板/日历视图的配置化生成（自动生成的只有 TABLE）、zh-CN 界面翻译完整度、附件与 PDF 生成、
行级权限（Organization 付费档）、仪表盘、邮件/日历同步、升级节奏带来的回归成本（v2.45 发布仅一周前）。

## 与 Espo fork 的对应关系（移植地图）

| Espo fork | Twenty spike |
|---|---|
| `custom/Espo/Modules/Tapdata*` entityDefs JSON | `tapdata-crm/src/objects/*.object.ts` + `fields/*.field.ts` |
| `Hooks/*/CalculationHook.php`、`ExchangeRateHook.php` | `logic-functions/recalc-quote-on-item-change.ts`、`sync-contract.ts`、`sync-contract-on-installment-change.ts` |
| `Services/TapdataExchangeRateService.php`（本地汇率表 → Frankfurter → 兜底） | `utils/fx.ts`（**没有本地汇率缓存表**，二级回退） |
| `Controllers/*/postActionRecalculate`、`postActionFetchRate` | `logic-functions/recalculate-manual.ts`（HTTP route `/s/tapdata/recalculate`） |
| p1..p4 扁平 24 列 | 子对象 `tapdataInstallment`（真实数据里出现「分五期结算」，扁平列放不下） |
| `Acl/DeleteRestrictedAccessChecker.php` | app 角色 `canDestroyAllObjectRecords: false` + 角色级 Delete 开关（**没有**「按角色放行/拦截单个实体的自定义代码」那么灵活） |
| `metadata/app/formula.json` 自定义函数 | 无对应物（formula fields 未发布） |
