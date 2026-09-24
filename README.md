# cmdc-gateway

把 **Command Code CLI (`cmdc`)** 的订阅后端反向代理成本地网关，对外暴露 **OpenAI** 与 **Anthropic** 两套兼容 API。任何支持 OpenAI SDK / Anthropic SDK 的工具都可以直接指向本网关，实际推理走你自己的 cmdc 账号。附带一个 **Web 控制面板**，可以在浏览器里完成登录（API Key 或浏览器授权）、查看模型、直接调试。

零第三方依赖，不需要 `npm install`，只需要 Node.js >= 22。

---

## 使用范围与免责声明

**这是本机自用的逆向兼容层，不是官方产品，也不绕过任何计费。** 开始前请务必看完这一段。

- **它逆向 cmdc CLI 的请求链路**（路由、请求体、响应格式、设备指纹），把 CLI 的协议翻译成 OpenAI / Anthropic 两套标准 API。所有推理仍然发往同一个后端（`api.commandcode.ai`），用的是**你自己的凭据、扣的是你自己的订阅额度**。它不会免费解锁任何能力。
- **仓库里没有任何凭据。** 账号 Key、access key、指标与日志都只在你本机的 `~/.cmdc-gateway/`（仓库外），从不入库。你需要自己提供 Key。
- **协议是逆向产物，随时可能失效。** 上游改一次接口，网关就可能翻译不出来；上游升级后，`models.json` 也需要按新版重抽（见下文限制）。**作者不提供任何可用性保证。**
- **请自行确认并遵守上游的服务条款。** 这类代理工具与上游 ToS 是否兼容由你自行判断；因使用本工具产生的任何后果由使用者自行承担。建议仅限**个人、本机**使用，不要公开分发他人的凭据，也不要把它做成对外服务。
- **不要把这个端口暴露到公网。** 默认监听 `0.0.0.0` 且局域网需要 access key，但网关花的是你的额度；不对外用时把 `host` 改回 `127.0.0.1`。
- **本项目以 [MIT 许可证](LICENSE) 开源**。可自由使用、修改、再分发甚至商用，只需保留版权声明；同样**不提供任何担保**。

---

## 环境要求

| 要求 | 说明 |
| --- | --- |
| **Node.js >= 22** | 唯一依赖。零第三方包，**不需要 `npm install`** |
| **已安装并登录的 cmdc CLI** | 只有「生成模型目录」这一步需要它：脚本从它打包的产物里抽取模型清单与套餐规则。已经在用 cmdc 的话就已经具备 |
| 网络 | 需能访问 `api.commandcode.ai` |
| 操作系统 | Windows / macOS / Linux 均可；一键启动的 `.bat` 仅 Windows |

---

## 快速开始

```bash
git clone https://github.com/suohx1415-beep/cmdc-gateway.git
cd cmdc-gateway

# 1) 生成模型目录（读本机已安装的 command-code；装到非默认位置就用 --from 指路径）
node scripts/extract-models.mjs

# 2) 启动网关
node src/server.mjs
# 或
npm start
```

启动后：

1. 打开面板 <http://127.0.0.1:8810/panel>，在「账号」页登录你的 cmdc 账号（贴 API Key，或用浏览器授权；两种都不碰 cmdc 命令行自己那份凭据）。
2. 把客户端指向 `http://127.0.0.1:8810/v1`（Anthropic SDK 用 `http://127.0.0.1:8810`）。
3. 首次运行会自动固定端口 `8810` 并**生成一把随机 access key**，写在 `~/.cmdc-gateway/config.json`；本机访问不需要它，局域网访问必须带上。

Windows 用户也可以直接双击 `start-gateway.bat` 用菜单启动（含端口冲突处理），详见下面的「启动方式详解」。

> `models.json` 是按 cmdc **1.53.1** 的产物抽取并随仓库提供的。如果你本机的 cmdc 已经升级，重跑抽取脚本时可能需要适配新版 bundle；不重跑也能用，但模型清单与套餐规则可能已经过时。

---

## 它是怎么来的（逆向结论）

cmdc CLI（`dist/cli.mjs`，v1.53.1）的真实请求链路：

| 项目 | 值 |
| --- | --- |
| 推理路由 | `POST {baseUrl}/alpha/generate` |
| baseUrl | `https://api.commandcode.ai`（staging / local 见下） |
| 鉴权 | `Authorization: Bearer <apiKey>`，apiKey 来自 `~/.commandcode/auth.json` 的 `apiKey` 字段，或环境变量 `COMMAND_CODE_API_KEY` |
| 其他请求头 | `User-Agent: cli`、`x-command-code-version`、`x-cli-environment`、`x-project-slug`、`x-taste-learning`、`x-session-id` |
| 响应格式 | **NDJSON**（每行一个 JSON，注意不是 `data:` 前缀的 SSE） |

请求体结构：

```jsonc
{
  "config": { "workingDir": "...", "date": "...", "environment": "win32", "structure": [], "isGitRepo": false, "...": "..." },
  "memory": null, "taste": null, "skills": null,
  "permissionMode": "standard",        // bypass -> auto-accept
  "mode": "agent",
  "params": {
    "model": "deepseek/deepseek-v4-flash",
    "messages": [ /* Anthropic 风格：text / image / reasoning / tool-call / tool-result */ ],
    "tools": [{ "name": "...", "description": "...", "input_schema": { } }],
    "system": [{ "type": "text", "text": "..." }],
    "max_tokens": 64000,
    "stream": true,
    "temperature": 0.7,
    "reasoning_effort": "high"
  }
}
```

上游流式事件（NDJSON）：`text-delta`、`reasoning-start` / `reasoning-delta` / `reasoning-end`、`tool-call`、`tool-result`、`finish`、`provider-metadata`、`error`、`abort`。

网关负责双向翻译：`OpenAI/Anthropic 请求 -> wire`，`wire NDJSON -> OpenAI SSE / Anthropic SSE`。

---

## 局域网开放与鉴权

默认监听 `0.0.0.0`（对局域网开放），**并且一定带鉴权**：只要不是本机回环地址，就必须出示 access key，否则 401。所以不会出现「忘了设置就直接裸奔」的情况。

### 鉴权规则

| 来源地址 | 是否要 key |
| --- | --- |
| `127.0.0.1` / `::1`（本机） | **不要**，本机默认受信任，面板即开即用 |
| 局域网 / 其它任何地址 | **必须要**，`x-api-key: <key>` 或 `Authorization: Bearer <key>` |
| 本机，但你用 `--client-key` 显式指定了 key | 也要（这时候连本机也一起管起来） |

被拒绝时返回 `401 {"error":{"message":"Invalid gateway access key",...}}`。

### access key：首次运行自动生成，之后固定

密钥**不是写死在代码里的**，也不是每次启动都变：**首次运行时随机生成一次（`cmdc_` + 40 位十六进制），写进配置文件，之后永久复用**。这样随机性和「客户端配置写一次就行」两个目标同时满足。

```jsonc
// ~/.cmdc-gateway/config.json
{
  "port": 8810,
  "host": "0.0.0.0",
  "accessKey": "cmdc_你自己机器上生成的那串"
}
```

- 生成时用 `crypto.randomBytes(20)`，不是可预测的序列。
- 优先级：`--client-key` / `CMD_GATEWAY_CLIENT_KEY`（本次生效）> 配置文件里的值 > **首次运行时生成并写入**。
- **想换**：`--client-key cmdc_你自己的 --save-port`（写进配置文件），或直接编辑上面那个文件。换了之后所有客户端要同步改。
- 看密钥的地方：启动日志 `access key :` 一行、面板「概览」页（带复制按钮）、`start-gateway.bat` 菜单 `[2] 查看状态`。
- 如果生成后写盘失败（比如目录不可写），启动日志会眀确警告 —— 否则下次启动会再生成一个，你所有客户端的 key 就全部失效了。

> 旧版本曾经把一个固定值写死在源码里（`cmdc_a9d9743...`）。仓库公开后它就不再是密码了，所以现已改成自动生成。**如果你的安装里还是那一串**（升级前首次运行写进过 `config.json`），启动日志和面板「概览」页会持续警告并给出更换命令；不换也不会报错，但它等于公开口令。

### 客户端怎么连

本机（不用 key）：

```
base_url = http://127.0.0.1:8810/v1
```

局域网内其它机器（必须带 key）：

```python
from openai import OpenAI
client = OpenAI(base_url="http://192.168.1.100:8810/v1", api_key="cmdc_xxxxxxxx...")
```

`api_key` 字段填网关的 access key 就行 —— OpenAI SDK 会把它放进 `Authorization: Bearer`，网关两种头都认。你的机器的局域网地址在启动日志、面板「概览」页、以及 BAT 的「查看状态」里都能看到。

> 网关对局域网开的是**你自己的订阅额度**。access key 泄露等于额度泄露，别把它贴到公开地方；不用时把 `host` 改回 `127.0.0.1` 即可只保留本机访问。

### 面板在局域网下

`/panel` 的 HTML 不含任何密钥，可以先加载；数据接口全部要 key。所以从别的机器打开 `http://<局域网IP>:8810/panel` 会立刻弹出「需要访问密钥」的输入框，填一次存进浏览器 `localStorage` 后就不再问。

### `/health` 的差别

本机访问 `/health` 返回完整信息（端口、模型数、lanUrls 等，bat 的「查看状态」靠它）；**非本机访问只返回** `{"status":"ok","gateway":"cmdc-gateway","port":8810,"authRequired":true}`，不把机器信息暴露给局域网。

---

## 固定端口

监听端口会被**记下来**，不是每次现算的：

```jsonc
// ~/.cmdc-gateway/config.json
{ "port": 8810 }
```

- 第一次运行时自动写入 `8810` 并从此固定，之后**不带参数启动永远是这个端口**，客户端（OpenAI / Anthropic SDK 的 `base_url`）写一次就不用再改。
- 优先级：`--port` / `CMD_GATEWAY_PORT`（**只影响这一次**，不写文件）> 配置文件里的固定值 > 首次运行固定 8810。
- 监听地址同理，也会固定下来（默认 `0.0.0.0`；想只留本机就 `--host 127.0.0.1 --save-port`）。
- 想永久换端口：`--port 9000 --save-port`，或直接编辑上面那个文件。
- **端口被占用时绝不自动换端口**，因为那会让客户端 base_url 悄悄对不上。会打印占用 PID 和可选做法：
  - 本次临时换端口启动（`--port 8811`，不改固定值）
  - 永久换成别的端口（`--port 9000 --save-port`）
  - 结束占用进程（`taskkill /PID <pid> /T /F`）
  - 或用 `start-gateway.bat`，菜单里会弹出同样的三个选项
- 启动日志和 `/health`、`/api/status` 都会回显 `fixedPort`、是否为固定端口、以及配置文件位置；面板「概览」页也能看到。

---

## 多账号轮换

网关可以同时保存多个 Command Code 账号，并在账号之间自动切换。

### 账号怎么存

凭据在 `~/.cmdc-gateway/auth.json`，是**一个账号数组**：

```jsonc
{
  "mode": "failover",          // sequential | failover
  "dashboard": "all",          // all 或某个账号 id
  "activeId": "user:dd74...",
  "accounts": [
    { "id": "user:dd74...", "apiKey": "user_...", "userId": "...", "userName": "...", "keyName": "...", "authenticatedAt": "..." }
  ],
  "states": {                    // 运行时状态，重启后继续生效
    "user:dd74...": { "cooldownUntil": 1750000000000, "invalidAt": "...", "invalidReason": "...", "invalidStatus": 401 }
  }
}
```

- **同名合并**：以 `userId` 优先、其次 `userName`（不区分大小写）、再次 apiKey 判定身份；命中已有账号就更新它，不会多出一条。所以同一个账号反复登录只会有一条，改个显示名登进来也是同一条。
- **不同账号各占一条**。
- 旧版本的单 key 格式会自动迁移成 `accounts[0]`，不需要手动改。
- `--api-key` / `COMMAND_CODE_API_KEY` 属于显式指定，会**独占**一个账号并关闭轮换（不会被写进文件）。

### 两种使用方式

面板「账号」页右上角切换：

| 模式 | 行为 | 额度耗尽后冷却多久 |
| --- | --- | --- |
| **用完再换**（`sequential`） | 一直用当前账号，直到它的额度确实耗尽才切走 | 到该账号额度窗口的 `resetAt`（拿不到就退回默认 5 分钟） |
| **遇 429 自动换**（`failover`） | 一直用当前账号，遇到 429 / 额度不足 / 401 / 403 才切到下一个 | 默认 5 分钟（响应带 `Retry-After` 则按它来） |

两种模式都做了同一件事：**请求先在上游建立连接，成功之后再给客户端写响应头**。所以第一个账号被限流时，网关会静默换下一个账号重试（最多 4 个），客户端只看到一次成功的响应，不会收到半个流再断掉。

### 「当前」是你的首选，「上次服务」是真实情况

侧栏和「账号」页里的**「当前」标签 = 你的首选账号**，它只由这三件事改变：

1. 你在面板点「设为当前」（或调 `POST /api/accounts/active`）；
2. 首选账号**确实不可用了**（额度耗尽进入冷却 / Key 被标记失效 / 被删除），轮换真的落到别的账号上；
3. 新添加第一个账号时自动选定。

关键是第 2 条：“确实不可用”才算数。**一个并发请求碰巧由别的账号服务完成，不会把「当前」改回去** —— 否则你在面板上刚切完，几百毫秒内就会被撤销（以前就是这个行为，已修）。

同时每一行还会有一个**「上次服务」标签**，标出真正处理了最近一次请求的账号。所以：

- 两行分别是「当前」和「上次服务」→ 首选正常，只是刚才是另一个账号在干活（比如它还在冷却、或者那个请求发出时你还没切）；
- 同一行同时有「当前」和「上次服务」→ 首选正在实际接活，一切正常；
- 你切到一个 Key 已失效的账号→仍会设为「当前」（尊重你的选择），但请求会被其它可用账号实际服务，面板会弹提示告诉你这一点。

切换会落盘（`activeId` 写回凭据文件），`lastServedId` 也会落盘，所以重启后两个标签都还在，不会看到一片空白。

被限流的账号会进入冷却（默认 5 分钟，若响应带 `Retry-After` 则按它来），冷却期间不会再被选中；如果所有账号都在冷却，则放开限制照常轮流尝试。

**失效账号会被踢出轮换。** 401/403（Key 被吊销、登录过期）不是暂时限流，重试再多次也不会成功，所以网关会把它标记为**失效**并直接跳过，不再每次请求都白跑一趟。失效标记与冷却时间都写在凭据文件的 `states` 里，**重启后依然有效**（旧版本只存在内存里，一重启就忘）。

- 失效只影响「不再自动选中」：所有账号都失效时仍会回退去试，不会把网关卡死。
- 一旦某个账号真的成功响应一次，它的失效标记会自动清除（自愈）。
- 想手动恢复：面板「账号」页顶「重新校验」（真的去问一次 `/alpha/whoami`）或「清除冷却」。

### 仪表盘：合计还是分开看

侧栏「统计范围」下拉（**只有 2 个以上账号时出现**，单账号自动隐藏）：

- **全部（合计）**：请求数、tokens、花费做**求和**；缓存命中率、平均首字按 token 量**加权平均**；额度（余额、5 小时窗口、每周窗口）也是各账号相加。
- **某个账号**：只看这个账号的指标与额度。

选择会记到 `dashboard` 字段，刷新后保持。指标页原有组件不变，额外多了一张「按账号」对照表，可以直接横向比较每个账号的请求数、缓存命中、首字、花费。留空 `system` 时后端注入的 harness 提示词通常大量命中缓存，所以各账号的缓存率差异会很明显。

---

## 和直接用 cmdc 提问有什么区别

**相同**：同一个后端（`/alpha/generate`）、同一批模型、同一份套餐与额度计费、同一套鉴权头与设备指纹。一次请求在后端看来和 CLI 发出的没有区别。

**不同**（网关是「无 agent 的裸推理通道」，cmdc 是「带 agent 循环的产品」）：

| 能力 | cmdc CLI | 本网关 |
| --- | --- | --- |
| 请求翻译 | 自己构造 wire 请求 | 把 OpenAI / Anthropic 请求翻译成同款 wire |
| 工具执行 | CLI 自己执行（读写文件、跑命令、搜索）并把结果回灌，多轮直到完成 | **不做**。tools 只是透传给模型，模型给出 tool_calls 后由**你的客户端**执行并回传下一轮 |
| 会话与上下文 | 会话存储、compaction、恢复、taste 学习 | 无状态（只有客户端传 UUID 形式的 `user` 时才透传 `threadId`） |
| 系统提示 | 自己的 harness 提示 + 工具集 | 你传 system 就用你的；不传则由后端注入它的 harness 提示（约 7.5K tokens，会计入 `prompt_tokens`） |
| 权限模式 | `/permissions`、工具授权交互 | 固定 `standard`（没有本地工具需要授权） |
| 客户端 | 只能用 cmdc | 任何 OpenAI / Anthropic 客户端都能接 |
| 额外 | - | 按套餐过滤模型、额度监控、Web 面板 |

一句话：**cmdc 是「模型 + 工具 + 循环 + 会话」，网关只保留「模型」这一层，把它变成标准 API。** 想要 agent 行为，需要调用方自己实现工具循环。

---

## 启动方式详解（含 Windows 一键启动）

> 三步安装见文首「快速开始」。这一节讲端口固定、Windows 菜单与常见启动选项。

### Windows 一键启动

项目根目录带一个 `start-gateway.bat`（桌面上也放了一份 `cmdc-gateway.bat`）。**双击进入菜单**：

```
============================================================
  cmdc gateway
------------------------------------------------------------
  状态    运行中    端口 8810
  固定端口 8810
  客户端   http://127.0.0.1:8810/v1
  面板     http://127.0.0.1:8810/panel
============================================================

  [1] 重启服务
  [2] 查看状态
  [3] 关闭服务
  [4] 启动服务
  [0] 退出
```

菜单顶部会直接给出**客户端要填的 base URL**。脚本自己从 `~/.cmdc-gateway/config.json` 读固定端口；端口没被让给别人，就不会变。

- **启动服务**：在独立窗口里跑服务（日志可见），等端口就绪后自动打开面板；已在运行则直接提示。首次运行缺 `models.json` 会自动生成。
- **端口冲突时给选择**：端口是固定值且**不会自动更换**（避免你以为服务在跑、实际地址变了）。若被占用且经 `/health` 确认不是本网关，菜单会列出 `[1] 结束占用进程并启动 / [2] 这次换个端口启动（不改固定端口） / [0] 取消`，并提示怎么永久改端口。
- **查看状态**：读取 `/health` 并打印监听地址、后端、模型数、登录来源、指纹开关、cli 版本。
- **关闭服务**：按端口找出监听进程并结束，同时关掉遗留的日志窗口。
- **重启服务**：先停后启。
- 菜单顶部实时显示运行状态（走 `netstat`，很快），不必猜服务在不在。

也可以带参数直接用，方便放进快捷方式或计划任务：

```bat
cmdc-gateway.bat start            :: 启动
cmdc-gateway.bat stop             :: 关闭
cmdc-gateway.bat restart          :: 重启
cmdc-gateway.bat status           :: 查看状态
cmdc-gateway.bat                   :: 菜单（默认）
cmdc-gateway.bat 8888             :: 用 8888 端口开菜单
cmdc-gateway.bat start 8888       :: 用 8888 端口启动
```

其他说明：

- 环境变量 `CMD_GATEWAY_NO_BROWSER=1` 可让启动时不自动打开浏览器。
- 项目移动了位置，只改脚本顶部那一行 `PROJECT` 即可。
- 该脚本保存为 **GBK** 编码：cmd 按控制台代码页读取批处理文件，UTF-8 的中文路径会让解析错乱（所以它不能存成 UTF-8，编辑时也请用 ANSI/GBK 保存）。

启动输出示例：

```
cmdc-gateway is running
  panel      : http://127.0.0.1:8810/panel
  base url   : http://127.0.0.1:8810/v1  (本机客户端用这个)
  lan url    : http://192.168.1.100:8810/v1
  port       : 8810 固定端口 (来自 C:\Users\you\.cmdc-gateway\config.json)
  access key : cmdc_xxxxxxxxxxxxxxxx  (局域网请求必须带)
  鉴权规则   : 本机 127.0.0.1 免鉴权；其它地址必须带 x-api-key 或 Authorization: Bearer
  backend    : https://api.commandcode.ai (prod)
  accounts   : 2 (2399561437cwjq 当前)
  rotation   : failover · 统计范围 all
  cred store : C:\Users\you\.cmdc-gateway\auth.json
  fingerprint: on
  models     : 46 / 70 (cmdc 1.53.1)
Endpoints:
  GET  /panel                 web panel (accounts, models, quota, stats, playground)
  GET  /health
  GET  /v1/models
  POST /v1/chat/completions   (OpenAI)
  POST /v1/messages           (Anthropic)
```

前置条件：打开 `/panel` 登录即可（API Key 或浏览器授权），或设置 `COMMAND_CODE_API_KEY`，或用 `--use-cli-auth` 复用 cmdc 命令行的登录态。

---

## 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 302 跳转到 `/panel` |
| GET | `/panel` | Web 控制面板（公开访问，不含密钥） |
| GET | `/health` | 运行状态、后端、模型数量（不含密钥） |
| GET | `/v1/models` | 模型列表；带 `anthropic-version` 头时返回 Anthropic 结构，也可用 `?format=anthropic` |
| GET | `/v1/models/:id` | 单个模型（OpenAI 结构） |
| POST | `/v1/chat/completions` | OpenAI Chat Completions，支持 `stream`、tools、多模态、`reasoning_effort` |
| POST | `/v1/messages` | Anthropic Messages，支持 `stream`、tools、system blocks、thinking 块 |
| ANY | `/callback` | 浏览器登录回调；`OPTIONS` 预检 + `POST`（JSON / 表单），`GET` 返回 405（公开，靠 state 校验） |
| GET | `/callback/complete` | 表单模式登录后的落地页 |
| GET | `/api/status` | 运行状态、登录身份、模型计数、指纹状态（不含明文 Key） |
| GET | `/api/models` | 模型目录；`?scope=accessible`（默认，按套餐过滤）或 `?scope=all` |
| GET | `/api/quota` | 套餐、余额、限流窗口、本期用量 |
| GET | `/api/stats` | 本网关指标：缓存命中、平均首字、推理占比、消耗曲线、按模型汇总（`?hours=1\|24\|168`） |
| GET | `/api/events` | **SSE 实时推送**：`request` / `stats` / `status` / `quota`，见下文 |
| POST | `/api/plan/refresh` | 强制重新拉取套餐并重算可用模型 |
| POST | `/api/auth/apikey` | 添加/更新账号：`{ "apiKey": "..." }`（同名合并） |
| POST | `/api/auth/browser/start` | 发起浏览器登录，返回 `{ url, state }` |
| POST | `/api/auth/logout` | 清空全部账号 |
| GET | `/api/accounts` | 账号列表（含是否首选 `active`、上次实际服务 `lastServed`、冷却到何时、是否失效；不返回明文 Key） |
| GET | `/api/accounts/quota` | **每个账号各自的额度**：套餐、月度/按量/赠送余额、5 小时与每周窗口、错误状态。`?account=<id>` 只看一个，`?refresh=1` 强制刷新 |
| POST | `/api/accounts/active` | 设为首选账号：`{ "id": "..." }`。之后的新请求优先打到它；若它的 Key 已失效，响应里会带 `warning` 说明 |
| POST | `/api/accounts/mode` | 轮换模式：`{ "mode": "sequential" \| "failover" }` |
| POST | `/api/accounts/scope` | 仪表盘范围：`{ "scope": "all" \| "<账号 id>" }` |
| POST | `/api/accounts/:id/verify` | 用该账号的 Key 重新校验 `/alpha/whoami`：通过则清除失效标记并刷新额度；401/403 则标记为失效 |
| POST | `/api/accounts/:id/reset` | 清除该账号的冷却与失效标记（不做网络校验） |
| DELETE | `/api/accounts/:id` | 删除指定账号 |

---

## Web 面板与登录

浏览器打开 <http://127.0.0.1:8810/panel>（`/` 会自动跳转）。

面板是浅色主题、直角、左侧固定导航，共六个页签：**概览**（后端 / 运行参数 / 凭据位置 / 指纹）、**指标**（缓存命中、平均首字、消耗曲线、实时活动、按模型汇总）、**模型**（按套餐过滤、搜索、价格、点击 ID 复制）、**用量**（账号额度、限流窗口、**按账号明细**）、**账号**（每个账号各自的额度与状态，带「重新校验 / 清除冷却」操作）、**调试台**（选模型、填 system/user、流式或非流式发送并显示推理内容）。动效克制并遵守 `prefers-reduced-motion`。

侧栏左下角常驻三个实时仪表：**缓存率**（大号百分比，按下述阈值着色）、**5 小时窗口**与**每周窗口**（已用 / 上限 + 进度条）。「用量」页保留同一组窗口的详细版（带重置时间）以及余额和计费周期。

### 凭据独立存放

网关的凭据存在**自己的文件**里，不碰 cmdc 命令行那一份：

```
~/.cmdc-gateway/auth.json         # 0600，多账号数组 + 轮换模式 + 仪表盘范围
```

- 面板里登录、删除账号、退出，只改这个文件。`~/.commandcode/auth.json` 全程只读、不被写入（测试里对文件做了哈希比对）。
- 想在网关里直接复用 CLI 已登录的 Key，显式开启只读回退：`--use-cli-auth`。默认关闭，开启后状态里会标注 `cli auth (read-only)`。
- 显式传入的 `--api-key` / `CMD_GATEWAY_API_KEY` / `COMMAND_CODE_API_KEY` 优先级最高，不会被写入磁盘。

### 两种登录方式

**1. API Key 登录**

粘贴 Command Code 的 API Key → 先用它请求 `GET /alpha/whoami` 校验 → 通过后写入网关自己的凭据文件并**立即生效，无需重启**。校验失败会区分「Key 无效 (401)」与「后端不可达」。**已存在的账号会被更新而不是新增一条**，所以可以放心重复添加。

**2. 浏览器登录（复刻 `cmdc auth login`）**

点按钮后，网关生成 32 字节 state（10 分钟有效、一次性、防重放），并打开：

```
https://commandcode.ai/studio/auth/cli?callback=http://127.0.0.1:<port>/callback&state=<state>&mode=redirect
```

登录完成后，studio 会**向回调地址发 POST**（不是 GET 重定向），JSON 或表单两种 body 都支持：

| 请求 | 行为 |
| --- | --- |
| `OPTIONS /callback` | 返回 CORS 头；若带 `Access-Control-Request-Private-Network: true` 则回 `Access-Control-Allow-Private-Network: true`（缺这个 Chrome 会拦掉公网到 localhost 的请求） |
| `POST /callback`（`application/json`） | 校验 state 后写凭据，返回 `{"success":true}` |
| `POST /callback`（`application/x-www-form-urlencoded`） | 校验后 **303** 跳到 `/callback/complete?state=...`，渲染成功页 |
| `GET /callback` | 405，与 CLI 一致（该地址只会被自动调用） |
| `GET /callback/complete` | 落地页 |

> 回调地址固定用 `127.0.0.1`，所以**浏览器必须跑在网关所在机器上**。端口或地址特殊时用 `--callback-base` 覆盖。

### 登录后的行为

- 凭据写入 `~/.cmdc-gateway/auth.json`（0600），与 `cmdc` 命令行互不影响。
- 网关凭据按 `apiEnv` 隔离：staging 的 Key 不会在 prod 下被误用。
- 退出登录只清账号字段（`apiKey`/`userId`/`userName`/`keyName`/`authenticatedAt`），其它字段保留。
- 运行时的 Key 是动态读取的，登录/退出后下一条请求即生效。

### 模型只提供当前套餐可用的

`cmdc` 的模型目录是打包在 CLI 里的，能不能用由**套餐规则**在本地算出来（`allowedCategories` + `blockedModels`）。网关把这套规则和模型分类一起从 `cli.mjs` 抽到 `models.json`，再结合实时套餐判定：

- 套餐从 `/alpha/billing/subscriptions`、`/alpha/billing/credits`（先取 `/alpha/whoami` 的 orgId）实时读取，缓存 60 秒。
- `/v1/models` 与 `/v1/models/:id` **只返回当前套餐可用的模型**；面板「模型」页默认也只显示可用的，可切到「全部」查看被挡下的模型及其所需套餐。
- 判定规则与 CLI 一致：有按量/赠送余额时全部可用；未知模型视为可用（和 CLI 一样 fail-open）；套餐信息取不到时**不隐藏任何模型**并在界面提示，避免误伤。
- 手动刷新：面板「用量」页的「刷新套餐数据」，或 `POST /api/plan/refresh`。

### 额度监控

面板「用量」页显示**账号级**数据：套餐名、月度余额、按量余额、赠送余额、5 小时窗口与每周窗口（已用/上限/重置时间）、本期请求数、输入输出 tokens、花费与计费周期。数据来自 `/alpha/billing/credits` 与 `/alpha/usage/summary`，也可直接调 `GET /api/quota`。这里的数字包含你在 cmdc 命令行里的消耗，不只本网关。

**每个账号各自的额度**：

- 「用量」页下方「按账号明细」把每个账号的套餐、三个余额、两个窗口和查询状态列成一张表。
- 「账号」页每一行直接带该账号的套餐、余额和两个窗口（带进度条与重置时间），不用切换统计范围就能横向比较。
- 专用接口 `GET /api/accounts/quota`（`?account=<id>` 只看一个、`?refresh=1` 强制刷新）；面板打开时优先复用 SSE 推来的合计快照，不额外发请求。
- **查询失败不再显示成 0**：某个接口报错（401/超时/套餐取不到）时响应里会带 `error` / `errorStatus` / `authError`，面板显示「查询失败」并给出原因；合计则标记 `partial: true` 和 `failedAccounts`，不会把失败账号当成 0 混进合计。失败的缓存只保留 10 秒（成功是 60 秒），所以恢复得很快。
- 顺带修掉一个会让余额判断失效的 Bug：以前「有按量/赠送余额就解锁全部模型」的判断读错了字段层级（读的是顶层，实际挂在 `credits` 下），一直恒为 0。现已修正，所以有按量或赠送余额时 premium 模型会真的变成可用。

### 本网关指标

面板「指标」页显示**只经过本网关**的流量，可选 1 小时 / 24 小时 / 7 天窗口：

- **缓存命中率**：`cached_tokens / prompt_tokens`。不传 system 时后端会注入它的 harness 提示词，那部分通常大量命中缓存，命中率会很高；传了 system 则提示词小、命中率低。侧栏左下角按阈值着色：**低于 80% 红、80%~90% 橙、90% 及以上绿**；「指标」页的实时活动表与按模型表里每一行的缓存率用同一套阈值着色，所以可以直接横向比较不同模型的命中情况。
- **平均首字**：从收到请求到上游第一个事件的平均耗时，只统计流式请求（非流式无法单独测出首字），同时给出样本数。
- **平均耗时 / 成功率**：整次请求的墙钟时间与失败计数。
- **消耗曲线**：按时间分桶的折线，可在「花费 / tokens」之间切换；花费按 `models.json` 的挂牌价估算。图表按容器实际像素绘制（viewBox 与渲染尺寸一致），窗口缩放会重绘，不会出现拉伸变形；入场动画只在切换窗口或指标时播放，实时刷新不会反复闪动。
- **按模型汇总**：每个模型的请求数、缓存命中、平均首字、tokens、推理占比、单价与估算花费。
- **推理占比**：`reasoningTokens / completionTokens`。关键前提：上游的 `outputTokens` **本身就包含推理**（例如「17×23」这种小问题就能是 57 推理 + 27 正文 = 84），网关额外从 `outputTokenDetails` 把两部分拆开记录。所以这一项直接回答「首字慢是慢在模型内部思考，还是慢在别处」。实测一道简单算术题推理就占 68%，Agent 长任务通常更高。
- 「实时活动」表里的「推理」列是单次请求的推理 token 量；旧记录（升级前采集的）没有这个字段，会显示 `-`。

原始记录（最多 2000 条、保留 7 天）落在 `~/.cmdc-gateway/stats.json`，写入做了 2 秒防抖，指标采集失败不会影响正常请求。也可直接调 `GET /api/stats?hours=24`。

指标文件按 `--env` 隔离，避免不同后端的流量混在一起：`prod` 用 `stats.json`（保持原名，不丢已有历史），`staging` 用 `stats.staging.json`，`local` 用 `stats.local.json`。

### 实时推送（SSE）

面板不是轮询的，而是通过 `GET /api/events` 保持一条 SSE 长连接，服务端主动推：

| 事件 | 触发时机 | 内容 |
| --- | --- | --- |
| `request` | 每完成一次推理请求 | 单条记录：模型、协议、首字、耗时、缓存、tokens、花费 |
| `stats` | 有新请求后 600ms 防抖合并 | 该连接所订阅窗口的完整快照（指标、曲线、按模型汇总） |
| `status` | 登录 / 退出 / 套餐刷新 | 与 `/api/status` 同结构 |
| `quota` | 登录 / 退出 / 套餐刷新 | 与 `/api/quota` 同结构 |

- 连接时用 `?hours=` 和 `?account=` 声明窗口与账号范围，服务端按每个连接的参数分别推送快照；面板切换 1 小时 / 24 小时 / 7 天或切换账号范围时会自动重连。
- 25 秒一次 `: ping` 注释行保活，避免代理掐断空闲连接。
- 面板侧用 `fetch` + 手动解析 SSE（而不是 `EventSource`），这样能照常带上 `x-api-key` 头；断线后按 1.7 倍退避自动重连，重连成功会整体重新同步一次。
- 左侧栏底部的「实时已连接」指示灯就是这个通道的状态；「指标」页的**实时活动**表会随请求到达即时插入新行并高亮一次。

### 模型价格

`models.json` 里每个模型都带 `cost`（`input` / `output` / `cacheRead` / `cacheWrite`，单位是每 1M tokens 的美元），来自 cmdc 的官方价目表。面板「模型」页和「指标」页的「价格 入/出/缓存」列都直接展示它；估算花费就是拿这个价格乘上实际 tokens（缓存部分按 `cacheRead` 计价，其余按 `input`）。

### 设备指纹

启动时（以及登录成功后）会按 CLI 的算法上报一次设备指纹到 `/alpha/fingerprint/record`：`sha256("command-code:device-fingerprint:v1" + 信号)`，信号包括机器码、MAC、系统用户、主机名、git email、平台/架构/CPU/内存/时区等，全部哈希后上报，明文不出本机。与 CLI 行为对齐地遵守 `DO_NOT_TRACK=1` 与 `CMD_LOCAL_ONLY=1`，另可用 `--no-fingerprint` 关掉。当前状态在「概览」页可见。

### 保护面板中的敏感接口

`/v1/*` 与 `/api/*` 受 `--client-key` 保护；`/panel`、`/health`、`/callback*` 保持公开（浏览器导航无法携带自定义头）。设置 `--client-key` 后面板首次调用 API 会弹窗索要 Key，并存进浏览器 `localStorage`。


---

## 用法示例

### OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8810/v1", api_key="not-needed")

resp = client.chat.completions.create(
    model="deepseek/deepseek-v4-flash",
    messages=[{"role": "user", "content": "hello"}],
)
print(resp.choices[0].message.content)
```

### curl（流式）

```bash
curl http://127.0.0.1:8810/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek/deepseek-v4-flash","stream":true,
       "messages":[{"role":"user","content":"count to 5"}]}'
```

### Anthropic SDK

```python
from anthropic import Anthropic

client = Anthropic(base_url="http://127.0.0.1:8810", api_key="not-needed")
msg = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=256,
    messages=[{"role": "user", "content": "hello"}],
)
print(msg.content)
```

---

## 配置

命令行参数优先于环境变量。

| 参数 | 环境变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| `--port` | `CMD_GATEWAY_PORT` | 固定端口（首次固定 8810） | **只影响本次启动**，不修改固定端口 |
| `--save-port` | - | 关 | 配合 `--port`，把这次的端口写成新的固定端口 |
| `--host` | `CMD_GATEWAY_HOST` | 固定值（首次固定 `0.0.0.0`） | 监听地址；非回环地址一律要求 access key |
| `--base-url` | `CMD_GATEWAY_BASE_URL` | 按 `--env` 推导 | 后端根地址 |
| `--env` | `CMD_GATEWAY_ENV` | `prod` | `prod` / `staging` / `local`，同时决定读哪个 auth 文件 |
| `--api-key` | `CMD_GATEWAY_API_KEY` / `COMMAND_CODE_API_KEY` | 读网关凭据文件 | 显式指定 API Key；优先级最高，不落盘 |
| `--use-cli-auth` | `CMD_GATEWAY_USE_CLI_AUTH=1` | 关 | 允许只读回退到 `~/.commandcode/auth.json` |
| `--no-fingerprint` | `CMD_GATEWAY_FINGERPRINT=0` | 开 | 关闭启动时的设备指纹上报 |
| `--plan-ttl-ms` | `CMD_GATEWAY_PLAN_TTL_MS` | `60000` | 套餐/额度信息的缓存时长 |
| `--mode` | `CMD_GATEWAY_MODE` | `agent` | 传给后端的 `mode`（cli 内部取值：`agent`/`compact`/`title-gen`/…） |
| `--permission-mode` | `CMD_GATEWAY_PERMISSION_MODE` | `standard` | `standard` / `auto-accept` / `plan`（`bypass` 会映射为 `auto-accept`） |
| `--max-tokens` | `CMD_GATEWAY_MAX_TOKENS` | `64000` | 客户端未提供 max_tokens 时的默认值 |
| `--reasoning-effort` | `CMD_GATEWAY_REASONING_EFFORT` | 空（不注入） | 客户端**未指定**推理档位时注入的默认值（如 `low`）；客户端显式指定的值永远优先。默认留空是因为网关不应静默改变已有客户端的模型行为 |
| `--cwd` | `CMD_GATEWAY_CWD` | 进程 cwd | 发给后端的 `config.workingDir` |
| `--callback-base` | `CMD_GATEWAY_CALLBACK_BASE` | `http://127.0.0.1:<port>` | 浏览器登录回调的基地址 |
| `--client-key` | `CMD_GATEWAY_CLIENT_KEY` | 自动生成的 `cmdc_...` | 访问密钥；显式设置后**本机也要带**，配合 `--save-port` 可写回配置 |
| `--cli-version` | `CMD_GATEWAY_CLI_VERSION` | 读 `models.json` | `x-command-code-version` 头 |
| `--verbose` | `CMD_GATEWAY_VERBOSE` | 关 | 打印请求与翻译告警 |

baseUrl 预设：

- `prod` → `https://api.commandcode.ai`（`auth.json`）
- `staging` → `https://staging-api.commandcode.ai`（`auth.staging.json`）
- `local` → `http://localhost:9090`（`auth.local.json`）

---

## 行为说明与限制

- **系统提示词注入**：如果请求里**没有** system 消息，后端会自动注入 cmdc 自己的 harness 系统提示（约 7.5K tokens，会体现在 `prompt_tokens`）。只要你传了 system，就用你的。想压掉它就显式传一个 system。
- **`tool_choice` 不做强制**：`none` 会直接去掉 tools；`auto`/`required`/指定函数都按原样传 tools，后端不保证一定调用。
- **`top_p` / `top_k` / `stop` 不转发**：不在 wire 协议里，会被忽略并打印告警（`--verbose`）。
- **`thinking` 仅作提示**：Anthropic 的 `thinking.budget_tokens` 不映射，模型自行决定推理深度。
- **推理内容**：后端 `reasoning-*` 事件在 OpenAI 侧以 `delta.reasoning_content` 输出；在 Anthropic 侧输出为 `thinking` 块，并在关块前补一个 `signature_delta`（`signature` 为空字符串，因为上游并不提供真实签名）。
- **工具结果的形状会保留**：OpenAI 侧的 `tool` 消息 / Anthropic 侧的 `tool_result` 块如果是对象或数字（不是纯文本），会被 JSON 序列化后传给模型，而不是被当成空字符串丢掉。
- **用量字段容错**：上游 `finish` 事件如果不带用量（或字段名从 `totalUsage` 变成 `usage`），网关不会把已经算出来的 tokens 清零，也不会凭空编造数字。
- **推理 token 单独可见**：`outputTokens` 包含推理，网关额外拆出 `reasoningTokens` / `textTokens` 记进指标，可用 `GET /api/stats` 的 `totals.reasoningShare` 或面板「指标」页的「推理占比」查看。
- **上游始终流式**：网关内部恒以 `stream: true` 请求后端；客户端要 `stream: false` 时由网关聚合后返回完整 JSON。
- **`n > 1` 不支持**：只返回单个 choice。
- **远程图片**：`image_url` 为 http(s) 时按原样透传（由后端抓取）；data URL 会解析出 mimeType。
- **`/v1/models` 按套餐过滤**：模型清单来自 `models.json`（从 cmdc 打包的目录与访问规则抽取），可用性用实时套餐在本地判定。新增/下架模型后重跑 `node scripts/extract-models.mjs`，可用 `--from <node_modules 路径>` 指定安装位置。套餐信息取不到时不隐藏任何模型。
- **模型可用性取决于套餐**：不含套餐权限的模型会返回后端错误，网关原样透传状态码与消息。

---

## 安全

- 默认监听 `0.0.0.0`（局域网可访问），但**非回环地址一律要 access key**，key 在首次运行时自动生成并写入 `~/.cmdc-gateway/config.json`。不要把这个端口再转发到公网。
- 网关持有你的 cmdc 凭据并以其身份计费。任何拿到 access key 的人都在消耗你的额度，key 不要外传；只想本机用就 `--host 127.0.0.1 --save-port`。
- 凭据只写在网关自己的 `~/.cmdc-gateway/auth.json`（0600）。`~/.commandcode/auth.json` 默认不会被读取也不会被写入；只有显式加 `--use-cli-auth` 才会只读回退。
- `/panel`、`/health`、`/callback*` 是公开路径（浏览器导航无法带自定义头）。面板 HTML 不含任何密钥，数据接口全部要 key；`/health` 对非本机只返回最小信息。改凭据的 `/api/auth/*`、账号管理 `/api/accounts/*`、计费 `/api/quota`、指标 `/api/stats` 与实时通道 `/api/events` 全部受 key 保护。
- `/callback` 的 state 为一次性、10 分钟过期，可防重放；回调 body 限制 16KB；`logout` 清空账号列表（面板上有二次确认）。
- 设备指纹只上报 sha256 哈希后的信号，明文（机器码、MAC、用户名、主机名等）不出本机；可用 `--no-fingerprint`、`DO_NOT_TRACK=1` 或 `CMD_LOCAL_ONLY=1` 关闭。
- 面板没有任何外部资源引用（无 CDN、无字体请求、无网络字体），全部内联。

---

## 目录结构

```
src/server.mjs              HTTP 服务、路由、SSE 写出、错误处理
src/config.mjs              参数/环境变量/凭据解析
src/backend.mjs             /alpha/generate 客户端 + NDJSON 解析
src/openai.mjs              OpenAI 请求翻译 + 流式/非流式响应
src/anthropic.mjs           Anthropic Messages 翻译
src/auth.mjs                账号校验与浏览器登录 state / 回调
src/accounts.mjs            多账号存储、同名合并、轮换顺序与冷却
src/plan.mjs                套餐/额度获取与按模型的可用性判定
src/stats.mjs               请求指标采集、持久化与聚合
src/events.mjs              SSE 订阅与广播
src/fingerprint.mjs         复刻 CLI 的设备指纹采集与上报
src/panel.mjs               Web 控制面板（单页，无构建、无依赖）
src/wire.mjs                两侧共用的工具函数
src/models.mjs              模型目录读取与输出格式
scripts/extract-models.mjs  从已安装的 cmdc 抽取模型清单与套餐访问规则 -> models.json
models.json                 生成产物（含 access 规则）
```

运行时数据（不在仓库里）：

```text
~/.cmdc-gateway/auth.json     网关自己的凭据（多账号 + states），0600
~/.cmdc-gateway/config.json   固定端口 + 监听地址 + access key，0600
~/.cmdc-gateway/stats.json    指标原始记录，0600（staging / local 为 stats.<env>.json）
```

---

## 排错

| 现象 | 处理 |
| --- | --- |
| `No Command Code API key found` | 打开 `/panel` 登录，或设 `COMMAND_CODE_API_KEY`；想复用它 CLI 的登录态就加 `--use-cli-auth` |
| `401 Not authenticated` / `Session expired` | 凭据过期，在面板重新登录 |
| `400 Insufficient credits` | 套餐额度不足 |
| 面板提示「需要访问密钥」 | 从别的机器访问时必须带 access key；在本机面板「概览」页复制，或看启动日志 |\n| 局域网连不上 | 确认 `host` 是 `0.0.0.0`，并检查 Windows 防火墙是否放行该端口 |\n| 想只允许本机访问 | `--host 127.0.0.1 --save-port` |
| 浏览器登录回调显示 state 无效 | state 一次性且 10 分钟过期；浏览器需与网关同机，重新点一次登录 |
| 浏览器登录没有回调成功 | 回调固定为 `127.0.0.1`，跨机访问时用 `--callback-base`；Chrome 需要 PNA 预检，网关已处理 |
| 可用模型比预期少 | 这是按套餐过滤的结果。面板「模型」页切到「全部」可看到被挡下的模型及所需套餐；有按量/赠送余额时会全部解锁。多账号时取**并集**：任一账号能用就算可用 |
| 加了第二个账号但没被使用 | 添加账号不会抢走「当前」位置，这是刻意的：轮换顺序按添加顺序走。想立刻用它就在「账号」页点「设为当前」 |
| 切换了账号，但请求似乎还打在旧账号上 | 先看两个标签：「当前」是你的首选，「上次服务」是真正在干活的。「当前」是 B 而「上次服务」还是 A，说明 B 当时不可用（冷却中 / Key 失效）。去看 B 那一行的状态标签：若是「冷却至…」就等重置或点「清除冷却」，若是「Key 已失效」就点「重新校验」。注意一个并发请求碰巧由 A 完成不会再篡改你的首选（旧版本会，如果还看到这个现象请先确认网关已重启到新代码） |
| 侧栏没有「统计范围」下拉 | 只有一个账号时自动隐藏，单账号就是单账号模式 |
| 某个账号被标记「冷却至 …」 | 它刚返回了 429 或额度不足，暂时不会被选中。`failover` 下冷却默认 5 分钟、`sequential` 下冷却到额度窗口重置；所有账号都冷却时会放开限制继续轮换 |
| 某个账号被标记「Key 已失效」 | 它返回了 401/403，网关已把它踢出轮换（不再白跑）。确认 Key 还能用就点「重新校验」，只是临时抖动就点「清除冷却」，确实换了 Key 就重新登录 |
| **首字（TTFT）很慢** | 先看面板「指标」页的**推理占比**：占比高就是时间花在模型内部思考，用 `--reasoning-effort low` 收紧即可。其次看上下文：每次请求 130K+ prompt tokens 会明显拉长首字（实测平均值 139K）。另外本网关走的是 `api.commandcode.ai` 这一跳，与 cmdc CLI 同路，**实测与直连上游同速甚至更快**，但存在约 850ms 的底噪 —— 这个底噪不在网关里，改代码改不掉 |
| 额度显示成「查询失败」而不是 0 | 这是故意的：额度接口报错时网关会说明原因（含 HTTP 状态码），不会拿 0 冒充余额。看 `authError` 判断是不是 Key 失交 |
| 合计余额下面提示「部分数据缺失」 | 有账号查额度失败了，合计只包含成功的那些。去「用量」页的「按账号明细」看是哪个账号 |
| 账号页按钮点了返回 409 `readonly_store` | 本次启动用了 `--api-key` / 环境变量提供 Key，账号管理会被拒绝（不落盘、也不会生效）。去掉该参数并用面板登录才能用多账号 |
| 所有账号都不可用时 | 报错会列出每个账号的状态，例如 `所有账号都不可用 (a: 429, b: 401)` |
| 套餐信息取不到 | 网关会退化为「不隐藏任何模型」并在界面提示；点「刷新套餐数据」重试 |
| 模型走错后端 | 确认 `--env` 与凭据文件匹配（网关凭据按 env 隔离） |
| 模型列表为空 | 重跑 `node scripts/extract-models.mjs`（必要时加 `--from`） |
| 端口被占用 | 固定端口不会自动改。按提示选择：结束占用进程 / 本次临时换端口 / `--port 9000 --save-port` 永久改 |

---

## 备注

本工具仅在本机使用你自己的 cmdc 订阅凭据，属于个人自动化用途。协议为对 CLI 产物的逆向分析结果（cmdc v1.53.1），后续版本可能变更；若路由或字段调整，请对照 `dist/cli.mjs` 重新确认 `GENERATE_ROUTE` 与请求体字段。

---

## 许可证

[MIT](LICENSE) © 2026 suohx1415-beep

可自由使用、修改、再分发与商用，只需在副本中保留版权声明与许可声明。软件按「原样」提供，不附带任何明示或默示担保。

> 许可证覆盖的是**本项目的代码**，不涉及 Command Code 的服务：使用本网关仍需你自己的有效订阅，并自行遵守上游的服务条款（见文首「使用范围与免责声明」）。
