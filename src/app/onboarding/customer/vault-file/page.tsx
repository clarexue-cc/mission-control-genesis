import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { Button } from '@/components/ui/button'
import { validateSession } from '@/lib/auth'
import { normalizeCustomerTenantId } from '@/lib/customer-intake'
import { resolveHarnessRoot } from '@/lib/harness-boundary'
import { resolveDefaultCustomerTenantId } from '@/lib/mc-stable-mode'
import { resolveWithin } from '@/lib/paths'
import { LEGACY_MC_SESSION_COOKIE_NAME, MC_SESSION_COOKIE_NAME } from '@/lib/session-cookie'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type SearchParamValue = string | string[] | undefined

function firstParam(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function normalizeVaultRelativePath(rawInput: string | undefined): string {
  const raw = (rawInput || 'vault').trim()
  if (!raw || raw === 'vault' || raw === 'vault/' || raw === 'workspace' || raw === 'workspace/') return ''
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw) || raw.includes('\0')) {
    throw new Error('Invalid vault path')
  }

  let normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized === 'vault' || normalized === 'vault/') return ''
  if (normalized === 'workspace' || normalized === 'workspace/') return ''
  if (normalized.startsWith('vault/')) normalized = normalized.slice('vault/'.length)
  if (normalized.startsWith('workspace/')) normalized = normalized.slice('workspace/'.length)

  const segments = normalized.split('/').filter(Boolean)
  if (segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error('Invalid vault path')
  }
  return segments.join('/')
}

function vaultHref(tenant: string, relativePath: string, prefix = 'vault') {
  const logicalPath = relativePath ? `${prefix}/${relativePath}` : prefix
  return `/onboarding/customer/vault-file?tenant=${encodeURIComponent(tenant)}&path=${encodeURIComponent(logicalPath)}`
}

function stageLabel(relativePath: string, isDirectory: boolean) {
  if (!relativePath) return 'P6 建根目录'
  if (relativePath === 'index.md') return 'P6 复制模板'
  if (relativePath === 'confirmation-cc.md') return 'P5 前置'
  if (relativePath === 'intake-raw.md') return 'P3 生成'
  if (relativePath.startsWith('intake-analysis')) return 'P4 生成'
  if (relativePath === 'Agent-Main') return 'P6 建目录 / P7 写入'
  if (relativePath.startsWith('Agent-Main/')) return 'P7 生成/优化'
  if (relativePath === 'Agent-Shared') return 'P6 复制模板 / Recall 验证'
  if (relativePath.startsWith('Agent-Shared/')) return 'P6 复制模板 / Recall 验证'
  if (relativePath === 'Agent-TEMPLATE') return 'P6 复制模板'
  if (relativePath.startsWith('Agent-TEMPLATE/')) return 'P6 复制模板'
  if (relativePath === 'Agent-MediaIntel') return 'P6 建目录'
  if (relativePath === 'Agent-Web3Research') return 'P6 建目录'
  if (relativePath === 'skills') return 'P6 建目录 / P9 生成'
  if (relativePath.startsWith('skills/')) return 'P9 生成'
  return isDirectory ? 'P6/后续目录' : '后续文件'
}

function purposeLabel(relativePath: string, isDirectory: boolean) {
  if (!relativePath) return '客户 vault 总入口'
  if (relativePath === 'index.md') return 'vault 索引'
  if (relativePath === 'confirmation-cc.md') return 'P6 触发前必须存在的签字文件'
  if (relativePath === 'intake-raw.md') return '客户原始访谈'
  if (relativePath.startsWith('intake-analysis')) return 'P4 分析结果'
  if (relativePath === 'Agent-Main') return '主 Agent 配置区'
  if (relativePath === 'Agent-Shared') return '共享知识、用户画像、项目状态和决策记录'
  if (relativePath === 'Agent-TEMPLATE') return '以后新增 Agent 时复用的模板'
  if (relativePath === 'Agent-MediaIntel') return '媒体情报 Agent 工作区'
  if (relativePath === 'Agent-Web3Research') return 'Web3 研究 Agent 工作区'
  if (relativePath === 'skills') return '后续 P9 生成客户专属 Skills'
  if (relativePath.endsWith('working-context.md')) return '新 Agent 的工作上下文模板'
  if (relativePath.endsWith('mistakes.md')) return '新 Agent 的纠错记录模板'
  if (relativePath.endsWith('shared-guide.md')) return '共享记忆规则模板'
  if (relativePath.endsWith('user-profile.md')) return '用户画像底稿'
  if (relativePath.endsWith('project-state.md')) return '项目状态底稿'
  if (relativePath.endsWith('decisions-log.md')) return '决策日志底稿'
  return isDirectory ? '目录' : '文件'
}

function isMarkdownFile(filePath: string) {
  return filePath.toLowerCase().endsWith('.md') || filePath.toLowerCase().endsWith('.mdx')
}

export default async function CustomerVaultFilePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, SearchParamValue>>
}) {
  const cookieStore = await cookies()
  const token = cookieStore.get(MC_SESSION_COOKIE_NAME)?.value || cookieStore.get(LEGACY_MC_SESSION_COOKIE_NAME)?.value
  const user = token ? validateSession(token) : null

  if (!user) {
    redirect(`/login?next=${encodeURIComponent('/onboarding/customer/deploy')}`)
  }
  if (user.role !== 'admin') {
    redirect('/')
  }

  const params = (await searchParams) || {}
  const tenant = normalizeCustomerTenantId(firstParam(params.tenant) || resolveDefaultCustomerTenantId())
  const rawPath = firstParam(params.path) || ''
  const isWorkspacePath = rawPath.startsWith('workspace/') || rawPath === 'workspace'
  const subDir = isWorkspacePath ? 'workspace' : 'vault'
  const relativePath = normalizeVaultRelativePath(isWorkspacePath ? rawPath.replace(/^workspace\/?/, '') : rawPath)
  const harnessRoot = await resolveHarnessRoot()
  const vaultRoot = resolveWithin(harnessRoot, `phase0/tenants/${tenant}/${subDir}`)
  const targetPath = resolveWithin(vaultRoot, relativePath || '.')
  const logicalPath = relativePath ? `${subDir}/${relativePath}` : `${subDir}/`
  const backHref = `/onboarding/customer/deploy?role=admin&tenant=${encodeURIComponent(tenant)}`
  const stats = await stat(targetPath).catch(() => null)

  if (!stats) {
    return (
      <main className="h-screen overflow-y-auto bg-background px-6 py-8 text-foreground">
        <div className="mx-auto max-w-5xl">
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>返回 P6</Link>
          </Button>
          <section className="mt-6 rounded-lg border border-destructive/35 bg-destructive/10 p-5">
            <h1 className="text-xl font-semibold">文件不存在</h1>
            <p className="mt-2 break-all text-sm text-muted-foreground">{logicalPath}</p>
          </section>
        </div>
      </main>
    )
  }

  const isDirectory = stats.isDirectory()
  const entries = isDirectory
    ? (await readdir(targetPath, { withFileTypes: true }))
      .filter(entry => entry.name !== '.DS_Store')
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    : []
  const content = !isDirectory && stats.size <= 500_000 ? await readFile(targetPath, 'utf8') : ''

  return (
    <main className="h-screen overflow-y-auto bg-background px-6 py-8 text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">P6 {isWorkspacePath ? 'Workspace' : 'Vault'} 查看</p>
            <h1 className="mt-2 break-words text-2xl font-semibold tracking-normal">{logicalPath}</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              这里读取的是 P6 真实创建出来的 tenant vault 文件；OpenClaw/Obsidian 只是后续运行或查看入口，不是本页的数据源。
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>返回 P6</Link>
          </Button>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">本机真实路径</div>
            <div className="mt-1 break-all text-sm font-semibold">{targetPath}</div>
          </div>
          <div className="rounded-md border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">当前来源</div>
            <div className="mt-1 text-sm font-semibold text-primary">Harness tenant {isWorkspacePath ? 'workspace' : 'vault'}</div>
          </div>
          <div className="rounded-md border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">节点标记</div>
            <div className="mt-1 text-sm font-semibold">{stageLabel(relativePath, isDirectory)}</div>
          </div>
        </section>

        {isDirectory ? (
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">目录内容</h2>
                <p className="mt-1 text-sm text-muted-foreground">{purposeLabel(relativePath, true)}</p>
              </div>
              <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">{entries.length} 项</span>
            </div>
            <div className="mt-4 divide-y divide-border overflow-hidden rounded-md border border-border bg-background">
              {entries.map(entry => {
                const childRelativePath = [relativePath, entry.name].filter(Boolean).join('/')
                const childIsDirectory = entry.isDirectory()
                return (
                  <div key={childRelativePath} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-semibold">
                        {entry.name}{childIsDirectory ? '/' : ''}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{purposeLabel(childRelativePath, childIsDirectory)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <span className="rounded-full bg-card px-3 py-1 text-xs font-medium text-primary">
                        {stageLabel(childRelativePath, childIsDirectory)}
                      </span>
                      <Button asChild variant="outline" size="sm">
                        <Link href={vaultHref(tenant, childRelativePath, subDir)}>查看</Link>
                      </Button>
                    </div>
                  </div>
                )
              })}
              {entries.length === 0 && (
                <div className="px-4 py-6 text-sm text-muted-foreground">这个目录当前为空。</div>
              )}
            </div>
          </section>
        ) : (
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">文件内容</h2>
                <p className="mt-1 text-sm text-muted-foreground">{purposeLabel(relativePath, false)}</p>
              </div>
              <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
                {stats.size.toLocaleString('zh-CN')} bytes
              </span>
            </div>
            {stats.size > 500_000 ? (
              <div className="rounded-md border border-amber-500/35 bg-amber-500/10 p-4 text-sm text-muted-foreground">
                文件太大，本页不直接展开；可以用本机路径查看。
              </div>
            ) : content.trim() ? (
              isMarkdownFile(relativePath) ? (
                <div className="rounded-md border border-border bg-background p-4">
                  <MarkdownRenderer content={content} />
                </div>
              ) : (
                <pre className="max-h-[70vh] overflow-auto rounded-md border border-border bg-background p-4 text-xs leading-relaxed">
                  {content}
                </pre>
              )
            ) : (
              <div className="rounded-md border border-border bg-background p-4 text-sm text-muted-foreground">文件为空。</div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
