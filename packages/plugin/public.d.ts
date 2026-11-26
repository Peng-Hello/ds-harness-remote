import type { Context, Volatile } from '@deepseek-ai/cordis'

export interface Config {
  enabled?: boolean
  role?: 'host' | 'client' | 'both'
  /** HTTPS origin, or an explicit HTTP tunnel/self-hosted origin such as `http://203.0.113.10:8080`. */
  serverUrl?: string
  /** Extra HTTP hosts/CIDRs. A public HTTP `serverUrl` already allowlists its own host. */
  httpServerAllowlist?: string[]
  deviceName?: string
  terminal?: { enabled?: boolean }
  loopback?: { ports?: number[] }
  forceRelay?: boolean
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  reconnect?: boolean | {
    initialDelayMs?: number
    maxDelayMs?: number
    jitter?: number
  }
  codex?: {
    enabled?: boolean
    binary?: string
  }
}

export declare const name: 'ds-harness-remote'
export declare const Config: unknown
export declare function apply(ctx: Context, config?: Config | Volatile<Config>): void
export declare function runCli(args?: readonly string[]): Promise<number>
