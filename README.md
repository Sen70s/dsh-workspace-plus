# dsh-workspace-plus
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/sen70s/dsh-workspace-plus)

DeepSeek Harness Web GUI 的插件。**一个插件，两个子功能** —— 插件页里每个子功能一行，可单独启停：

| 子功能（插件页里的行） | 说明 |
| --- | --- |
| **workspaceplus** | 工作区多目录标签。三个入口：工作区行上的目录按钮（弹窗）、对话输入框里的 `@`、设置 → `workspace+`（每个工作区一个开关） |
| **notice** | Windows 原生桌面通知（自 dsh-notice 合并）。对话请求权限、询问用户、任务完成、任务中断、任务出错时弹 toast，点击通知直接打开对应的对话 |

它解决的问题：一个工作区（DSH 里 = 一个目录）装不下真实项目。前后端分在两个仓库、文档在第三个目录时,
每次都要在对话里手写绝对路径，而且目录名相似时 agent 容易改错文件。本插件让工作区带上
「标签 → 绝对路径」映射，并**在每个请求里把这张表注入 agent 上下文**，于是：

> 用户：`把 backend 的登录接口改成 JWT`
>
> agent 直接去 `D:\proj\backend`，不会因为旁边有个 `D:\proj\backend-legacy` 而改错。

名字相似的目录摆在一处，本就是容易出事的地方。让机器记住哪个是哪个，比每次都由人在对话里
把路径抄一遍要可靠些 —— 抄写这桩事，人向来是做不过机器的；而记错门牌这桩事，机器又向来是做不过人的。
插件能做的，只是把它擅长的那一半接过来。

通知这半个则是另一桩小事：agent 在后台跑着，窗口被别的应用盖住，一轮结束了你却不知道。
桌面通知把「对话在等你」这件事递到系统通知中心，点一下就回到那个对话。

> 想先看看它长什么样、怎么用：[**使用**](#使用) 一节里配了截图。

> 本仓库只包含插件本身；没有改动 DSH 安装目录里的任何文件。workspace+ 的 state 文件写在 `~/.dsh/workspaceplus/`，
> 通知的设置写在 `~/.dsh/notice/`（沿用 dsh-notice 的位置，升级就地保留）。

## 目录结构

```
dsh-workspace-plus/
├── package.json        # dsh.bundle（patch 层）+ dsh.client（浏览器半声明）+ ./notice 导出
├── cordis.patch.yml    # bundle 层：insert 两行 —— workspaceplus（workspace+）与 notice（通知）
├── lib/
│   ├── index.js        # workspace+ 宿主半：store + 设置 + 上下文注入 + workspace_dirs 工具 + HTTP 路由
│   ├── client.js       # 共享浏览器半：workspace+ 三入口 + 通知设置页 + 点击通知的打开轮询（无需构建）
│   └── notice/         # 通知子功能宿主半（自 dsh-notice 0.2.1 原样移植，改名不改行为）
│       ├── index.js    #   事件监听 + Windows toast 传输 + 三条 HTTP 路由 + 协议注册
│       ├── toast.js    #   常驻 PowerShell toast 守护进程（stdin JSON 协议）
│       ├── toast-host.ps1 / click.ps1  # WinRT toast 脚本 / 协议点击转发器
│       ├── format.js / settings.js / win32.js  # 纯函数层：文案 / 设置 / Windows 集成
│       ├── package.json + locale/      # 子功能在插件页显示的标题、描述与图标
│       └── icon.svg
├── icon.svg            # 插件管理页显示的图标
├── LICENSE             # MIT
├── docs/               # README 里那几张截图
├── tools/verify.mjs    # 离线自检（479 项断言，不需要 DSH 在跑）
├── tools/preview/      # 截图是怎么来的：真实 React + 真实壳层样式 + 无头 Edge（见其 README）
└── README.md
```

`lib/` 下所有文件都是**手写源码，不需要任何构建步骤**。`lib/client.js` 按 DSH 客户端模块加载器要求的
`window.__ModuleLoader__.load({ id, factory })` 工厂式 CJS 形态书写。

## 两个子功能，两行，各自开关

`cordis.patch.yml` 插入两行 loader row。DSH 的插件页把这两行渲染在本包卡片之下，各带一个开关 ——
和 dsh-ops 在一个包里发布 `dsh-ops/shell`、`dsh-ops/file` 的形状相同：

- 关掉 **notice** 行：宿主半卸下（不再监听事件、不再弹通知），浏览器半的设置页会说明「通知子功能当前未启用」，
  点击旧通知的打开轮询仍在（宿主应 404，轮询静默退避）。
- 关掉 **workspaceplus** 行：workspace+ 整体卸下，通知行不受影响。
- 两个开关之外，**设置 → 通知** 里还有一个运行时开关「启用桌面通知」—— 不动插件页也能静音，
  两层开关互不干扰。

设置 → 通知 的页面内容（通知类型、声音、时长、协议注册、测试通知）与 dsh-notice 完全一致，
路由路径 `/dsh-notice/api*`、协议 scheme `dsh-notice:`、存储位置 `~/.dsh/notice/` 都原样保留，
因此从独立 dsh-notice 插件升级过来时，已有设置与协议注册自动生效。

## 设置：设置 → `workspace+`

**每个工作区一个开关**：这个工作区里启用还是停用 workspace+。它管两处 ——
注入该工作区对话的标签表、以及 `workspace_dirs` 工具。
关掉**不会删除**已登记的标签，只是让这个工作区暂时不参与。

**它不管入口。**工作区行上的目录按钮在每个工作区都有：弹窗是唯一能看到这些标签的地方，
而开关在设置页，把按钮藏起来只会让两边都够不着。停用的工作区，按钮画得淡一些、
悬停提示写明「已在 workspace+ 里停用」，点开照常，弹窗里也会直接说明这个状态。

默认值不是一刀切：

- 除默认工作区外，**每个工作区默认开启**。
- 「默认工作区」是 DSH 首次启动时自动创建的那个（`workspaceRegistry` 里 `defaultWorkspaceId`
  指向它，即使它的注册被删掉这个身份也会保留）。它属于产品而不属于本插件，所以**默认关闭**：
  不注入上下文、`workspace_dirs` 对它直接返回一个指向上面的开关的错误。
  在设置页打开它自己那一行的开关即可，无需重启、无需刷新。
- 拨动开关写的是**这个工作区的显式值**，所以它一定覆盖默认值；设置页不会因为「默认值恰好相同」而装作没生效。

宿主怎么认出默认工作区：它只调用**公开的** `workspaceRegistry.initializeDefault()`，
并传一个「拒绝创建」的目录解析器 —— 已有默认工作区时该调用直接返回它（无副作用），
注册表非空时返回 `undefined`，只有在**真的会创建**工作区的那条路径上才会走到解析器、抛错、被捕获。
所以这个探测永远不会替你凭空创建一个工作区。

> 首次探测可能早于注册表服务初始化完成而失败。失败时状态保持「未决」并在下一次请求/工具调用时重试，
> 而不是把「没有默认工作区」永久缓存下来 —— 否则默认工作区会被静默启用。

### 设置是怎么存的

```json
{
  "settings": {
    "defaultWorkspaceEnabled": false,
    "workspaceEnabled": { "d:\\projects\\api": false }
  }
}
```

- `workspaceEnabled` 是**按工作区**那一层：键是工作区目录（和 `workspaces` 一样大小写折叠），
  值 `true` / `false` 是显式覆盖。
- 键由宿主下发（`/workspaceplus/api` 快照里每个工作区的 `key`），浏览器半**不会**自己从路径猜 ——
  Windows 下大小写折叠规则一旦不一致，猜出来的键会「存得进去但永远匹配不上」，是个静默失效。
  旧宿主没有这个字段时，设置页把开关置灰并提示重启 dsh。
- `defaultWorkspaceEnabled` 是「默认工作区那一行的默认值」。字段保留是为了兼容旧状态文件，
  正常使用中不需要手改；在设置页拨默认工作区那一行写入的是 `workspaceEnabled` 里的显式覆盖。
- 旧状态文件（没有 `settings`，或没有 `workspaceEnabled`）照常工作：缺失的那层归一化成「没有覆盖」。

## 功能是怎么工作的

### 数据

一份插件自己的状态文件，键是工作区目录（大小写无关）：

```json
{
  "version": 1,
  "settings": { "defaultWorkspaceEnabled": false, "workspaceEnabled": {} },
  "workspaces": {
    "d:\\proj": {
      "path": "D:\\proj",
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

（第三个入口 —— 对话输入框里的 `@` —— 见下面单独一节。）

弹窗本身注册在 **`shell.overlay`** —— 和壳层自己的「重命名工作区 / 删除工作区」对话框同一个层
（那两个是 `workspace.session-rename`、`workspace.session-archive`），所以观感和层级天然一致。

**主触发器：工作区行上的目录按钮。** 这里要说清楚一件事：

> 工作区那一行的「...」菜单在官方实现里是**硬编码的 Rename/Delete**，没有插件槽位。
> `dsh-client-ui-workspace` 的源码注释原文是
> 「Workspace row menus are visual-only except Rename/Delete」，
> 代码里 `ProjectRowItem` 也只收到 `actions: { rename, delete }`。

所以「往那个菜单里加一项」无法用官方 API 做到。替代方案是把按钮**插进该行的操作区**
（`rowActions`），定位不依赖易变的哈希类名，而用壳层自己发出的稳定锚点：

- `data-slot="sidebar.workspaces"` —— 渲染器给每个 slot 出口都加的锚（`SlotOutlet`）
- `data-row-key="workspace:<workspaceId>"` —— 工作区分组行自带，且
  `buildGroup(workspace.workspaceId, workspace.workspaceId, …)` 保证这个 key **就是** workspace id，
  与宿主 `workspaceRegistry` 的 `Workspace.id`（客户端 `workspaceView().workspaceId`）一致

**位置：夹在中间。** 壳层渲染的操作区是 `[「更多」菜单, 「新会话」按钮]`，本插件的按钮插在
**最后一个子节点之前**，于是那一行读作「更多 · 工作区目录设置 · 新会话」，新会话保持最后一个。
（`insertBefore(node, null)` 等价于 append，所以操作区只有一个子节点时会退化成「排在菜单之后」，
而不是硬造一对不存在的顺序。）

React 重渲染时并不知道这个节点的存在，可能把自己的子节点重新插到它两边，所以**位置是每次对账都重新
确认的**，不是创建时设一次。对账由 `MutationObserver` 驱动，覆盖增、删、移位三种情况，
重复对账是幂等的。点击时 `preventDefault + stopPropagation`，所以不会触发行本身的展开/折叠。

**但「重新确认」不能变成「每次都真的搬一次」。**`insertBefore` 即使把节点插到它本来就在的位置，
浏览器也会先摘下来再插回去；而真实的按下→抬起如果跨过这样一次摘插，**浏览器就不会发出 `click`** ——
释放时按下目标已经不在文档里了。对账是随每一帧 DOM 变动跑的，于是这种「无意义的重排」几乎落在每一次
按下中间：按钮看得见、也点得中（`elementFromPoint` 就是它），**但点击永远到不了处理器，行也不会折叠**。
0.4.1 的修法是在 `seatRowButton()` 里先判断座位是否已经正确，正确就一个字节都不动；同时把
`pointerup`（左键）也接成同一个触发器 —— 释放事件总归会到，而 store 对「同一个工作区重复打开」是幂等的，
所以两条路径同时命中只会开一次窗。

**每个真实工作区行都有这个按钮**，包括设置页里被关掉的那些：关掉的只是「标签表注入 + 工具」，
按钮照常打开弹窗（画得淡一些，提示写「已在 workspace+ 里停用」）。这一条也是 0.4.1 修的：
早先版本把开关也接到按钮是否出现上，于是关掉某个工作区后，那一行就再没有任何入口 ——
而弹窗是唯一能读这些标签的地方，开关本身又在设置页，等于两头都够不着。

外观上刻意对齐壳层自己的行内按钮（`Rows.module.css` 的 `.iconButton`）：16×16、无边框、无底色、
`color: label-tertiary`，**hover 只变颜色不加背景**；图标直接复用官方的文件夹图形
（`IconFolderOpenArtwork` 的路径数据，静态内联，不引入运行时依赖），所以和旁边的「...」「＋」是同一套视觉。

**兜底触发器：侧边栏 `workdirs` 条目。** 只有当工作区行按钮**装不上**时才注册（比如将来壳层改了行 DOM，
或这个工作区列表还是空的）。注册它会连带一个 `main` key：壳层的侧边栏面板按钮**无条件**调用
`layout.selectPanel(id)`，对一个没有注册 `main` key 的 id 会直接抛错，所以那个 key 必须存在，
由一个提示面板占着，同时图标的点击被 `stopPropagation` 截住、改为打开弹窗。健康环境下
侧边栏不会多出任何图标（有一个 1.2s 的 settle 窗口避免闪烁）。

弹窗**锁定触发它的那个工作区**：从哪个工作区行点的，就只编辑那个工作区。卡片宽度是
`min(640px, 100%)`（壳层默认的 380px 装不下一行「标签 + 绝对路径 + 说明 + 行尾图标」）。
从上到下是四样东西：

1. **工作区那一行** —— 文件夹图标、工作区名、根目录（等宽字体，靠右）。锁定的是它，所以没有下拉框；
   只有兜底入口（见本节末）才会在这一行里退回成一个选择器。
2. **「目录」这个分区标题**。标题下面是一张列表，一行一个标签：图标、标签、绝对路径、
   可选说明，行尾若在工作区根目录之外就立一个小小的黄盾牌（说明放在 hover / 键盘聚焦才出现的
   tooltip 里，见下面的沙箱一节），再行尾是一个 ×。
3. **列表下面那一行「添加目录」**。
4. **底部**：左「刷新」，右「完成」。

**「删除」为什么变成了一个 ×**：一行一个「删除」，看过去先看见的是一列按钮，而不是一列目录。
叉号仍然带 `aria-label` / `title`（「移除 backend」），所以读屏与悬浮都还说得清它删的是哪一个。

**路径没有手动输入框**：「添加目录」那一行本身就是按钮，**点它直接打开系统的目录选择器**，
也就是壳层自己的 `ctx.uiWorkspace.pickDirectory()`（就是「选择工作区」用的那一个），
所以桌面版是原生对话框、浏览器版是壳层的浏览面板。选中之后路径落进这一行，同一个组里多出一行：
**标签**（为空时按目录名猜一个合法的，`D:\proj\my api` → `my-api`；纯中文目录名不猜，
避免塞一个宿主会拒绝的标签）与**说明**，末尾是「添加」。
**没选目录之前这一行根本不出现** —— 两只空着的输入框不算提示，算噪音。
取消选择不会改动任何字段；`ui-workspace` 没有挂载时（合成里没有这一行）「添加目录」自动置灰，
并用 `title` 说明改用 `workspace_dirs`，插件其余部分照常工作。

如果 HTTP 通道不可用，弹窗用一块告警说明原因（区分 401 / 404 / 传输不可达），而不是假装映射是空的 ——
此时仍然可以在对话里用 `workspace_dirs` 管理。工作区在设置页被关掉时，弹窗里也有一行写着这件事。

> 唯一的例外是兜底入口：它是全局的、没有工作区上下文，所以那条路径下弹窗会退回显示选择器。
> 正常使用中不会看到它。

## 对话输入框里的 `@`

在会话里打 `@` 会多出一组「工作区目录」候选 —— 就是已登记的标签，可以按标签、说明或路径过滤。
选中后插入一个引用 chip：**chip 显示标签，提交给模型的是那个目录的绝对路径**。

这样一来，即使注入的标签表因为上下文压缩而不在了，模型拿到的仍然是路径本身，指代不会失焦：

> `@backend 加个健康检查` → 模型收到 `D:\proj\backend 加个健康检查`

候选来自**所有已启用的工作区**，按工作区标题分节；**当前会话所在工作区排在最前**（能读到它的 cwd 时）。
会话查找只是排序优化，不是前置条件 —— 早先按「只会话工作区」出候选的写法有个致命缺点：只要 cwd 读不到，
整组就静默变空，而空菜单和坏 bundle 从外面看一模一样，无法证伪。

实现要点（都在 [lib/client.js](lib/client.js) 里，用壳层的 input trigger 管线）：

| 事项 | 做法 |
| --- | --- |
| 注册 | `ctx.inject(['inputTriggers'], …)` → `registerSource({ trigger: '@', name: 'workspace-plus', … })`；`(trigger, name)` 必须唯一，`@reference` 是官方占用的 |
| 组的位置 | source 上写 `order: -10`。菜单按 `order` 升序排组（缺省 0，同值按注册序），而壳层自己的 `@` 组是 `reference` 0、`subagent` 0、`cordis` 1 —— **不写这个字段就等于排在它们后面**：本插件最后物化，同值时永远垫底。负数是插件唯一能排到产品组前面的写法 |
| 候选 | 所有 `enabled !== false` 且登记了目录的工作区；被设置页关掉的工作区自然被排除 |
| 排序 | 从管道给的 `{ sessionId }` 反查 cwd（`sessions.list` 投影，与 `ui-reference`/`ui-session` 同一处），命中的工作区提到最前；读不到就按原序 |
| **必须是 async** | 管线是 `source.candidates(...).then(...)` 直接调用 —— 同步返回数组会在它自己的循环里抛错 |
| 分组标题 | `showGroupTitle: false` + 每行自带 `section`（工作区标题），否则标题会是管道字典里查不到的 key |
| chip | `appearance: 'folder'` → 文件夹图标、且不会被标成可点开；点击时因为本 source 没有 `openReference` 而是安全的空操作 |
| 序列化 | 本 source 自带 `codec.serialize(ref) => ref`；**chip 的 serializer 是按 source 名路由的，没有 codec 的 source 会让整次提交被拒** |
| 自检 | 设置 → `workspace+` 里有一行「输入框 `@` 候选」，直接告诉你候选源是否已注册、共有多少标签 |

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
和界面（行尾一个黄色盾牌图标，悬浮或键盘聚焦时用 tooltip 说明原因）。

## 安装

从 npm 安装（推荐）：

```sh
dsh plugin --profile desktop add dsh-workspace-plus
```

也可以直接从 GitHub 或本地 checkout 安装：

```sh
dsh plugin --profile desktop add github:Sen70s/dsh-workspace-plus
dsh plugin --profile desktop add <本地 checkout 目录>
```

`lib/` 是仓库里已提交的产物、包内没有 `prepare` 构建脚本，所以上面三种方式都不需要
pnpm 的 `allowBuilds` 构建授权，装到的就是可直接加载的代码。想锁定版本可以用
`github:Sen70s/dsh-workspace-plus#v0.4.1`（仓库工作区里是尚未打 tag 的 0.6.0）。
要求 DSH `>=0.1.7-rc.2`：0.4.1 那次行按钮修复是在 `0.2.1-rc.2` 桌面版上实测的；
0.5.0 的弹窗重排是对着当前桌面版真实壳层的样式逐个核对过的（截图工具、资产出处与做法见
`tools/preview/README.md`）；0.1.7-rc.2 一代理只核对过源码锚点
（`data-slot` 与 `data-row-key` 两代都在），没有实机验证。
npm 上是 `next` 通道。

> 0.1.0 曾以包名 `dsh-workspaceplus` 发布；自 0.1.1 起更名为 `dsh-workspace-plus`，旧包已废弃，
> 请勿再安装。

> 自 0.6.0 起，本包包含两个子功能：workspace+ 与通知（notice，自 dsh-notice 合并）。
> 若你此前装过独立的 dsh-notice 插件，请从 profile 里移除它再装本包 —— 两者的通知路由、
> 协议与设置存储完全相同，同装会同名冲突。

装完后**重启 `dsh`** 并刷新页面。悬停任一工作区那一行，操作区会多出一个目录图标，点它打开弹窗；
设置面板里会多出一个 `workspace+` 分区（默认工作区那一行默认关着，其它工作区默认开着，见下一节），
以及一个「通知」分区；对话输入框里打 `@` 会多出一组「工作区目录」候选。两个子功能在侧栏
「插件」页的本包卡片下各占一行，可单独启停。

卸载：

```sh
dsh plugin --profile desktop remove dsh-workspace-plus
```

## 使用

我向来不惮于把话说明白，只是插件的用法，说一遍也就够了，不必绕弯子。

### 一、先把目录登记上

把鼠标停在左侧边栏的任意一个工作区上，那一行的右边会浮出三个小东西。头一个是「更多」，末尾一个是「新会话」，中间那个文件夹，是本插件的。

![工作区行上的目录按钮](https://raw.githubusercontent.com/Sen70s/dsh-workspace-plus/main/docs/row-button.png)

它排在中间，不是末尾 —— 末尾那个位置是壳层的，我不去占。人有各人的座位，插件也一样。

点它，「工作区目录设置」就开出来了：

![工作区目录设置弹窗](https://raw.githubusercontent.com/Sen70s/dsh-workspace-plus/main/docs/dialog-default.png)

上头那一行是弹窗锁定的工作区：名字，与根目录。再往下是一个「目录」的小标题，一张列表，一行一个已登记的目录：标签、绝对路径、说明，如此而已；行尾一个叉号，点它就把这一行移掉。若某个目录在工作区根目录之外，行尾会立一个小小的黄盾牌 —— 这个下面再讲。

**路径是不用手打的。** 列表底下那一行「添加目录」，它本身就是个按钮。点它，系统的目录选择器就开了：

![选好目录之后，路径与标签都填上了](https://raw.githubusercontent.com/Sen70s/dsh-workspace-plus/main/docs/dialog-picked.png)

选中之后，路径落进那一行里；同一个组里多出一行，左边是标签 —— 若还空着，便从目录名里猜一个（`D:\proj\my api` → `my-api`；纯中文的目录名不猜，因为宿主不收，猜了也是白猜）—— 右边是说明，末尾是「添加」。**没选目录之前这一行不出现**，所以这几样东西从来没有挤作一处过；从前它们挤着，那是我的不是。

### 二、那个黄盾牌

目录若在工作区根目录之外，它就立在那里，不写字。非得你把鼠标放上去，或者用键盘 Tab 把它聚焦了，它才开口：

![盾牌图标的浮层提示](https://raw.githubusercontent.com/Sen70s/dsh-workspace-plus/main/docs/dialog-tooltip.png)

说的是：DSH 的沙箱只认工作区根目录这一个可写根；会话权限不是 `danger-full-access` 的时候，根目录之外只能读，要写就得逐次批准。这不是插件不肯通融，是它本来就只有这一条路。

所以要图省事，**把工作区建在几个工程的共同父目录上**，让所有标签都落在里头。这是最省事的办法，也是唯一的办法。

### 三、开关，一个工作区一个

设置 → `workspace+`：

![设置页里按工作区的开关](https://raw.githubusercontent.com/Sen70s/dsh-workspace-plus/main/docs/settings.png)

一个工作区一行，一行一个开关。这个开关管两件事：标签表注不注入这个工作区的对话、`workspace_dirs` 认不认这个工作区。

**它不管目录按钮。**每个工作区那一行都有目录按钮 —— 关掉的工作区只是画得淡一些，点开照常，弹窗里会写明它现在是停用的。理由很直白：弹窗是唯一能读到这些标签的地方，开关在设置页，把按钮一起藏掉，两头就都够不着了。

默认值并不整齐：**除默认工作区外，都默认是开的**；而默认工作区 —— 也就是 DSH 第一次启动时自己建起来的那一个 —— 默认关着。它属于产品，不属于这个插件，我不便替你做主。要用，把它那一行的开关拨开就是。

关掉**不会删掉标签**。哪天想起来了再拨回来，目录还在那里。

### 四、在对话里

前提是工作区 `D:\proj` 底下挂了 `backend` 和 `docs` 两个标签。于是：

- 打一个 `@`，菜单里多出一组「工作区目录」。选 `backend`，输入框里就落下一个 `backend` 的 chip —— 而**送给模型的是那个绝对路径**。这一点要紧：哪怕注入的标签表被上下文压缩挤掉了，模型手里那个路径也还是硬的。
- 「把 `D:\proj\backend` 记成 backend，说明写后端 API」→ agent 调 `workspace_dirs add`
- 「现在有哪些标签？」→ `workspace_dirs list`
- 「backend 改指向 `D:\proj\backend-v2`」→ `workspace_dirs update`
- 「删掉 docs」→ `workspace_dirs remove`
- 诸事办完，才可以说那句：「backend 加个健康检查接口」。agent 去的是 `D:\proj\backend`，不会因为隔壁站着一个 `backend-legacy` 就摸错了门。

标签表是每次请求都注入的，所以上面这些，多数时候你不说，它也晓得。

## 自检

不需要安装、不需要 DSH 在跑：

```sh
node tools/verify.mjs
```

它会（当前 `453/453 checks passed`）：

- 校验 manifest、patch 层、`dsh.client.inject` 的取值；
- 用临时 `DSH_HOME` 运行宿主半：标签/路径校验、增删改、去重、大小写折叠、损坏文件容错、原子写；
- 用假的 Cordis ctx 验证各处注册，并**真实执行** `workspace_dirs` 的 list/add/remove；
- 用假的 `node:http` req/res 真实调用 HTTP 路由的 GET/POST/405/401 分支；
- 在 `node:vm` 里加载浏览器半，用**最小 DOM 替身**（只实现本插件用到的那几个选择器）真实驱动
  工作区行按钮：挂载前不误报、按行注入、未分组行跳过、重复对账幂等、行移除后回收、
  点击只开弹窗而不冒泡到行、dispose 清理干净；
- 校验弹窗的外部 store（打开/切换/关闭/退订）与各槽位注册，
  校验行按钮 CSS 与壳层 `.iconButton` 的度量一致（16×16、无底色、hover 只变色），
  校验样式表在**模块热重载**后仍是一个、且是当前版本的 tag（不会新旧并存），
  校验**按钮的位置**（落在「更多」和「新会话」之间、新会话保持最后一个、被 React 挤走后会自动归位、
  只有一个子节点时退化为排在菜单之后、dispose 后壳层自己的按钮原样不动、
  **已经坐正的座位一次都不再碰 DOM**（这条正是「点得中却没反应」的回归测试）、
  左键 `pointerup` 与 `click` 都只开一个窗而右键不触发），
  校验**工作区开关**（宿主快照标 disabled 后行按钮仍在该行、只是加上停用标记与说明文案、
   点击照常打开该工作区的弹窗、开关拨回来标记消失、探测失败会重试），
  校验**按工作区设置**（覆盖能关掉一个平时开着的工作区、也能打开默认工作区、覆盖优先于默认值、
  `null` 恢复默认、非法值整批拒绝且一个字节都不写、旧状态文件缺这一层照常工作、
  设置页一个工作区一个开关、按键由宿主下发而不是从路径猜、旧宿主没有 key 时置灰并提示），
- 校验**弹窗的形状**（卡片被拉宽到 640px、description 与脚注都不再渲染、
  「工作区根目录之外」不再是行内文字而是带 tooltip 的盾牌图标、
  锁定工作区那一行读作「图标 + 名字 + 根目录」而不是一个下拉框、分区标题写着「目录」、
  每行以一个 `aria-label="移除 <标签>"` 的叉号收尾而不是一个「删除」按钮、
  路径是「添加目录」那一行本身而不是输入框、没选目录时标签与说明的输入框一个都不渲染，
  选中之后才出现这两个且「添加」可用、出的错只用一块告警说一遍），
  校验**目录选择器**（标签猜测始终满足宿主语法、取消不改变任何字段、失败被捕获并给出原因、
  没有挂载 ui-workspace 时字段自动置灰且不会调用），
- 校验 **`@` source**（触发器的唯一性、`candidates` 返回 thenable、按标签/说明/路径过滤、
  默认工作区关闭时不出候选、pick 产出的 chip 与它序列化出的绝对路径一致、坏 payload 不插入、
  source 的 `order` 是有限数且严格为负 —— 即排在壳层自己的 `@` 组前面而不是与之并列），
  并用最小 React + Button/Switch/Modal/Tooltip 桩**真实渲染**设置页（每个工作区一个开关 →
  POST 一次按键的 settings op → 共享快照更新）与弹窗/面板的各状态文案。

## 故障排查

### 输入框打 `@` 有「文件与文件夹」，但没有「工作区目录」

**先看 设置 → `workspace+` 里的「输入框 `@` 候选」那一行**，它把三种情况分开了：

| 那一行显示 | 含义与处理 |
| --- | --- |
| `候选源未注册` | 当前页面跑的还是旧 bundle。**重启 `dsh` 并强制刷新页面**（Ctrl+Shift+R） |
| `候选源已注册，但还没有可用的标签` | 代码是新的，只是没有可登记目录 —— 去工作区行里加标签；或者这个工作区是默认工作区而开关关着 |
| `候选源已注册，共 N 个标签` | 代码和数据都就位。这一组现在排在 `@` 菜单的最上面（source 的 `order` 是负数）；若仍看不到，多半是菜单被上方的可用空间截短了，滚动菜单看看 |

**为什么必须重启而不能只刷新**：客户端 bundle 的 URL 带一个由 `mtime/ctime/size` 派生的 `rev`，
而 rev 只在宿主重新组合模块图时才更新（`dsh-client-modules` 的 `rebuilt()`）。文件内容是在**首次 GET**
时读取并缓存的，所以 rev 不变，刷新只会拿回缓存里的旧 bundle。宿主侧的重载驱动是 `dsh-hmr`，
你 profile 里它的 `root` 是空的 —— 也就是不监听这个插件目录。

### 工作区行上没有出现目录按钮

1. 先确认宿主半已加载（见下一条的判据）。
2. 悬停工作区行才会显示操作区，这是壳层的行为。
3. 按钮**淡一些**说明这个工作区在 设置 → `workspace+` 里被关着（默认工作区默认就是关的）——
   点它照样能打开弹窗，弹窗里会写明这个状态；要恢复注入，去设置页把它那一行的开关拨开。
4. 兜底入口会在 1.2s 后出现在侧边栏（`workdirs`）；如果它出现了，说明行锚点没匹配上 ——
   多半是 DSH 升级改了行 DOM。此时功能仍然可用（走 `workspace_dirs` 工具或兜底入口），
   需要的话按新的 `data-row-key` 更新 `WORKSPACE_ROW_SELECTOR`。

### 图标看得见、也点得中，但点了完全没反应

那是 0.4.1 修掉的那个 bug：行按钮的座位在每次对账时被重新 `insertBefore` 了一次，
浏览器把「按下→抬起」之间的这次摘插当成目标失效，于是**根本不发出 `click`**（行也因此不折叠）。
升级插件到 0.4.1 即可；临时判断方法和需要的证据见上面「界面」一节。

### 弹窗显示 `host responded 404`

**含义**：请求已经到达 DSH 宿主进程，但宿主里没有 `/workspaceplus/api` 这条路由 —— 宿主半还在跑旧代码。

浏览器半会随 `client.js` 的内容变化热更新，**宿主半不会**（`dsh-hmr` 的 `root` 为空，不监听这个插件目录）。
所以只刷新页面会出现「新界面 + 旧宿主」的组合。**重启 `dsh` 即可。**

重启成功的判据是启动终端里的这一行：

```
[dsh-workspace-plus] host half loaded — workspace label routing is active (<state file path>)
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
