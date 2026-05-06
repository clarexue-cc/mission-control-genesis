export function getLangfuseBaseUrl(): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_LANGFUSE_URL?.trim()
  return baseUrl ? baseUrl.replace(/\/+$/, '') : null
}

export function buildLangfuseTraceUrl(traceId: unknown): string | null {
  const id = typeof traceId === 'string' ? traceId.trim() : ''
  const baseUrl = getLangfuseBaseUrl()
  if (!baseUrl || !id) return null
  return `${baseUrl}/trace/${encodeURIComponent(id)}`
}

export function buildLangfuseTracesUrl(): string | null {
  const baseUrl = getLangfuseBaseUrl()
  return baseUrl ? `${baseUrl}/traces` : null
}
