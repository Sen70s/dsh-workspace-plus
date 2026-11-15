# 会话日志上传：DSH 原功能的实现，与本插件的子模块

> 本文记录两件事：DSH 设置里那一行「在使用官方模型 API 时上传 Session Log —— 帮助改进 DeepSeek 模型与产品」到底怎么实现的，以及本插件为什么、怎么把它做成了一个默认关闭的子模块。
>
> 取证对象是 DeepSeek Harness 桌面版的 `app.asar`（解包后逐条 `path:line` 核过）；改造对象是本仓库 v0.7.0。

---

## 一、DSH 原功能是怎么实现的

### 1.1 一句话

它**不是**一个"把日志上传到服务器"的功能，而是**给 DeepSeek 的 `/messages` 请求体加一个兄弟字段** `dsh_session_log`，里面装着会话规范日志的增量片段。没有请求，就没有上传。

### 1.2 三个包分工

| 包 | 角色 |
| --- | --- |
| `@deepseek-ai/dsh-client-ui-settings-session-log` | 浏览器半：设置 → 通用 里的一行开关（`settings.general.item`，`order: 90`），通过 `ctx.configForms` 写回宿主配置 |
| `@deepseek-ai/dsh-session-log-deepseek` | 宿主半：拥有 `dsh_session_log` 字段与"已接受水位"，落成会话日志事件 `session-log-deepseek/delivery-accepted` |
| `@deepseek-ai/dsh-deepseek-llm-api-extensions` | 注册表：一个顶层请求字段只能有一个 provider，重复注册抛错；`prepare()` 并发准备所有字段，2xx 后统一 `accept()` |

配置：`enabled`（默认 `true`，volatile）、`maxBytes`（默认 8 MiB，非 volatile，只有 patch 能改）。namespace 就是 loader 行 id `session-log-deepseek`。出厂由 `dsh-base` 的 patch 挂载，**没有 `disabled`**，所以默认就是开的。

### 1.3 数据流

```text
用户打开开关（设置 → 通用）
	│  configForms.set("enabled", …) → settings.mutate → configEditor
	│  → 原子写 $DSH_HOME/profiles/<name>/cordis.patch.yml
	▼
会话产生事件 → Session.append(...)
	▼  DeepSeek 适配器发模型请求
deepseekLlmApiExtensions.prepare({ sessionId, purpose, signal })
	│  dsh-session-log-deepseek 的 prepare：
	│    · acceptedThrough(session) 折叠出已接受水位
	│    · snapshotEvents() 取水位之后的连续事件
	│    · 按 maxBytes 贪心装箱
	│  → { fields: { dsh_session_log: {...} }, accept }
	▼
POST {messagesApiRoot(baseURL)}/messages      ← 字段是请求体的兄弟键
	├─ HTTP 2xx → extensions.accept()（消费 SSE 之前）
	│      → 追加 delivery-accepted 事件 → 下个请求水位前移
	└─ 传输失败 / 非 2xx / 序列化失败 → 不记接受 → 下次重发同一段
```

### 1.4 线格式 v1

```jsonc
{
  "version": 1,
  "sessionFormatVersion": 4,          // header.version
  "session": { "version": 4, "id": "…", "createdAt": …, "cwd": "…",
               "parentSession": "…?", "seedLength": "…?", "origin": "…?" },
  "afterSeq": -1,                     // 上一次已接受的最后一个 seq
  "throughSeq": 42,                   // 本次送到哪
  "events": [                         // 全部为数字信封字段
    { "seq": 0, "time": …, "type": "user/message", "surfaceOp": "append", "data": {…} }
  ]
}
```

`maxBytes` 记账是**精确**的：先按空 `events` 数组量一次信封并 `-1`（抵消多余的 `]`），逐条加 `1 + jsonBytes(event)`，再加上 `throughSeq` 的位数。装不下的整条留给下次请求；单条就超限则该请求**整个字段省略**、水位停在它前面、每个阻塞事件只告警一次。

### 1.5 三个必须知道的实现事实

**① 它没有"官方"检查。** 唯一条件是"这个请求由 `@deepseek-ai/dsh-llm-deepseek` 发出"。`baseURL` 完全可配，全路径没有任何域名判断。所以：

- DeepSeek 路由指向**第三方中继** → 字段照发到那个中继；
- 反过来说，"在使用官方模型 API 时"这句文案是**不准确的**。

**② 换 provider 就彻底静默。** `dsh-llm-pi-ai` 这类适配器只 `ctx.llm.registerAdapter(...)`，全文件不碰 `deepseekLlmApiExtensions`。注册表根本不会被查询 —— 这就是本子模块存在的理由。

**③ 同一个出口还发 `dsh_plugin_packages`。** `@deepseek-ai/dsh-plugin-package-inventory-deepseek` 用同一注册表、同一条件，内容是已装插件清单。

### 1.6 另一条本来就与 provider 无关的通道

DSH 基座里还有 `ctx.otel`（`dsh-base` 的 patch 无条件挂载，桌面/web profile 必在）+ `dsh-session-telemetry-otel`，发往同一个 collector `https://dsh-otel-collector.deepseeksvc.com/v1/logs`，可用 `DSH_TELEMETRY_OTLP_URL` 覆盖。它是 `FEEDBACK_ONLY`：只有用户显式提交反馈才放行会话前缀，且 `ctx.sessionTelemetry.emit()` 是空操作、无法绕过授权。它不依赖任何模型适配器 —— 本子模块的主通道就是它的公共入口 `ctx.otel.createSessionLogReporter(...)`。

---

## 二、本插件的子模块

### 2.1 为什么这么选

| 方案 | provider 无关 | 零依赖 | 结论 |
| --- | --- | --- | --- |
| `ctx.otel.createSessionLogReporter(...)` | ✅ | ✅ | **主通道** |
| `deepseekLlmApiExtensions` + `dsh_session_log` | ❌ 仅 DeepSeek 适配器 | ✅ | 作**可选补充**，默认关 |
| 注册第二个 `sessionTelemetry` 后端 | — | — | ❌ `provide` 同名直接抛错 |
| 自建 `fetch` + 手写 OTLP JSON | ✅ | ✅ | 留作 `ctx.otel` 缺席时的兜底（未实现） |

`ctx.otel` 同时满足三件事：与模型供应商无关、第三方插件零依赖可达（插件只传普通对象，OTel SDK 类在 DSH 进程里）、目标 collector 与官方一致。它自带 gzip、批处理、逐条字节上限与重试，插件不必自己实现传输。

本仓库是**零依赖、零构建的手写 ESM**，宿主半只能 `import 'node:*'` 与同级相对文件（`tools/verify.mjs` 有正则断言）。上面这个方案正好满足。

### 2.2 落地形态：第三个 loader 行

```yaml
- insert:
    - id: workspaceplus
      name: 'dsh-workspace-plus'
    - id: notice
      name: 'dsh-workspace-plus/notice'
    - id: sessionlog
      name: 'dsh-workspace-plus/sessionlog'
```

```text
lib/sessionlog/
  index.js        宿主半：通道、水位、请求字段、HTTP 路由、收尾
  settings.js     纯设置层：coerce/normalize/compose、store 读写、匿名 id、进程级开关
  wire.js         纯线格式层：OTLP 记录、dsh_session_log v1 装箱
  redact.js       纯脱敏层：两条通道共用，发出前强制过一遍
  package.json    这一行在插件页的展示身份
  icon.svg
  locale/{zh,en}.json
```

浏览器半仍在那一个共享的 `lib/client.js` 里（`dsh.client` 是 bundle 级清单），新增 `settings.section` 一项（`id: sessionlog`、`order: 27`）。行关掉时宿主回 404，页面把那渲染成一句"未启用"而不是错误 —— 与 notice 同一范式。

### 2.3 两条通道

| 通道 | 机制 | 默认 | 覆盖谁 |
| --- | --- | --- | --- |
| **OTLP 会话日志（主）** | `ctx.otel.createSessionLogReporter`，每条规范事件一条记录 | 随总开关，**总开关默认关** | 与 provider 完全无关 |
| **`dsh_session_log` 请求字段（补充）** | 走 `deepseekLlmApiExtensions` | **单独默认关** | 仅官方适配器发请求时；内置包占用则自动跳过 |

第二条默认关，是因为 §1.5 ①：DSH 不校验 baseURL，打开它等于把会话内容交给"那个适配器当前指向的端点"，而页面文案说的是"上传给 DeepSeek"。做成显式 opt-in 后想用的人仍可用（比如官方 baseURL 且卸载了内置包的组合），但不会被默认行为骗到。

### 2.4 几条刻意的设计决定

**水位存在自己的 store，不写进会话日志。** 内置包把接受水位记成 `session-log-deepseek/delivery-accepted` 事件；第三方插件加新事件类型会被 Session 格式迁移拒绝，只能走 `plugin:` 前缀的受检记录。所以水位放在 `~/.dsh/sessionlog/settings.json` 的 `accepted` 里：`{ <sessionId>: { formatVersion, throughSeq } }`，格式代不匹配就丢弃（fork 不继承父水位）。代价是崩溃窗口可能重复上传一段 —— 这正是 at-least-once 的安全方向（接收端按 `(session.id, format_version, event.seq)` 去重）。

**进程级关闭压过页面开关。** `DSH_TELEMETRY_DISABLED`（任意非空值）或 `DSH_TELEMETRY_MODE=DISABLED` 一旦设置，本子模块不发送任何内容，页面上直接写明原因。DSH 自己只用它关掉 `session-telemetry-otel` 那一行、并没有关 `ctx.otel`，所以这个判断必须由插件自己做 —— 否则插件就成了绕过 opt-out 的后门。

**跟随基准 profile 的传输参数。** `scheduledDelayMillis: 10000`、`maxExportBatchSize: 2048`、`exportTimeoutMillis: 1500`、`compression: gzip`、`timeoutMillis: 1000` 全部照抄 `dsh-base` 里那一段，`maxRequestBytes` 默认 4,000,000（SDK 硬上限，只能调低）。

**发出前强制脱敏，且不可关闭。** 会话日志不只含对话，还含每一次工具调用和返回——真实情况里这就意味着 `npm config set …:_authToken=…`、`curl` 回显的 `Authorization` 头、带口令的 git 远端地址、编辑器读到的私钥正文。这些在 `event.data` 里都只是普通字符串，而 DSH 自己的遥测缝**默认不挂任何脱敏规则**，原样出机器。所以本子模块在两条上传通道的入口都先过一遍 `lib/sessionlog/redact.js`：

- 形状匹配而非熵匹配，普通散文和代码不受影响；
- `_authToken=` 这类保留键名、只换值，脱敏后的日志仍读得懂；
- 键名规则是锚定的，`max_tokens` / `maxTokens` / `tokenCount` 这类**统计量不会被误杀**；
- 只在副本上操作，规范日志本身不动；递归超深时整棵子树替换为标记（fail-closed）；
- 设置页显示「已脱敏 N 处凭据」作为回执，因为这是一个没有开关的保证。

它是模式匹配，不是万能的：内网地址、业务数据、自己贴进对话的内容不会被识别。这一点在 README 里也写明了。

**身份沿用同一个匿名 id。** 复用 `$DSH_HOME/.anonymous-user-id`（裸 UUID + 换行、`wx` 先写者胜），与 `@deepseek-ai/dsh-anonymous-user-id` 逐字节兼容，否则同一台机器会在 collector 侧被拆成两个身份。

**覆盖进度不写模型可见内容。** `dsh_session_log` 与 OTLP 记录都不进 `messages` / 系统提示 / 工具 schema，模型输入 token 与 KV cache 前缀均不变。

---

## 三、怎么用

1. 装/升级后重启 `dsh`、刷新页面。
2. 插件页 → `dsh-workspace-plus` 卡片 → 确认 `sessionlog` 这一行是开的（行级开关只决定宿主半在不在；上传本身另有开关）。
3. 设置 → `会话日志`：
   - 打开「上传 Session Log」；
   - 页面实时显示通道状态、已上报事件/会话数、目标端点及其来源（设置页 / 环境变量 / 出厂默认）；
   - 需要换端点就直接填 URL（或用 `DSH_TELEMETRY_OTLP_URL`）。
4. `~/.dsh/sessionlog/settings.json` 可以手改，改完刷新页面。

关闭方式三层，任选：页面开关 → 插件页那一行 → `DSH_TELEMETRY_DISABLED=1`（进程级，最高优先）。

---

## 四、尚未验证 / 需要真机确认

1. **collector 是否接受第三方 `scope.name`。** `dsh-otel` 不会额外加 `x-channel` 头（产品埋点通道才有），理论上应该通，但没有真实探针。验证方法：开启开关跑一轮对话，看页面计数增长且无「最近一次错误」，同时观察是否有 4xx。
2. **超大单条事件。** `assistant/message` 内嵌完整流，个别记录可能超 4 MB；`SessionLogReporter` 的语义是**丢这一条且不截断**（页面会显示队列告警）。目前不做流外挂。
3. **`eventAt()` / `snapshotEvents()` 已标 `@deprecated`。** 请求字段那一路依赖它们；未来 DSH 换 API 时这里要先改。
4. **未做冷补齐。** 只跟随当前进程里活着的会话。`includeHistory` 打开时补的是"本进程内、开关打开之前已产生的"事件，不是磁盘上历史会话的全文；要读磁盘历史需要 `ctx.sessionQuery` / `ctx.sessionPersistence`。
