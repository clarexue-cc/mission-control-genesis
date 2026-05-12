'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { MarkdownRenderer } from '@/components/markdown-renderer'

type VaultNode = {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  obsidian_path?: string | null
  virtual?: boolean
  children?: VaultNode[]
}

type VaultTreeResponse = {
  tenant: string
  tenants: string[]
  obsidian_vault_name: string
  obsidian_vault_root: string
  tree: VaultNode[]
  error?: string
}

type VaultFileResponse = {
  path: string
  name: string
  content: string
  size: number
  modified: number | null
  physical_path: string | null
  obsidian_path: string | null
  obsidian_deeplink: string | null
  virtual: boolean
  error?: string
}

const fallbackTenants = ['wechat-mp-agent']
const panelClassName = 'rounded-lg border border-border bg-card/70'

function formatBytes(value?: number) {
  if (!value) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function firstFile(nodes: VaultNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'file') return node.path
    const child = firstFile(node.children || [])
    if (child) return child
  }
  return null
}

function fileIcon(node: VaultNode) {
  if (node.type === 'directory') return '▸'
  if (node.name.endsWith('.md')) return '#'
  if (node.name.endsWith('.json') || node.name.endsWith('.jsonl')) return '{}'
  return '•'
}

function VaultTree({
  nodes,
  selectedPath,
  expanded,
  onToggle,
  onSelect,
  level = 0,
}: {
  nodes: VaultNode[]
  selectedPath: string | null
  expanded: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  level?: number
}) {
  return (
    <div className={level === 0 ? 'space-y-1' : 'space-y-0.5'}>
      {nodes.map(node => {
        const isExpanded = expanded.has(node.path)
        const isSelected = selectedPath === node.path
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => {
                if (node.type === 'directory') onToggle(node.path)
                else onSelect(node.path)
              }}
              className={`flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                isSelected ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
              style={{ paddingLeft: `${8 + level * 14}px` }}
            >
              <span className={`w-4 shrink-0 font-mono ${node.type === 'directory' && isExpanded ? 'rotate-90' : ''}`}>{fileIcon(node)}</span>
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              {node.virtual && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">virtual</span>}
            </button>
            {node.type === 'directory' && isExpanded && Boolean(node.children?.length) && (
              <VaultTree
                nodes={node.children || []}
                selectedPath={selectedPath}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
                level={level + 1}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function VaultBrowserPanel() {
  const [tenant, setTenant] = useState('wechat-mp-agent')
  const [availableTenants, setAvailableTenants] = useState(fallbackTenants)
  const [tree, setTree] = useState<VaultNode[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<VaultFileResponse | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['Agent-Shared', 'Agent-Main', 'skills']))
  const [vaultName, setVaultName] = useState('openclaw')
  const [vaultRoot, setVaultRoot] = useState('')
  const [loadingTree, setLoadingTree] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stats = useMemo(() => {
    const count = (nodes: VaultNode[]): { files: number; folders: number; bytes: number } =>
      nodes.reduce((acc, node) => {
        if (node.type === 'file') return { files: acc.files + 1, folders: acc.folders, bytes: acc.bytes + (node.size || 0) }
        const child = count(node.children || [])
        return { files: acc.files + child.files, folders: acc.folders + 1 + child.folders, bytes: acc.bytes + child.bytes }
      }, { files: 0, folders: 0, bytes: 0 })
    return count(tree)
  }, [tree])

  const loadFile = useCallback(async (path: string) => {
    setLoadingFile(true)
    setError(null)
    try {
      const response = await fetch(`/api/harness/vault?action=content&tenant=${encodeURIComponent(tenant)}&path=${encodeURIComponent(path)}`, { cache: 'no-store' })
      const body = await response.json() as VaultFileResponse
      if (!response.ok) throw new Error(body.error || 'Failed to load vault file')
      setSelectedPath(path)
      setSelectedFile(body)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
      setSelectedFile(null)
    } finally {
      setLoadingFile(false)
    }
  }, [tenant])

  const loadTree = useCallback(async (nextTenant: string) => {
    setLoadingTree(true)
    setError(null)
    try {
      const response = await fetch(`/api/harness/vault?action=tree&tenant=${encodeURIComponent(nextTenant)}`, { cache: 'no-store' })
      const body = await response.json() as VaultTreeResponse
      if (!response.ok) throw new Error(body.error || 'Failed to load vault tree')
      setAvailableTenants(body.tenants?.length ? body.tenants : fallbackTenants)
      setVaultName(body.obsidian_vault_name)
      setVaultRoot(body.obsidian_vault_root)
      setTree(body.tree || [])
      const roots = new Set((body.tree || []).filter(node => node.type === 'directory').map(node => node.path))
      setExpanded(roots)
      const nextFile = firstFile(body.tree || [])
      if (nextFile) {
        await loadFile(nextFile)
      } else {
        setSelectedPath(null)
        setSelectedFile(null)
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
      setTree([])
      setSelectedFile(null)
    } finally {
      setLoadingTree(false)
    }
  }, [loadFile])

  useEffect(() => {
    loadTree(tenant).catch(() => {})
  }, [loadTree, tenant])

  function toggle(path: string) {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function openInObsidian() {
    if (!selectedFile?.obsidian_deeplink) return
    window.location.href = selectedFile.obsidian_deeplink
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div className={`${panelClassName} flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between`}>
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Vault</p>
          <h1 className="text-2xl font-semibold text-foreground">Vault Browser</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Tenant vault, shared memory, agent working context, skills, and intake documents in one review surface.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={tenant}
            onChange={event => setTenant(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none"
          >
            {availableTenants.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={() => loadTree(tenant)} disabled={loadingTree}>
            Refresh
          </Button>
          <Button size="sm" onClick={openInObsidian} disabled={!selectedFile?.obsidian_deeplink}>
            在 Obsidian 中打开
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid min-h-[62vh] flex-1 grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section className={`${panelClassName} flex min-h-0 flex-col overflow-hidden`}>
          <div className="border-b border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">File Tree</h2>
                <p className="mt-1 text-xs text-muted-foreground">{stats.files} files · {stats.folders} folders · {formatBytes(stats.bytes)}</p>
              </div>
              <span className="rounded bg-secondary px-2 py-1 text-[11px] text-muted-foreground">{vaultName}</span>
            </div>
            {vaultRoot && <p className="mt-2 truncate text-[11px] text-muted-foreground">{vaultRoot}</p>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {loadingTree ? (
              <Loader variant="panel" label="Loading vault" />
            ) : tree.length ? (
              <VaultTree nodes={tree} selectedPath={selectedPath} expanded={expanded} onToggle={toggle} onSelect={loadFile} />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">No vault files found.</p>
            )}
          </div>
        </section>

        <section className={`${panelClassName} flex min-h-0 flex-col overflow-hidden`}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">{selectedFile?.path || 'No file selected'}</h2>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {selectedFile?.physical_path || selectedFile?.obsidian_path || 'Select a file to preview markdown content.'}
              </p>
            </div>
            {selectedFile && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {selectedFile.virtual && <span className="rounded bg-amber-500/15 px-2 py-1 text-amber-300">virtual</span>}
                <span>{formatBytes(selectedFile.size)}</span>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {loadingFile ? (
              <Loader variant="panel" label="Loading file" />
            ) : selectedFile?.content ? (
              selectedFile.name.endsWith('.md') ? (
                <MarkdownRenderer content={selectedFile.content} />
              ) : (
                <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-background p-4 text-xs text-foreground">{selectedFile.content}</pre>
              )
            ) : (
              <p className="text-sm text-muted-foreground">No preview available.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
