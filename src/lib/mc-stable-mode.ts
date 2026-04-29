export type InterfaceMode = 'essential' | 'full'

type StableModeEnv = Partial<Pick<NodeJS.ProcessEnv,
  'NODE_ENV'
  | 'MC_NAV_FIXED'
  | 'NEXT_PUBLIC_MC_NAV_FIXED'
  | 'MC_PREVIEW_MODE'
  | 'MC_STABLE_FIXED'
  | 'NEXT_PUBLIC_MC_STABLE_FIXED'
>>

function isTruthyFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

export function isFixedNavigationEnabled(env: StableModeEnv = process.env): boolean {
  return isFixedDevPreviewMode(env)
    || isTruthyFlag(env.MC_NAV_FIXED)
    || isTruthyFlag(env.NEXT_PUBLIC_MC_NAV_FIXED)
}

export function isFixedDevPreviewMode(env: StableModeEnv = process.env): boolean {
  return env.NODE_ENV === 'development'
    || isTruthyFlag(env.MC_PREVIEW_MODE)
    || isTruthyFlag(env.MC_STABLE_FIXED)
    || isTruthyFlag(env.NEXT_PUBLIC_MC_STABLE_FIXED)
}

export function resolveEffectiveInterfaceMode(mode: InterfaceMode, env: StableModeEnv = process.env): InterfaceMode {
  return isFixedNavigationEnabled(env) ? 'full' : mode
}

export function isNavigationItemHiddenByInterfaceMode(
  item: { essential?: boolean },
  mode: InterfaceMode,
  env: StableModeEnv = process.env
): boolean {
  return resolveEffectiveInterfaceMode(mode, env) === 'essential' && !item.essential
}

export function shouldShowInterfaceModeSwitcher(isAdmin: boolean, env: StableModeEnv = process.env): boolean {
  return isAdmin && !isFixedNavigationEnabled(env)
}
