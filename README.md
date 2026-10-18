# dsh-workspace-plus

[![npm version](https://img.shields.io/npm/v/dsh-workspace-plus.svg)](https://www.npmjs.com/package/dsh-workspace-plus)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/sen70s/dsh-workspace-plus)
[![license](https://img.shields.io/npm/l/dsh-workspace-plus.svg)](https://github.com/Sen70s/dsh-workspace-plus/blob/main/LICENSE)

**当前版本 `v0.6.0`** · 要求 DSH `>=0.1.7-rc.2`

DeepSeek Harness（DSH）的插件。一个插件，两个子功能，插件页里各占一行、可单独启停。

| 子功能 | 说明 |
| --- | --- |
| **workspace+** | 一个工作区登记多个目录，每个目录一个标签。标签表注入每次请求，输入框打 `@` 也能直接引用 |
| **通知 / notice** | 对话请求权限、询问用户、任务完成、中断、出错时弹 Windows 原生通知，点通知直接回到那个对话 |

## 安装

```sh
dsh plugin --profile desktop add dsh-workspace-plus
```

装完**重启 `dsh`** 并刷新页面。

卸载：`dsh plugin --profile desktop remove dsh-workspace-plus`

> 自 0.6.0 起通知（notice）已并入本包。若你此前装过独立的 `dsh-notice` 插件，先从 profile 里移除它再装本包 —— 两者的路由、协议与设置存储完全相同，同装会同名冲突。

## workspace+：一个工作区，多个目录

一个工作区（DSH 里 = 一个目录）装不下真实项目。前后端分两个仓库、文档在第三个目录时，把这三个目录登记成标签，agent 就不再需要你每次手写绝对路径。

**1. 打开弹窗。** 鼠标停在侧边栏任意工作区那一行，操作区会多出一个文件夹图标，点它。

![工作区行上的目录按钮](https://raw.githubusercontent.com/Sen70s/dsh-workspace-plus/main/docs/row-button.png)

**2. 添加目录。** 点「添加目录」，用系统的目录选择器选一个目录；标签为空时会按目录名猜一个（`D:\proj\my api` → `my-api`），也可以自己写，再加一句说明。

![选好目录之后，路径与标签都填上了](https://raw.githubusercontent.com/Sen70s/dsh-workspace-plus/main/docs/dialog-picked.png)

**3. 之后就不管了。** 每次请求 agent 都能看到这张「标签 → 绝对路径」表：

```text
用户：把 backend 的登录接口改成 JWT
agent 直接去 D:\proj\backend，不会因为旁边有个 backend-legacy 而改错门。
```

在输入框打 `@` 会多出一组「工作区目录」候选，选中后落一个 chip —— **送给模型的是那个目录的绝对路径**，所以哪怕标签表被上下文压缩挤掉了，指代也不会失焦。

**4. 每个工作区一个开关。** 设置 → `workspace+`，一行一个开关（默认工作区默认关闭，其它默认开启）。关掉不删标签，只是这个工作区暂时不参与。

![设置页里按工作区的开关](https://raw.githubusercontent.com/Sen70s/dsh-workspace-plus/main/docs/settings.png)

也可以直接在对话里让 agent 管：「把 `D:\proj\backend` 记成 backend，说明写后端 API」「现在有哪些标签？」「backend 改指向 `D:\proj\backend-v2`」「删掉 docs」。

> **建议把工作区建在几个项目的共同父目录上**，标签都放进去。DSH 的沙箱只认工作区根目录为可写根，根目录之外的目录只能读，agent 每次越界写入都要你批准一次。

## 通知：后台跑着，不用盯着窗口

装好即用。请求权限、询问用户、任务完成、中断、出错都会弹 toast，点一下就打开对应的对话。

设置 → 通知 里可以选通知类型、声音、时长、注册协议、发一条测试通知。这里还有一个「启用桌面通知」开关，不动插件页也能静音。

设置存在 `~/.dsh/notice/`，协议 scheme 是 `dsh-notice:` —— 从独立 dsh-notice 插件升级过来时，已有设置与协议注册自动生效。

## 自检

不需要安装、不需要 DSH 在跑：

```sh
node tools/verify.mjs
```

479 项断言，覆盖 manifest、patch 层、宿主半、浏览器半、工作区行按钮、`@` 候选源与弹窗形状。

## 其它

- `lib/` 是手写源码，**不需要任何构建步骤**。从 npm、GitHub、本地目录三种方式装到的都是可直接加载的代码。
- workspace+ 的状态文件在 `~/.dsh/workspaceplus/directories.json`，可以直接手改，改完刷新页面即可。
- [LICENSE](./LICENSE) · MIT

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Sen70s/dsh-workspace-plus&type=Date)](https://www.star-history.com/#Sen70s/dsh-workspace-plus&Date)
