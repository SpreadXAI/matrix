# SpreadX Matrix

**让你的 AI agent 代你操作 SpreadX 账号。** 安装一个插件、在浏览器里授权一次,之后直接用自然语言提要求 —— *"查一下我的余额"*、*"帮 @laura 加 200 个 crypto 英文粉"*、*"给这条推点 50 个赞"* —— Claude(或 Codex)就会通过 **spreadx MCP 服务** 完成。任何真实写操作之前,都会先给出 dry-run 预览并等你确认。

> 本仓库是**客户端**。MCP **服务端**(`spreadx-mcp-user`,一个位于 `https://mcp.spreadx.ai/` 的 OAuth Resource Server)在 **`spreadx-platform`** 仓库。本仓库只提供 Skill、MCP 接入、以及一个独立 harness —— 不复制任何服务端业务逻辑,也不自行做任何鉴权判断。

---

## 快速开始 (Quickstart)

**Claude Code** —— 安装插件,然后直接问:

```
/plugin marketplace add SpreadXAI/matrix
/plugin install spreadx-matrix@spreadx-matrix
```

这会同时注册 `spreadx` MCP 服务**和** `spreadx-agent` Skill。首次使用时浏览器会弹出一次性 OAuth 授权。然后:

```
查一下我的余额
帮 @laura 加 200 个 crypto 英文粉
```

就这么简单。下面是 Codex、独立 harness、以及安全闸的工作方式。

---

## 工作原理 (How it works)

你用大白话提要求,agent **不会**盲目地直接发起破坏性写操作。`spreadx-agent` Skill(以及对没有 skill 的客户端而言,MCP 工具自身的 description)强制执行一套**两步协议**:每个写操作先以 **dry-run 预览** 运行(池子大小、预计能选多少账号、缺口 shortfall、ETA),展示给你,**你确认后**才真正执行。读操作(余额、订单、plan 进度)直接返回。

协议写在工具里,所以 **Codex 不需要任何 skill 也会遵守**。Claude 端的 Skill 只是上面一层话术。而在独立 harness 里,真正决定"是否执行真实写操作"的是一个确定性的 `canUseTool` 闸 —— 不是模型。

---

## 安装 (Installation)

这套能力由两部分组成:一个 **Skill**(话术/UX)和 **`spreadx` MCP 服务**(真正的工具)。具体怎么装,取决于你的客户端。

### Claude Code(插件 —— 一次装好两者)

```
/plugin marketplace add SpreadXAI/matrix
/plugin install spreadx-matrix@spreadx-matrix
```

插件([`.claude-plugin/`](.claude-plugin/))打包了 `spreadx-agent` Skill 并注册了远程 MCP 服务。首次调用工具时触发一次性浏览器 OAuth(用 Privy 登录、勾选授权 scope)。无需粘贴任何 token,无密钥落盘。

> 不想用插件?只注册服务即可 —— `claude mcp add --transport http spreadx https://mcp.spreadx.ai/`,并可选地把 `.claude/skills/spreadx-agent/` 复制进你项目的 `.claude/skills/`。

### Codex

Codex 是个没有 Skill 系统的 MCP 客户端;协议由工具自身的 description 携带。加到 `~/.codex/config.toml`:

```toml
[mcp_servers.spreadx]
url = "https://mcp.spreadx.ai/"
```

然后 `codex mcp login spreadx`。Codex 的写操作由**服务端**守卫 + Codex 自带的确认 UI 把关。详见 [`docs/codex-setup.md`](docs/codex-setup.md)。

### 独立 harness(脚本 / 无人值守)

一个 `matrix` CLI,程序化地驱动 agent,内置确定性写闸。

```bash
git clone https://github.com/SpreadXAI/matrix && cd matrix
pnpm install
cp .env.example .env          # 设置 ANTHROPIC_API_KEY;离线开发用 SPREADX_MCP_URL=mock
node --env-file=.env --import tsx src/harness/cli.ts "查一下我的余额"
```

`SPREADX_MCP_URL=mock` 会跑内置的进程内 mock —— 不需要平台、不需要 token —— 让你今天就能体验整个流程。所有环境变量和选项见 [`docs/usage.md`](docs/usage.md)。

---

## 基本工作流 (The Basic Workflow)

装好之后,任何任务都是同样的四个阶段:

1. **授权(一次)** —— 客户端在浏览器里跑 OAuth 流程。授权由 authorization server 持有,你不用再次登录。
2. **用自然语言提要求** —— `spreadx-agent` Skill 把你的话映射到对应的 `mcp__spreadx__*` 工具。读操作立即返回。
3. **写之前先预览** —— 对涨粉/互动 plan,agent 先用 `confirm:false` 调用,展示 dry-run:池子大小、预计选号、**shortfall 分档**(`≤5%` 继续 · `5–10%` 问 · `>10%` 不做)、ETA。
4. **确认后再执行** —— 你点头后,它用 `confirm:true` 再调一次。在 harness 里这一步过闸(你的 `y/N`,或 headless 模式下在额度内自动批准);在编辑器里则是客户端自带的确认 UI。任何 shortfall 超过 10% 的写操作,服务端都会拒绝。

之后随时**查进度**(`get_plan_status`)。涨粉(`create_follow_plan`)和赞/转/评(`create_engagement_plan`)走的是同一套工作流。

```
你:    帮 @laura 加 200 个 crypto 英文粉
Agent: [dry-run] 池子 1,000 · 预计选 200 · 缺口 0(足够)· ETA ~12 分钟。执行?
你:    ok
Agent: [confirm] plan mock-plan-1 已创建 ✅
```

---

## 包含什么 (What's Inside)

**工具**(在 agent 侧暴露为 `mcp__spreadx__<tool>`):

| 工具 | 类型 | Scope(服务端强制) | 作用 |
|---|---|---|---|
| `get_balance` | 读 | `balance:read` | 积分 / 钱包 / 套餐 |
| `list_orders` | 读 | `orders:read` | 充值订单(keyset 分页) |
| `get_order` | 读 | `orders:read` | 单个订单 |
| `get_plan_status` | 读 | `orders:read` | 某个 plan 的进度 |
| `create_follow_plan` | **写** | `plans:write` | 给某用户涨粉 |
| `create_engagement_plan` | **写** | `plans:write` | 对某条推点赞 / 转发 / 评论 |

**本仓库的组成:**

- `.claude-plugin/` —— Claude Code 插件(marketplace + manifest),打包 Skill 与 MCP 服务
- `.claude/skills/spreadx-agent/SKILL.md` —— Skill(工具之上的话术/UX)
- `.mcp.json` —— 项目模式的 MCP 挂载(直接克隆本仓库时用)
- `docs/codex-setup.md` —— Codex 配置
- `src/core/writeGate.ts` —— 确定性的 `canUseTool` 安全闸
- `src/harness/{client,cli}.ts` —— Agent SDK harness + `matrix` CLI
- `src/mock/` —— 进程内 dev mock(余额 + 涨粉),让 harness 能离线运行

**安全闸**(harness):读工具和写**预览**自动放行;真实写(`confirm:true`)必须先过额度上限(`MATRIX_MAX_FOLLOW` / `MATRIX_MAX_ENGAGEMENT`),再过批准(交互式 `y/N`,或 headless 下 `MATRIX_AUTO_APPROVE=1`)。它对缺失/非法的 count 以及任何非 spreadx 工具**失败即拒(fail closed)**,而且写工具被刻意排除在 SDK 的 `allowedTools` 之外,所以无法绕过闸被自动放行。由代码强制、由测试锁定 —— 与模型无关。

---

## 更新 (Updating)

```
/plugin marketplace update spreadx-matrix    # 拉取最新版本
```

卸载用 `/plugin uninstall spreadx-matrix`。harness 用 `git pull && pnpm install`。

---

## 安全 (Security)

无密钥落盘。插件/编辑器路径用客户端托管的 OAuth(任何配置里都不放 token);harness 只从环境变量读 `SPREADX_ACCESS_TOKEN`。`.env` 和 `.mcp.local.json` 已被 git 忽略 —— 永远别提交 token。吊销在 OAuth 层(平台 AS / dashboard);access token 的短 TTL 把泄露窗口限到最小。

---

## 状态与路线图 (Status & roadmap)

- ✅ 插件、Skill、编辑器配置、harness、确定性写闸、进程内 mock —— 已实现并测试(23 个测试)。
- ⏳ **真实服务端** —— MCP 地址 `mcp.spreadx.ai` 要等 `spreadx-platform` 完成 **Phase B.4**(FastMCP streamable-http)并部署后才可达。在那之前用 `SPREADX_MCP_URL=mock`;切换只需改一个环境变量。
- ⏳ **真实模型 smoke** —— LLM 驱动的工具循环需要 `ANTHROPIC_API_KEY`(对着 mock 跑)。闸、config、mock 逻辑已由测试 + 无 key 的运行时 smoke 验证。

## 另见 (See also)

- **[`docs/usage.md`](docs/usage.md)** —— 安装与使用,详细版
- **[`docs/design/spreadx-matrix.md`](docs/design/spreadx-matrix.md)** —— 设计 spec
- **`spreadx-platform`** —— MCP 服务端(`spreadx-mcp-user`)与 OAuth authorization server
