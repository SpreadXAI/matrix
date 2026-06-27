---
title: SpreadX Matrix — agent client (Skill + MCP client) for the SpreadX end-user MCP
path: /docs/design/spreadx-matrix.md
audience: [agent, engineer]
topics: [mcp, oauth, agent, skill, harness]
status: proposed
owner: milhous
prerequisites:
  - spreadx-platform:/docs/design/spreadx-mcp-user.md
---

# SpreadX Matrix (`spreadx-matrix`)

本仓库是 SpreadX「agent 代用户操作」能力的**消费侧**。`spreadx-platform` 负责 MCP **服务端**
(OAuth Resource Server `spreadx-mcp-user`,域名 `https://mcp.spreadx.ai/`);本仓库负责一切**调用**它的东西:
让 Claude / Codex agent 在一次 OAuth 授权后,**查余额、查订单、涨粉(follow)、互动(like/retweet/comment)**。

> 与 `spreadx-platform/docs/design/spreadx-mcp-user.md` 是同一系统的两端:那边定义工具契约与鉴权,
> 这边只做**接入 + 编排 + Skill 润色 + 确定性写闸**。**不复制任何服务端业务逻辑或授权判断。**

## 设计原则(本次复查基线:防过度设计)

1. **契约在工具,Skill 只润色** —— dry-run / confirm / shortfall>10% 拒绝的硬契约写在**服务端工具
   description**里。Codex 无需 skill 即遵守;Claude 端 Skill 只补话术。**只维护一份契约。**
2. **安全边界是确定性代码,不是 LLM** —— headless 路径唯一能批准真实写(`confirm=true`)的是 harness 的
   `canUseTool` 闸(人工批准 + 金额上限)。模型可任意*提议*,但永远无法*执行*被闸拒绝的写。
3. **客户端不重复服务端鉴权** —— scope 校验、shortfall>10% 拒绝、限流、60s JWT TTL 全在服务端。客户端
   闸只加「人在环」+「金额上限」,且只对 headless 自治路径。
4. **能用 SDK 自带的就不引依赖** —— 本地 mock 用 Agent SDK 的**进程内 MCP server**,不引
   `@modelcontextprotocol/sdk`、不手搓 http transport。

## 三个交付物

```
                         ┌─ Claude Code / Codex (编辑器内,本身就是 MCP client) ─┐
 编辑器路径  ──────────▶ │  .mcp.json / config.toml 挂载远程 spreadx           │
                         │  + spreadx-agent Skill(仅 Claude 端,UX 润色)      │
                         └─────────────────────────────────────────────────────┘
                         ┌─ 独立 harness (本仓库 src/) ────────────────────────┐
 程序化/无人值守路径 ─▶ │  Claude Agent SDK · query()                          │
                         │   ├ mcpServers: { spreadx: type http, Bearer }       │
                         │   ├ skills: spreadx-agent                            │
                         │   └ canUseTool: 确定性写闸(批准 + caps)            │  ← 唯一 headless 安全闸
                         │  matrix CLI(自然语言透传)                          │
                         └─────────────────────────────────────────────────────┘
                         ┌─ 本地 dev mock (dev-only, 用完即弃) ─────────────────┐
 离线开发 ────────────▶ │  Agent SDK 进程内 MCP server:get_balance +          │
                         │  create_follow_plan(镜像服务端 shortfall 守卫)      │
                         └─────────────────────────────────────────────────────┘
                                          │ ③ 三者都最终打到 →
                                          ▼  https://mcp.spreadx.ai/ (platform 拥有)
```

### 1. 编辑器路径(config + Skill)
- `.mcp.json`(Claude Code):`{ spreadx: { type: "http", url: "https://mcp.spreadx.ai/" } }`。
  **OAuth 由 Claude Code 自己跑**(服务端 401 + `WWW-Authenticate resource_metadata` 触发 DCR + 浏览器授权),配置里**不放 token**。
- `.claude/skills/spreadx-agent/SKILL.md`:superpowers 格式,balance/orders/follow/like 话术 + 两步协议 + shortfall 分档。**纯 UX,非功能必需。**
- `docs/codex-setup.md`:Codex `config.toml` 片段 + `codex mcp login`。
  **Codex 路径的写保护 = 服务端守卫 + Codex 自带确认 UI,不经过 matrix 的 canUseTool 闸**(闸只在 harness 里)。

### 2. 独立 harness(Agent SDK)
- `runAgent(prompt)`:一次 headless `query()`,挂 spreadx MCP(`type: "http"` + `Authorization: Bearer`)、加载 `spreadx-agent` skill、用 `makeWriteGate(...)` 当 `canUseTool`。
- `matrix` CLI:自然语言透传(`matrix "查余额"` / `matrix "帮 @laura 加 200 粉"`),交互模式下写操作走 stdin 批准。
- **确定性写闸语义**:
  - 读工具(`get_balance`/`list_orders`/`get_order`/`get_plan_status`)→ 直接放行。
  - 写工具 `confirm` 非 true(预览)→ 放行(预览无副作用)。
  - 写工具 `confirm=true` → 先查 caps(超 `MATRIX_MAX_FOLLOW`/`MATRIX_MAX_ENGAGEMENT` 直接拒);interactive → 问人;headless → 仅当 `MATRIX_AUTO_APPROVE=1` 且未超 cap 才放行,否则拒。
  - 非 `mcp__spreadx__*` 工具 → 拒(白名单)。

### 3. 本地 dev mock(dev-only)
- Agent SDK 进程内 MCP server,只实现 **`get_balance` + `create_follow_plan`**(够跑通读 + 两步写)。
  `create_follow_plan` 镜像服务端「`confirm=true` 且 shortfall>10% 则拒」的守卫。
- 仅当 `SPREADX_MCP_URL` 指向 mock 时启用。**平台 staging 上线后即可废弃。**

## 鉴权模型(谁拿 token)

| 路径 | 取 token 方式 | 备注 |
|---|---|---|
| Claude Code(`.mcp.json`) | 客户端自动 OAuth(DCR + PKCE + 浏览器) | 零配置 token |
| Codex(`config.toml`) | `codex mcp login spreadx` | 需较新 Codex |
| **harness(v1)** | 环境变量 `SPREADX_ACCESS_TOKEN` **手工粘贴**一个短时(~15min)access token | 见下「已知限制」 |

**已知限制 / 明确不做(YAGNI)**:harness v1 **不**内建 OAuth(不做 DCR / PKCE / 浏览器 / refresh 存储)。
真正的无人值守需要一个 `matrix login`(浏览器授权一次→存 refresh token→每次跑前用 AS `/oauth/token`
换 access token)。**该流程显式推迟**到「harness 真要长期跑」时再做,避免现在造一套 OAuth 客户端。

## Scope / Not in scope

**In scope**:`.mcp.json`、`spreadx-agent` Skill、Codex 文档、Agent SDK harness + CLI、确定性写闸、进程内 dev mock、确定性闸的测试(不依赖 LLM)。

**Not in scope**:MCP 服务端(平台拥有)、OAuth AS / DCR / refresh 客户端(v1)、生产密钥管理、复刻服务端 shortfall/scope 逻辑、`list_orders`/`get_order`/`get_plan_status`/`create_engagement_plan` 的 mock(端到端验证走平台 staging)。

## 跨仓库依赖与切换

`.mcp.json` 与 harness 连**真实**服务器,需 `spreadx-platform` 完成 **Phase B.4**(FastMCP streamable-http
transport)并部署 `mcp.spreadx.ai`。在那之前:编辑器/harness 跑本地 dev mock;确定性写闸与核心逻辑用单测全覆盖。
**切换 = 改一个环境变量 `SPREADX_MCP_URL`**,无代码改动。

## 安全模型(三层,各管各的)

| 层 | 由谁强制 | 管什么 |
|---|---|---|
| 服务端(权威) | `spreadx-mcp-user` | scope 校验、shortfall>10% 拒 confirm、限流、60s platform-JWT TTL、吊销在 AS |
| harness 写闸(确定性) | 本仓库 `canUseTool` | 真实写前的人工批准 + 金额上限;**headless 唯一安全闸** |
| 编辑器原生确认 | Claude plan mode / Codex confirm | interactive 第二道人工闸 |

客户端**不**复制服务端的任何授权判断;闸只补「人在环 + caps」,且只针对自治路径。
