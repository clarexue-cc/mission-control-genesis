# Agent Preferences Persistence Plan

## Goal

让 Agent Squad 面板里的 CustomerAgentPreferences 真正和 harness console 同步：页面加载时读取后端偏好，点击 Save 时保存到后端，并补齐独立 API 测试与回归验证。

## Scope

- 新增 harness API 路由：GET/PUT /api/harness/agents/[name]/preferences
- 如有必要，扩展共享 proxy helper 对 PUT 的支持
- 前端把当前本地假保存改成真实的加载 + 保存流程
- 新增独立 Vitest 测试文件，覆盖 GET、PUT 校验、PUT 成功代理

## Execution Steps

1. 补齐后端路由与 proxy helper → verify: 新路由能把 harness config 映射成 { tone, language, response_length }，并能用 PUT 把校验后的偏好写回上游
2. 接入前端保存/加载 → verify: CustomerAgentPreferences 挂载后会读取远端值，点击 Save 会发起 PUT，成功后显示 Preferences saved
3. 添加独立测试并跑最小验证 → verify: 新增 preferences.test.ts 通过，且不会破坏现有 customer panel 测试
4. 做质量检查并准备提交 → verify: 代码评审通过，Vitest 通过，再决定是否继续 push/PR

## Expected Files

- src/lib/harness-console-proxy.ts
- src/app/api/harness/agents/[name]/preferences/route.ts
- src/app/api/harness/agents/[name]/preferences/__tests__/preferences.test.ts
- src/components/panels/agent-squad-panel-phase3.tsx

## Risks

- harness console /agents/{name}/config 的上游返回形状未在当前仓库中直接出现，因此路由会先兼容顶层字段和 preferences 嵌套两种形状
- 现有 customer-mode 面板测试会因为新增前端 fetch 触发额外请求，需要确认不会被打断