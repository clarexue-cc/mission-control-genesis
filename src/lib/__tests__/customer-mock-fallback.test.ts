import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_MOCK_FALLBACK_TEMPLATE_ROOT,
  buildMockCustomerAnalysisDraft,
  buildMockCustomerSoulDraft,
} from '@/lib/customer-mock-fallback'

describe('customer-aware mock fallback templates', () => {
  it.each([
    {
      tenantId: 'wechat-mp-agent',
      expected: ['CEO', '资讯聚合', '苏格拉底', '课程 PPT', '名人动态追踪'],
      ownIds: ['ceo-news-aggregator', 'socratic-discussion-partner', 'course-ppt-generator', 'notable-person-tracker'],
      foreignIds: ['media-intel-signal-collector', 'web3-six-step-evaluator'],
    },
    {
      tenantId: 'media-intel-v1',
      expected: ['Media Intel', '媒体', 'Morning brief', '舆情'],
      ownIds: ['media-intel-signal-collector', 'source-evidence-deduper', 'risk-brief-composer'],
      foreignIds: ['ceo-news-aggregator', 'web3-six-step-evaluator'],
    },
    {
      tenantId: 'web3-research-v1',
      expected: ['Web3', '六步法判断', '链上数据', '团队尽调', '合规审查'],
      ownIds: ['web3-six-step-evaluator', 'onchain-data-reader', 'team-due-diligence', 'compliance-risk-review'],
      foreignIds: ['ceo-news-aggregator', 'media-intel-signal-collector'],
    },
  ])('builds $tenantId analysis fallback without cross-tenant skills', ({ tenantId, expected, ownIds, foreignIds }) => {
    const draft = buildMockCustomerAnalysisDraft(tenantId, '# Intake Raw\n客户材料暂不完整。')
    const text = JSON.stringify(draft)

    for (const keyword of expected) expect(text).toContain(keyword)
    for (const id of ownIds) expect(draft.skill_candidates.map(skill => skill.id)).toContain(id)
    for (const id of foreignIds) expect(text).not.toContain(id)
  })

  it('uses a generic placeholder fallback for unknown tenants', () => {
    const draft = buildMockCustomerAnalysisDraft('demo-arch-test-tenant', '# Intake Raw\n客户材料暂不完整。')
    const text = JSON.stringify(draft)

    expect(text).toContain('通用占位')
    expect(text).not.toContain('ceo-news-aggregator')
    expect(text).not.toContain('media-intel-signal-collector')
    expect(text).not.toContain('web3-six-step-evaluator')
  })

  it.each([
    ['wechat-mp-agent', ['CEO 助理人格', 'Hybrid 模式', '7 步 pipeline']],
    ['media-intel-v1', ['媒体情报人格', 'Morning brief', '舆情']],
    ['web3-research-v1', ['投研专家人格', '六步法判断', '链上数据', '合规审查']],
  ])('builds $tenantId SOUL/AGENTS fallback from the tenant template', (tenantId, expected) => {
    const draft = buildMockCustomerSoulDraft(tenantId, '# Intake Analysis\n', 'mock-fallback', 'mock')
    const text = `${draft.soul_md}\n${draft.agents_md}`

    for (const keyword of expected) expect(text).toContain(keyword)
    expect(text).not.toMatch(/{{\s*[A-Za-z0-9_.-]+\s*}}/)
  })

  it.each([
    'wechat-mp-agent',
    'media-intel-v1',
    'web3-research-v1',
  ])('keeps reviewable template files for $tenantId', async (tenantId) => {
    for (const file of ['intake-analysis.template', 'soul.template', 'agents.template']) {
      const template = await readFile(path.join(process.cwd(), CUSTOMER_MOCK_FALLBACK_TEMPLATE_ROOT, tenantId, file), 'utf8')
      expect(template).toContain(tenantId)
      expect(template).not.toMatch(/tenant-xxx-mock/)
    }
  })
})
