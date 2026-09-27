# dsh-workspaceplus

DeepSeek Harness Web GUI 的插件。一个功能，两个入口：

| 入口 | 说明 |
| --- | --- |
| **工作区行上的目录按钮**（弹窗） | 一个工作区登记 N 个目录，每个目录带标签；标签在对话里可直接指代 |
| **设置 → `workspace+`** | 一个开关：是否对**默认工作区**启用本功能（**默认关闭**） |

功能 2 解决的问题：一个工作区（DSH 里 = 一个目录）装不下真实项目。前后端分在两个仓库、文档在第三个目录时，
每次都要在对话里手写绝对路径，而且目录名相似时 agent 容易改错文件。本插件让工作区带上
「标签 → 绝对路径」映射，并**在每个请求里把这张表注入 agent 上下文**，于是：

> 用户：`把 backend 的登录接口改成 JWT`
>
> agent 直接去 `D:\proj\backend`，不会因为旁边有个 `D:\proj\backend-legacy` 而改错。

> 本仓库只包含插件本身；没有改动 DSH 安装目录里的任何文件。state 文件由插件自己写在 `~/.dsh/workspaceplus/`。

## 目录结构

```
dsh-workspaceplus/
├── package.json        # dsh.bundle（patch 层）+ dsh.client（浏览器半声明）
├── cordis.patch.yml    # bundle 层：insert 一行 name: 'dsh-workspaceplus'
├── lib/
│   ├── index.js        # 宿主半：store + 设置 + 上下文注入 + workspace_dirs 工具 + HTTP 路由
│   └── client.js       # 浏览器半：设置页 + 目录弹窗 + 工作区行按钮（无需构建）
├── icon.svg            # 插件管理页显示的图标
├── tools/verify.mjs    # 离线自检（258 项断言，不需要 DSH 在跑）
└── README.md
```

`lib/` 下两个文件都是**手写源码，不需要任何构建步骤**。`lib/client.js` 按 DSH 客户端模块加载器要求的
`window.__ModuleLoader__.load({ id, factory })` 工厂式 CJS 形态书写。

## 设置：设置 → `workspace+`

一个开关：**对默认工作区启用**。

「默认工作区」是 DSH 首次启动时自动创建的那个（`workspaceRegistry` 里 `defaultWorkspaceId`
指向它，即使它的注册被删掉这个身份也会保留）。它属于产品而不属于本插件，所以：

- **默认关闭**：不在它的工作区行显示目录按钮，不把标签表注入它的会话上下文，`workspace_dirs`
  工具对它直接返回一个指向上面的开关的错误。
- 其它工作区不受影响，始终启用。
- 打开开关后立即生效（无需重启、无需刷新）：行按钮出现、上下文开始注入。关掉不会删除已登记的标签。

宿主怎么认出默认工作区：它只调用**公开的** `workspaceRegistry.initializeDefault()`，
并传一个「拒绝创建」的目录解析器 —— 已有默认工作区时该调用直接返回它（无副作用），
注册表非空时返回 `undefined`，只有在**真的会创建**工作区的那条路径上才会走到解析器、抛错、被捕获。
所以这个探测永远不会替你凭空创建一个工作区。

> 首次探测可能早于注册表服务初始化完成而失败。失败时状态保持「未决」并在下一次请求/工具调用时重试，
> 而不是把「没有默认工作区」永久缓存下来 —— 否则默认工作区会被静默启用。

## 功能是怎么工作的

### 数据

一份插件自己的状态文件，键是工作区目录（大小写无关）：

```json
{
  "version": 1,
  "workspaces": {
    "d:\\plugins\\dsh\\dsh-workspaceplus": {
      "path": "D:\\plugins\\dsh\\dsh-workspaceplus",
      "dirs": [
        { "label": "backend", "path": "D:\\proj\\backend", "note": "后端 API" },
        { "label": "docs",    "path": "D:\\docs" }
      ]
    }
  }
}
```

位置：`$DSH_HOME/workspaceplus/directories.json`（没设 `DSH_HOME` 时用 `~/.dsh/...`）。
写入是「临时文件 + rename」，中途崩溃不会留下半个文件；文件损坏或缺失时按空配置启动，不会拖垮 DSH 启动。
也可以直接手改这个文件，改完刷新页面即可。

### 三条注入路径

1. **上下文（自动，主要机制）** —— 宿主半注册了一个 runtime-context 贡献
   `workspaceplus:directories`（order 130，紧跟在 sandbox/approval 那组之后）：

   ```js
   ctx.systemPrompt.context({
     name: 'workspaceplus:directories',
     order: 130,
     text: (context) => {
       const cwd = context.agent?.session?.header?.cwd
       // 该 cwd 没有登记目录时返回 ''，空上下文不产生任何 token 开销
     },
   })
   ```

   于是**每次请求**该工作区会话都能看到标签表，不需要工具调用。表里给的是绝对路径，并明确写了
   「不要根据目录名相似去推测位置」「标签不区分大小写」「只在标签目录和工作区根目录内工作」等规则。

2. **工具（按需）** —— `workspace_dirs`，宿主半用 `ctx.tools.register()` 注册：

   ```
   workspace_dirs { action: list|add|remove|update, label?, path?, note?, workspace? }
   ```

   `workspace` 省略时用当前会话的 cwd，所以用户在对话里说「加一个 infra 指向 D:\deploy」，
   agent 直接就能落库。同时也用于确认映射（例如上下文被压缩掉之后）。

3. **HTTP 路由（给界面用）** —— `POST/GET /workspaceplus/api`，与页面同源，
   沿用壳层的 `ctx.connection.admit(req)` 鉴权。

### 界面：一个弹窗，两个触发器

弹窗本身注册在 **`shell.overlay`** —— 和壳层自己的「重命名工作区 / 删除工作区」对话框同一个层
（那两个是 `workspace.session-rename`、`workspace.session-archive`），所以观感和层级天然一致。

**主触发器：工作区行上的目录按钮。** 这里要说清楚一件事：

> 工作区那一行的「...」菜单在官方实现里是**硬编码的 Rename/Delete**，没有插件槽位。
> `dsh-client-ui-workspace` 的源码注释原文是
> 「Workspace row menus are visual-only except Rename/Delete」，
> 代码里 `ProjectRowItem` 也只收到 `actions: { rename, delete }`。

所以「往那个菜单里加一项」无法用官方 API 做到。替代方案是把按钮**追加到该行的操作区**
（`rowActions`），定位不依赖易变的哈希类名，而用壳层自己发出的稳定锚点：

- `data-slot="sidebar.workspaces"` —— 渲染器给每个 slot 出口都加的锚（`SlotOutlet`）
- `data-row-key="workspace:<workspaceId>"` —— 工作区分组行自带，且
  `buildGroup(workspace.workspaceId, workspace.workspaceId, …)` 保证这个 key **就是** workspace id，
  与宿主 `workspaceRegistry` 的 `Workspace.id`（客户端 `workspaceView().workspaceId`）一致

按钮**追加在操作区的最后**（React 的 child 协调不需要在它前面插入），并用 `MutationObserver`
做增删对账 —— React 重渲染时并不知道这个节点的存在。点击时 `preventDefault + stopPropagation`，
所以不会触发行本身的展开/折叠。

外观上刻意对齐壳层自己的行内按钮（`Rows.module.css` 的 `.iconButton`）：16×16、无边框、无底色、
`color: label-tertiary`，**hover 只变颜色不加背景**；图标直接复用官方的文件夹图形
（`IconFolderOpenArtwork` 的路径数据，静态内联，不引入运行时依赖），所以和旁边的「...」「＋」是同一套视觉。

**兜底触发器：侧边栏 `workdirs` 条目。** 只有当工作区行按钮**装不上**时才注册（比如将来壳层改了行 DOM，
或这个工作区列表还是空的）。注册它会连带一个 `main` key：壳层的侧边栏面板按钮**无条件**调用
`layout.selectPanel(id)`，对一个没有注册 `main` key 的 id 会直接抛错，所以那个 key 必须存在，
由一个提示面板占着，同时图标的点击被 `stopPropagation` 截住、改为打开弹窗。健康环境下
侧边栏不会多出任何图标（有一个 1.2s 的 settle 窗口避免闪烁）。

弹窗**锁定触发它的那个工作区**：从哪个工作区行点的，就只编辑那个工作区，弹窗里没有选择器，
只显示工作区名和根目录。位于工作区根目录之外的目录会被标出来（见下面的沙箱一节）。
如果 HTTP 通道不可用，弹窗会明确说明原因（区分 401 / 404 / 传输不可达），而不是假装映射是空的 ——
此时仍然可以在对话里用 `workspace_dirs` 管理。

**添加目录时可以用系统的目录选择器**：路径输入框旁边的「浏览…」调用壳层自己的
`ctx.uiWorkspace.pickDirectory()`（就是「选择工作区」用的那一个），所以桌面版是原生对话框、
浏览器版是壳层的浏览面板。选中后自动填路径，**标签为空时**还会按目录名猜一个合法标签
（`D:\proj\my api` → `my-api`；纯中文目录名不猜，避免塞一个宿主会拒绝的标签）。取消选择不会改动任何字段。
`ui-workspace` 没有挂载时（合成里没有这一行）整个按钮自动置灰，插件其余部分照常工作。

> 唯一的例外是兜底入口：它是全局的、没有工作区上下文，所以那条路径下弹窗会退回显示选择器。
> 正常使用中不会看到它。

## ⚠ 沙箱：一个会话只有一个可写根

DSH 的沙箱策略把每个会话的可写范围限定在 `SessionHeader.cwd`（也就是工作区目录）；
`SandboxExecutionPolicy` 不支持额外的可写根（这是 `dsh-sandbox-policy` 明确记录的限制）。
所以：

| 目录位置 | `danger-full-access` | `workspace-write` / `read-only` |
| --- | --- | --- |
| 工作区内（含子目录） | 可写 | 可写 |
| 工作区之外 | 可写 | **只能读**，写入需要按工具返回的提示走一次 `sandbox_permissions` 升级（需要你批准） |

**推荐用法**：把工作区建在几个工程的**共同父目录**上，然后把这些工程登记为标签目录。
例如工作区 = `D:\proj`，标签 `frontend → D:\proj\frontend`、`backend → D:\proj\backend`。
这样全部落在可写根内，标签路由和沙箱都满意。

父目录不会被“浪费上下文”：cwd 本身只是一个路径字符串，成本和其他路径一样；真正的浪费来自 agent 在父目录里
无范围地 `**/*` 乱扫。注入的上下文已经明确禁止这件事（规则 3：只在标签目录和工作区根目录内工作、
不要扫描同级目录、不要用无范围模式“先找找看”），定位文件一律先按标签选目录。

### 为什么不能“在沙箱内加一个可写根”

这不是配置问题，是设计上没有这个口子，我核对过实现：

```js
// @deepseek-ai/dsh-sandbox/lib/roots.js
function writableRoots(policy) {
  if (policy.mode !== 'workspace-write') return []
  return [...new Set([policy.workspaceRoot, '/tmp', tmpdir()].map(canonicalPath))]
}
```

`workspace-write` 的可写集合永远只有「会话 cwd + 平台临时目录」；`SandboxExecutionPolicy` 里也没有额外根的位置。

而且 **symlink / junction 也绕不过去**：

```js
// @deepseek-ai/dsh-fs-sandbox/lib/index.js
const fresh = await this.resolve(target.displayPath)   // realpath 到最深的已存在祖先
for (const root of writableRoots(policy)) if (await isPathUnder(fresh.targetKey, root)) { contained = true; break }
```

两边都做 canonical（realpath）后再比包含关系，所以「在工作区里放一个指向外部目录的软链接」
会被解析回外部真实路径，照样 `FS_SANDBOX_DENIED`。唯一合法的放宽方式是**逐次调用**的升级
（`sandbox_permissions` + `justification` → 批准），跨根写入即等于每一次都升到 `danger-full-access`。

### 工程确实跨盘符时

没有任何共同父目录，此时只有两条路：

1. 会话权限切到 `danger-full-access`；
2. 保持 `workspace-write`，接受每次越界写入弹一次批准（agent 会按工具提示发起升级）。

插件本身不做任何绕过沙箱的事，只是把限制如实告诉 agent（上下文里会标注哪些目录在根目录之外）
和界面（行尾标注「工作区根目录之外」）。

## 安装

从 npm 安装（推荐）：

```sh
dsh plugin --profile desktop add dsh-workspaceplus
```

也可以直接从 GitHub 或本地 checkout 安装：

```sh
dsh plugin --profile desktop add github:Sen70s/dsh-workspace-plus
dsh plugin --profile desktop add D:\plugins\dsh\dsh-workspaceplus
```

`lib/` 是仓库里已提交的产物、包内没有 `prepare` 构建脚本，所以上面三种方式都不需要
pnpm 的 `allowBuilds` 构建授权，装到的就是可直接加载的代码。想锁定版本可以用
`github:Sen70s/dsh-workspace-plus#v0.1.0`。要求 DSH `>=0.1.7-rc.2`（桌面版当前就是
`@deepseek-ai/dsh-desktop 0.1.7-rc.2`；npm 上是 `next` 通道）。

装完后**重启 `dsh`** 并刷新页面。悬停任一工作区那一行，操作区会多出一个目录图标，点它打开弹窗；
设置面板里会多出一个 `workspace+` 分区（默认工作区默认关闭，见下一节）。

卸载：

```sh
dsh plugin --profile desktop remove dsh-workspaceplus
```

## 使用

界面上：悬停工作区行 → 点目录图标 → 填「标签 / 绝对路径 / 说明」→ 添加。弹窗已经锁定在这个工作区上，
不需要（也不能）再选一次。默认工作区要先在 设置 → `workspace+` 里打开开关，它的行上才会出现那个图标；
此时也可以直接在设置页里管理，或让 agent 用 `workspace_dirs`。

对话里（工作区 = `D:\proj`）：

- 「把 `D:\proj\backend` 加为 backend 标签，说明写后端 API」→ agent 调 `workspace_dirs add`
- 「现在有哪些标签？」→ `workspace_dirs list`
- 「把 backend 改指向 `D:\proj\backend-v2`」→ `workspace_dirs update`
- 「删掉 docs 标签」→ `workspace_dirs remove`
- 之后：「backend 加个健康检查接口」→ agent 直接用 `D:\proj\backend` 的绝对路径

## 自检

不需要安装、不需要 DSH 在跑：

```sh
node tools/verify.mjs
```

它会（当前 `283/283 checks passed`，另有 1 项按环境跳过）：

- 校验 manifest、patch 层、`dsh.client.inject` 的取值；
- 用临时 `DSH_HOME` 运行宿主半：标签/路径校验、增删改、去重、大小写折叠、损坏文件容错、原子写；
- 用假的 Cordis ctx 验证三处注册，并**真实执行** `workspace_dirs` 的 list/add/remove；
- 用假的 `node:http` req/res 真实调用 HTTP 路由的 GET/POST/405/401 分支；
- 在 `node:vm` 里加载浏览器半，用**最小 DOM 替身**（只实现本插件用到的那几个选择器）真实驱动
  工作区行按钮：挂载前不误报、按行注入、未分组行跳过、重复对账幂等、行移除后回收、
  点击只开弹窗而不冒泡到行、dispose 清理干净；
- 校验弹窗的外部 store（打开/切换/关闭/退订）与各槽位注册，
  校验行按钮 CSS 与壳层 `.iconButton` 的度量一致（16×16、无底色、hover 只变色），
  校验**默认工作区闸门**（宿主快照标 disabled 后行按钮消失、开关打开后回来、探测失败会重试），
  校验**目录选择器**（标签猜测始终满足宿主语法、取消不改变任何字段、失败被捕获并给出原因、
  没有挂载 ui-workspace 时按钮自动置灰且不会调用），
  并用最小 React + Button/Switch/Modal 桩**真实渲染**设置页（含拨动开关 → POST 一次 settings op →
  共享快照更新）与弹窗/面板的各状态文案。

## 故障排查

### 工作区行上没有出现目录按钮

1. 先确认宿主半已加载（见下一条的判据）。
2. **这个工作区是默认工作区，且 设置 → `workspace+` 的开关还关着** —— 这是默认行为。
3. 悬停工作区行才会显示操作区，这是壳层的行为。
4. 兜底入口会在 1.2s 后出现在侧边栏（`workdirs`）；如果它出现了，说明行锚点没匹配上 ——
   多半是 DSH 升级改了行 DOM。此时功能仍然可用（走 `workspace_dirs` 工具或兜底入口），
   需要的话按新的 `data-row-key` 更新 `WORKSPACE_ROW_SELECTOR`。

### 弹窗显示 `host responded 404`

**含义**：请求已经到达 DSH 宿主进程，但宿主里没有 `/workspaceplus/api` 这条路由 —— 宿主半还在跑旧代码。

浏览器半会随 `client.js` 的内容变化热更新，**宿主半不会**（`dsh-hmr` 的 `root` 为空，不监听这个插件目录）。
所以只刷新页面会出现「新界面 + 旧宿主」的组合。**重启 `dsh` 即可。**

重启成功的判据是启动终端里的这一行：

```
[dsh-workspaceplus] host half loaded — workspace label routing is active (<state file path>)
```

没有这行说明该插件行加载失败，去 **设置 → 插件** 看它的状态。另一个快速判据：
让 agent 调一次 `workspace_dirs`，或看工具列表里有没有这个工具。

### 桌面版和 Web UI 在这件事上一样吗

一样。官方桌面壳用自定义协议 `dsh-app://app/` 承载页面，它的分发逻辑是
（`resources/app.asar` 的 `lib/main.js`，`protocol.handle(SCHEME, …)`）：

```js
if (url.hostname === 'app') {
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/assets/')
      || ['/favicon.svg', '/manifest.webmanifest'].includes(url.pathname)) return serveWebDocument(...)
  return forwardWebRequest(request, hostUrl, hostCookie)   // 其余全部带 cookie 转发给 Host HTTP 服务
}
```

也就是说**除了**首页、静态资源这几个路径由本地 dist 提供，其余请求一律原样转发给真正的 Host，
并附上桌面壳持有的宿主 cookie。所以插件注册的 `ctx.webServer` 路由（以及 `/api`、`/plugins/*`）
在桌面版里和浏览器里走的是同一条路，401/404 的语义也一致。

### 其他

- **弹窗 401**：当前文档没有完成 token 交换，拿 `dsh` 启动时打印的带 token 地址重开 GUI。
- **下拉框显示「没有可用工作区」**：宿主没有挂载 `workspaceRegistry`，或确实还没有工作区。
- **`workspace_dirs` 不在工具列表里**：宿主半没加载，同上。

## 继续扩展

- **让 shell 也能用标签**：可以在宿主半加一个 `ctx.shellEnv.register(...)` 贡献，
  把 `DSH_WORKSPACE_DIR_<LABEL>` 传给每次命令执行。
- **把按钮插进「...」菜单**：只有等官方给工作区行开放槽位才值得做；现在唯一可行的做法是
  连带替换掉官方的 Rename/Delete（用 `ctx.workspaces.rename/delete` 复刻），风险明显更高。
- **换成 TypeScript + tsdown**：`lib/` 就是产物目录，源文件放 `src/`、让 tsdown 输出
  `lib/index.js` 与 `lib/client.js` 即可，`exports` 不用改。参见
  [插件开发文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) 与
  [打包与安装](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)。
- **成本提示**：`workspace_dirs` 的工具 schema 会出现在每个会话的每次请求里（约二百 token）。
  不需要自然语言管理时，可以在 profile 里禁用整行，只用界面管理。
