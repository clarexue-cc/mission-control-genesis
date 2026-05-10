export const customerBases = ['oc', 'hermes', 'both'] as const

export type CustomerBase = typeof customerBases[number]
export type CustomerBaseScope = Exclude<CustomerBase, 'both'> | 'shared'

export function parseCustomerBase(value: unknown): CustomerBase {
  return value === 'oc' || value === 'hermes' || value === 'both' ? value : 'both'
}

export function customerBaseIncludes(base: CustomerBase, target: Exclude<CustomerBase, 'both'>): boolean {
  return base === 'both' || base === target
}

export function customerBaseLabel(base: CustomerBase): string {
  if (base === 'oc') return 'OC'
  if (base === 'hermes') return 'Hermes'
  return 'OC + Hermes'
}
