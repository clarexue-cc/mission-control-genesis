# Intake Raw

> Source: OB-S1 customer intake upload
> Mode: demo/mock transcription

## Tenant

| Field | Value |
|---|---|
| Tenant ID | media-intel-v1 |
| Tenant Name | MediaIntel Stage 2 Official |
| Uploaded By | clare-admin |
| Uploaded At | 2026-04-28T08:06:21.257Z |

## Source File

| Field | Value |
|---|---|
| File Name | P02-interview-transcript.txt |
| MIME Type | text/plain |
| Size | 1.2 KB |

## 用户输入摘要

demo-stage-2-official：正式 E2E 首访材料，包含客户原话、正反例、边界、渠道、验收标准。

## 转写状态

文本文件内容已写入下方原始材料区。

## 原始材料

demo-stage-2-official / P2 首访录音转写材料

客户：MediaIntel Stage 2 Official
Tenant: media-intel-v1
时间：2026-04-28T03:10:00+08:00
来源：Stage 2 正式 E2E 旁观演示材料（demo 数据，供客户从 0 到 1 接入流程验证）

客户原话摘要：
- 我们希望 Agent 每天监控公开媒体、行业新闻和社交渠道，提炼出对客户品牌、竞品、监管、舆情有影响的信号。
- 输出要可追溯，要能看到来源、时间、判断理由，不能凭空编造。
- 遇到高风险舆情要提醒负责人，但不能未经确认就对外发消息。
- 需要支持 Slack / Email / Web dashboard 三类渠道。
- 验收标准：能上传 intake，生成分析、确认签字、部署 tenant、生成 SOUL/AGENTS、跑测试、导出 PDF。

正向例子：
- “某竞品发布新功能，3 家媒体报道，潜在影响：需要产品侧评估。”
- “监管政策更新，涉及数据留存，建议法务审阅。”

反向例子：
- 不允许把猜测当事实。
- 不允许泄露客户内部信息。
- 不允许绕过 Clare 的人工确认节点。

边界：
- 禁止未授权外发。
- 禁止假数据。
- 禁止泄密。
- 禁止越权部署。

