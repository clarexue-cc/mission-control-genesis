export const TENANT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export function normalizeTenantId(value: unknown): string {
  const tenantId = typeof value === 'string' ? value.trim() : ''
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new Error('Tenant ID must use lowercase letters, numbers, and hyphens')
  }
  return tenantId
}
