import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config, ensureDirExists } from '@/lib/config'
import {
  normalizeCostBudgetRuleInput,
  summarizeCostBudgetRules,
  type CostBudgetRule,
} from '@/lib/cost-budget-controls'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUDGETS_PATH = process.env.MISSION_CONTROL_COST_BUDGETS_PATH || join(config.dataDir, 'mission-control-cost-budgets.json')

async function readRules(): Promise<CostBudgetRule[]> {
  try {
    const raw = await readFile(BUDGETS_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.rules) ? parsed.rules : []
  } catch {
    return []
  }
}

async function writeRules(rules: CostBudgetRule[]) {
  ensureDirExists(dirname(BUDGETS_PATH))
  await writeFile(BUDGETS_PATH, JSON.stringify({ rules }, null, 2))
}

function responseFor(rules: CostBudgetRule[]) {
  return {
    rules,
    summary: summarizeCostBudgetRules(rules),
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    return NextResponse.json(responseFor(await readRules()), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logger.error({ err: error }, 'Cost budget GET error')
    return NextResponse.json({ error: 'Failed to load cost budget rules' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({}))
    const action = typeof body?.action === 'string' ? body.action : 'upsert'
    const rules = await readRules()

    if (action === 'delete') {
      const id = String(body?.id || '')
      const nextRules = rules.filter(rule => rule.id !== id)
      await writeRules(nextRules)
      return NextResponse.json(responseFor(nextRules))
    }

    const ruleInput = typeof body?.rule === 'object' && body.rule ? body.rule : body
    const nextRule = normalizeCostBudgetRuleInput(ruleInput as Record<string, unknown>)
    const nextRules = [
      nextRule,
      ...rules.filter(rule => rule.id !== nextRule.id),
    ].sort((a, b) => a.scope.localeCompare(b.scope) || a.target.localeCompare(b.target) || a.category.localeCompare(b.category))
    await writeRules(nextRules)
    return NextResponse.json(responseFor(nextRules))
  } catch (error) {
    logger.error({ err: error }, 'Cost budget POST error')
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save cost budget rule' }, { status: 400 })
  }
}
