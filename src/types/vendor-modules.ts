declare module 'node-pty' {
  export interface IPtyExitEvent {
    exitCode: number
    signal?: number
  }

  export interface IPty {
    onData(listener: (data: string) => void): void
    onExit(listener: (event: IPtyExitEvent) => void): void
    write(data: string): void
    resize(cols: number, rows: number): void
    kill(): void
  }

  export interface IPtyForkOptions {
    name?: string
    cols?: number
    rows?: number
    cwd?: string
    env?: Record<string, string>
  }

  export function spawn(file: string, args?: string[], options?: IPtyForkOptions): IPty
}

declare module '@xterm/xterm' {
  export class Terminal {
    constructor(options?: Record<string, unknown>)
    cols: number
    rows: number
    loadAddon(addon: unknown): void
    open(element: Element): void
    scrollToBottom(): void
    write(data: string): void
    onData(listener: (data: string) => void): void
    dispose(): void
  }
}

declare module '@xterm/addon-fit' {
  export class FitAddon {
    fit(): void
  }
}

declare module '@xterm/addon-web-links' {
  export class WebLinksAddon {
    constructor(handler?: (event: MouseEvent, uri: string) => void)
  }
}