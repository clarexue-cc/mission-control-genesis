'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

interface AgentRow {
  name: string
  scenario: string
  base: 'OC' | 'Hermes'
  priority: string
}

interface UploadResult { ok: boolean; tenant_id: string; path: string; content: string }

const MAX_BYTES = 100 * 1024 * 1024

const S3_OPTIONS = [
  { value: '能力补充', label: '能力补充 — 原来有人做，现在没人了' },
  { value: '降本增效', label: '降本增效 — 有人做但太慢太贵' },
  { value: '新增能力', label: '新增能力 — 以前没人做没条件做' },
]

const S6_HINTS: Record<string, string> = {
  '能力补充': '请填写：\n① 原来几人做？\n② 月薪/外包成本？\n③ 原来月产出量？\n④ 现在谁顶着？月产出多少？',
  '降本增效': '请填写：\n① 每次花多少小时？\n② 谁做的？时薪？\n③ 频率（每月几次）？\n④ 错误率？',
  '新增能力': '请填写：\n① 没有这个能力错过了什么？\n② 竞对有没有在做？\n③ 预期带来什么价值？',
}

const INIT_C4: AgentRow[] = [
  { name: '公众号 Agent', scenario: '媒体运营', base: 'OC', priority: 'P1 — 涵盖媒体全流程，技能复用最高' },
  { name: '情报搜索 Agent', scenario: '投研', base: 'Hermes', priority: 'P2 — 除客服外所有 agent 都需要搜索能力' },
  { name: 'CEO 助理', scenario: 'CEO 专属', base: 'Hermes', priority: 'P2 — 非定型业务，动态生成 skill' },
  { name: '短视频 Agent', scenario: '媒体运营', base: 'OC', priority: 'P3 — 复用公众号内容能力' },
  { name: '小红书 Agent', scenario: '媒体运营', base: 'OC', priority: 'P3 — 复用公众号内容能力' },
  { name: '知乎 Agent', scenario: '媒体运营', base: 'OC', priority: 'P4 — 复用搜索+内容能力' },
  { name: '社群 Agent', scenario: '媒体运营', base: 'OC', priority: 'P4 — 复用内容能力' },
  { name: '销售线索 Agent', scenario: '销售转化', base: 'OC', priority: 'P4 — 需搜索能力就绪' },
  { name: '播客 Agent', scenario: '媒体运营', base: 'OC', priority: 'P5 — 音频场景独立' },
  { name: '客服 Agent', scenario: '销售转化', base: 'Hermes', priority: 'P5 — 应答速度苛刻，用 Hermes' },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Tag({ children, color = 'gray' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    gray: 'bg-muted text-muted-foreground',
    blue: 'bg-blue-500/10 text-blue-500',
    green: 'bg-emerald-500/10 text-emerald-500',
    amber: 'bg-amber-500/10 text-amber-500',
  }
  return <span className={`ml-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-normal ${colors[color] || colors.gray}`}>{children}</span>
}

export default function CustomerOnboardingPage() {
  const [tenantId, setTenantId] = useState('wechat-mp-agent')
  const [tenantName, setTenantName] = useState('罗老师 · 公众号 Agent')

  // Layer 1: Customer Profile (C1-C6) — 罗老师真实数据
  const [c1, setC1] = useState('教育行业，罗老师个人 IP + 小团队（~5人），技术水平低（不懂代码），关键对接人：Vinson（媒体运营负责人），陈晓（投研负责人）')
  const [c2Budget, setC2Budget] = useState('15万/3个月')
  const [c2Timeline, setC2Timeline] = useState('2026 Q2（5-7月）')
  const [c2AgentCount, setC2AgentCount] = useState('10')
  const [c3, setC3] = useState('不能以罗老师名义发布未经审批的内容\n不能产生法律风险（版权、隐私、虚假信息）\n不能泄露商业机密和客户信息')
  const [c4Agents, setC4Agents] = useState<AgentRow[]>(INIT_C4)
  const [c5, setC5] = useState('vault-罗老师-媒体运营（公众号+短视频+小红书+知乎+社群+播客 共 6 个 agent 共享）\nvault-罗老师-CEO（CEO 助理独立）\nvault-罗老师-投研（情报搜索独立）\nvault-罗老师-销售（销售线索 + 客服共享）')
  const [c6, setC6] = useState('① 先公众号：涵盖媒体全流程（热点→选题→写作→配图→排版→发布），完成后其他 5 个媒体 agent 直接复用 80% 能力\n② 第二做情报搜索：除客服外所有 agent 都需要搜索能力，集中建设避免并发限制和重复成本\n③ CEO 助理可与搜索并行：Hermes 底座独立路径\n④ 其他媒体 agent 按渠道依次上线，复用公众号 + 搜索能力')

  // Layer 2: Agent Profile (S1-S6) — 公众号 Agent 真实数据
  const [s1, setS1] = useState('媒体运营')
  const [s2, setS2] = useState('微信公众号')
  const [s3, setS3] = useState('能力补充')
  const [s4, setS4] = useState('原 3 人媒体团队全部离职/转岗，公众号停更 3 个月，用 Agent 恢复并超越原产出')
  const [s5, setS5] = useState('每周至少 3 篇原创内容，质量不低于原团队水平\n包含完整流程：热点追踪→选题→正文→配图→排版→发布\n支持审批网关，发布前必须人工确认')
  const [s6, setS6] = useState('① 原来 3 人负责（2 编辑 + 1 设计）\n② 月薪合计约 3-4 万\n③ 原来月产出约 12 篇\n④ 现在 Vinson 一人顶，月产出约 2 篇\n⑤ 停更 3 个月，粉丝流失约 15%')

  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [locked, setLocked] = useState(false)
  const [intakePreview, setIntakePreview] = useState('')

  useEffect(() => {
    fetch(`/api/onboarding/customer/analyze?tenant_id=${encodeURIComponent(tenantId)}`)
      .then(res => res.json())
      .then(body => {
        if (body?.intake_raw_exists) {
          setLocked(true)
          setIntakePreview(body.intake_raw_preview || '')
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fileStatus = useMemo(() => {
    if (!file) return '支持 audio/* 与 text/*，最大 100MB'
    return `${file.name} · ${formatBytes(file.size)} · ${file.type || 'unknown'}`
  }, [file])

  function addAgentRow() { setC4Agents((p) => [...p, { name: '', scenario: '', base: 'OC', priority: '' }]) }
  function removeAgentRow(i: number) { setC4Agents((p) => p.filter((_, j) => j !== i)) }
  function updateAgentRow(i: number, f: keyof AgentRow, v: string) { setC4Agents((p) => p.map((r, j) => (j === i ? { ...r, [f]: v } : r))) }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(''); setResult(null)
    if (!tenantId.trim()) { setError('Tenant ID 不能为空'); return }
    if (file && file.size > MAX_BYTES) { setError('文件超过 100MB'); return }
    setSubmitting(true)
    try {
      const formData = new FormData()
      formData.set('tenant_id', tenantId)
      formData.set('tenant_name', tenantName)
      formData.set('summary', `${tenantName || tenantId}：${s4 || '客户接入'}`)
      formData.set('intake_data', JSON.stringify({
        layer1: { c1, c2: { budget: c2Budget, timeline: c2Timeline, agent_count: c2AgentCount }, c3, c4: c4Agents.filter((a) => a.name.trim()), c5, c6 },
        layer2: { s1, s2, s3, s4, s5, s6 },
      }))
      if (file) formData.set('file', file)
      const res = await fetch('/api/onboarding/customer/intake', { method: 'POST', body: formData })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || '提交失败')
      setResult(body)
    } catch (err: any) { setError(err?.message || '提交失败') }
    finally { setSubmitting(false) }
  }

  const inp = 'mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary'
  const lbl = 'text-sm font-medium text-foreground'
  const hint = 'mt-1 text-xs text-muted-foreground'
  const card = 'rounded-lg border border-border bg-card p-5 space-y-4'

  return (
    <main className="h-screen overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="border-b border-border pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">P3 / 客户接入</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal">新客户接入：Forcing Questions</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                两层结构：第一层定客户全景（C1-C6，签约后填一次，所有 Agent 复用），第二层定单 Agent 画像（S1-S6，每做一个 Agent 填一次）。填完后 P4 由 AI 自动生成蓝图。
              </p>
            </div>
            <Button asChild variant="outline" size="sm"><Link href="/">返回 MC 主页面</Link></Button>
          </div>
        </header>

        {locked && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg">✅</span>
                  <h2 className="text-sm font-semibold text-emerald-800">P3 接入已完成 — 表单已锁定</h2>
                </div>
                <p className="mt-1 text-xs text-emerald-700">intake-raw.md 已生成，内容已固定。如需修改，请点击右侧按钮解锁。</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setLocked(false)} className="border-emerald-500/40 text-emerald-800 hover:bg-emerald-500/15">
                  解锁修改
                </Button>
                <Button asChild size="sm" className="bg-emerald-700 text-white hover:bg-emerald-800">
                  <Link href={`/onboarding/customer/analyze?tenant=${encodeURIComponent(tenantId)}`}>进入 P4 →</Link>
                </Button>
              </div>
            </div>
            {intakePreview && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-emerald-700">查看已提交的 intake-raw.md 内容</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-emerald-500/20 bg-white/60 p-3 text-xs leading-relaxed text-emerald-900">{intakePreview}</pre>
              </details>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className={`space-y-6 ${locked ? 'pointer-events-none opacity-50' : ''}`}>
          {/* Tenant */}
          <div className={card}>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">基本信息</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={lbl} htmlFor="tid">Tenant ID</label>
                <input id="tid" value={tenantId} onChange={(e) => setTenantId(e.target.value)} required className={inp} placeholder="wechat-mp-agent" />
                <p className={hint}>小写字母、数字、连字符，代表此 Agent 的唯一标识。</p>
              </div>
              <div>
                <label className={lbl} htmlFor="tname">Tenant 名称</label>
                <input id="tname" value={tenantName} onChange={(e) => setTenantName(e.target.value)} className={inp} placeholder="罗老师 · 公众号 Agent" />
              </div>
            </div>
          </div>

          {/* ═══ 第一层：客户整体画像 C1-C6 ═══ */}
          <div className={card}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">第一层</span>
                <h2 className="text-lg font-semibold">客户整体画像（C1-C6）</h2>
              </div>
              <span className="rounded-md border border-blue-500/30 bg-blue-500/5 px-2 py-0.5 text-[10px] text-blue-500">客户级 · 所有 Agent 共享 · 第二个 Agent 起自动复用</span>
            </div>
            <p className="text-xs text-muted-foreground">一个客户填一次，签约后填写。后续新建 Agent 时此区域自动带入，只需更新下方第二层。</p>

            <div>
              <label className={lbl}>C1 · 客户是谁？</label>
              <textarea value={c1} onChange={(e) => setC1(e.target.value)} className={`${inp} min-h-16`} placeholder="行业、公司规模、技术水平、关键联系人..." />
              <p className={hint}>决定沟通方式、交付复杂度</p>
            </div>

            <div>
              <label className={lbl}>C2 · 合同概览 <Tag color="gray">全流程</Tag></label>
              <div className="mt-1.5 grid gap-3 sm:grid-cols-3">
                <input value={c2Budget} onChange={(e) => setC2Budget(e.target.value)} className={inp} placeholder="预算" />
                <input value={c2Timeline} onChange={(e) => setC2Timeline(e.target.value)} className={inp} placeholder="时间线" />
                <input value={c2AgentCount} onChange={(e) => setC2AgentCount(e.target.value)} className={inp} placeholder="Agent 总数" />
              </div>
              <p className={hint}>决定交付范围、分期节奏</p>
            </div>

            <div>
              <label className={lbl}>C3 · 公司级红线 <Tag color="blue">→ P8 Boundary</Tag></label>
              <textarea value={c3} onChange={(e) => setC3(e.target.value)} className={`${inp} min-h-16`} placeholder="所有 Agent 都不能碰的底线..." />
              <p className={hint}>所有 Agent 的全局 Boundary 基线，P8 生成 Boundary 时自动引用</p>
            </div>

            <div>
              <label className={lbl}>C4 · 全景 Agent 清单 <Tag color="blue">→ P4 蓝图输入</Tag></label>
              <div className="mt-2 overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium">Agent 名称</th>
                    <th className="px-3 py-2 text-left font-medium">所属场景</th>
                    <th className="w-28 px-3 py-2 text-left font-medium">底座</th>
                    <th className="px-3 py-2 text-left font-medium">优先级 + 理由</th>
                    <th className="w-10 px-3 py-2"></th>
                  </tr></thead>
                  <tbody>{c4Agents.map((a, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-2 py-1.5"><input value={a.name} onChange={(e) => updateAgentRow(i, 'name', e.target.value)} className="w-full rounded border border-input bg-background px-2 py-1 text-xs" /></td>
                      <td className="px-2 py-1.5"><input value={a.scenario} onChange={(e) => updateAgentRow(i, 'scenario', e.target.value)} className="w-full rounded border border-input bg-background px-2 py-1 text-xs" /></td>
                      <td className="px-2 py-1.5"><select value={a.base} onChange={(e) => updateAgentRow(i, 'base', e.target.value)} className="w-full rounded border border-input bg-background px-2 py-1 text-xs"><option value="OC">OC</option><option value="Hermes">Hermes</option></select></td>
                      <td className="px-2 py-1.5"><input value={a.priority} onChange={(e) => updateAgentRow(i, 'priority', e.target.value)} className="w-full rounded border border-input bg-background px-2 py-1 text-xs" /></td>
                      <td className="px-2 py-1.5 text-center">{c4Agents.length > 1 && <button type="button" onClick={() => removeAgentRow(i)} className="text-xs text-destructive hover:underline">x</button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <button type="button" onClick={addAgentRow} className="mt-2 text-xs text-primary hover:underline">+ 添加 Agent</button>
              <p className={hint}>OC = 技能编排型（确定流程，hook 强制）；Hermes = 对话型（非定型业务 / 应答速度要求高 / 搜索巡检守护型）</p>
            </div>

            <div>
              <label className={lbl}>C5 · Vault 分组 <Tag color="blue">→ P6 Vault 初始化</Tag></label>
              <textarea value={c5} onChange={(e) => setC5(e.target.value)} className={`${inp} min-h-20`} placeholder="从 C4 推导..." />
              <p className={hint}>同场景 Agent 共享 vault，不同业务线独立。P6 部署时按此分组初始化 Vault</p>
            </div>

            <div>
              <label className={lbl}>C6 · 优先级与复用逻辑 <Tag color="gray">→ 交付节奏</Tag></label>
              <textarea value={c6} onChange={(e) => setC6(e.target.value)} className={`${inp} min-h-20`} placeholder="为什么先做 A？..." />
              <p className={hint}>决定交付节奏、客户预期管理，贯穿 P3→P16 全流程</p>
            </div>
          </div>

          {/* ═══ 第二层：单 Agent 画像 S1-S6 ═══ */}
          <div className={card}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">第二层</span>
                <h2 className="text-lg font-semibold">单 Agent 画像（S1-S6）</h2>
              </div>
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 text-[10px] text-emerald-500">Agent 级 · 每个 Agent 独立填写</span>
            </div>
            <p className="text-xs text-muted-foreground">当前 Agent：<strong>{tenantName || tenantId}</strong>。填完 S1-S6 后，P4 AI 自动生成 → Workflow / Skills / SOUL / AGENTS / Boundary / UAT / Vault 架构。</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={lbl}>S1 · 所属场景 <Tag color="green">→ Vault 归属</Tag></label>
                <input value={s1} onChange={(e) => setS1(e.target.value)} className={inp} placeholder="媒体运营" />
                <p className={hint}>关联 C5 Vault 分组，决定此 Agent 归属哪个 vault</p>
              </div>
              <div>
                <label className={lbl}>S2 · 业务平台/渠道 <Tag color="green">→ P9 Skills</Tag></label>
                <input value={s2} onChange={(e) => setS2(e.target.value)} className={inp} placeholder="微信公众号" />
                <p className={hint}>决定 P9 需要哪些平台集成 Skill</p>
              </div>
            </div>

            <div>
              <label className={lbl}>S3 · 定性 <Tag color="green">→ P16 ROI</Tag></label>
              <select value={s3} onChange={(e) => setS3(e.target.value)} className={inp}>
                {S3_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <p className={hint}>决定客户预期 + P16 交付时的 ROI 计算方式</p>
            </div>

            <div>
              <label className={lbl}>S4 · 核心问题 <Tag color="green">→ P4 蓝图 + P7 SOUL</Tag></label>
              <input value={s4} onChange={(e) => setS4(e.target.value)} className={inp} placeholder="一句话描述这个 Agent 要解决什么问题" />
              <p className={hint}>Agent 的北极星，P4 蓝图和 P7 SOUL 都围绕这个核心展开</p>
            </div>

            <div>
              <label className={lbl}>S5 · 客户预期 <Tag color="green">→ P15 UAT</Tag></label>
              <textarea value={s5} onChange={(e) => setS5(e.target.value)} className={`${inp} min-h-20`} placeholder="交付标准、成功指标..." />
              <p className={hint}>直接转化为 P15 UAT 验收标准</p>
            </div>

            <div>
              <label className={lbl}>S6 · ROI 前期数据 <Tag color="amber">→ P16 交付报告</Tag></label>
              <textarea value={s6} onChange={(e) => setS6(e.target.value)} className={`${inp} min-h-24`} placeholder={S6_HINTS[s3] || ''} />
              <p className={hint}>P16 交付时用这些基线数据 vs 实际运行数据 → 计算 ROI → 客户续费依据</p>
            </div>
          </div>

          {/* ═══ 原始材料上传 ═══ */}
          <div className={card}>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">原始材料</span>
              <h2 className="text-lg font-semibold">上传访谈记录（可选） <Tag color="gray">→ P4 AI 输入</Tag></h2>
            </div>
            <p className="text-xs text-muted-foreground">访谈录音、文字稿、微信聊天等。P4 AI 会结合 S1-S6 + 原始材料自动生成蓝图。</p>
            <label htmlFor="intake-file" className="flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background px-4 py-4 text-center hover:border-primary">
              <span className="text-sm font-medium">拖拽或点击上传</span>
              <span className="mt-1.5 text-xs text-muted-foreground">{fileStatus}</span>
            </label>
            <input id="intake-file" type="file" accept="audio/*,text/*,.md,.txt" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>

          {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <Button type="submit" disabled={submitting} className="w-full">{submitting ? '生成中...' : '确认提交，生成 intake-raw.md → 进入 P4'}</Button>
        </form>

        {result && (
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="text-lg font-semibold">intake-raw.md 已生成</h2><p className="mt-1 text-xs text-muted-foreground">{result.path}</p></div>
              <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">生成成功</span>
            </div>
            <div className="mt-4 space-y-3">
              <Button asChild size="sm"><Link href={`/onboarding/customer/analyze?tenant=${encodeURIComponent(result.tenant_id)}`}>进入 P4 客户蓝图生成 →</Link></Button>
              <pre className="max-h-[400px] overflow-auto rounded-md border border-border bg-background p-4 text-xs leading-relaxed">{result.content}</pre>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
