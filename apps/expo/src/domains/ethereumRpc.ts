import { err, ok, type ResolverIO } from '@solidarity/shared';

import { readResponseTextBounded } from './boundedText';

/** Keyless, CORS-capable mainnet reads; keep provider changes in one place. */
export const ETHEREUM_RPC_ENDPOINTS: readonly string[] = [
  'https://cloudflare-eth.com/v1/mainnet',
  'https://ethereum-rpc.publicnode.com',
];

export const ETHEREUM_RPC_TIMEOUT_MS = 15_000;
export const ETHEREUM_RPC_MAX_RESPONSE_BYTES = 1_048_576;

export interface EthCallOptions {
  readonly fetchImpl?: typeof fetch;
  readonly endpoints?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

interface RpcTransport {
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function callEndpoint(
  endpoint: string,
  to: string,
  data: string,
  transport: RpcTransport
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, transport.timeoutMs);
  try {
    let response: Response;
    try {
      response = await transport.fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        redirect: 'error',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to, data }, 'latest'],
        }),
        signal: controller.signal,
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;

    const text = await readResponseTextBounded(response, transport.maxResponseBytes, controller);
    if (!text.ok) return null;

    let value: unknown;
    try {
      value = JSON.parse(text.value);
    } catch {
      return null;
    }
    if (!isRecord(value) || typeof value['result'] !== 'string') return null;
    return /^0x(?:[0-9a-fA-F]{2})*$/u.test(value['result']) ? value['result'] : null;
  } finally {
    clearTimeout(timeout);
  }
}

export function createEthCall(options: EthCallOptions = {}): NonNullable<ResolverIO['ethCall']> {
  const endpoints = options.endpoints ?? ETHEREUM_RPC_ENDPOINTS;
  const transport: RpcTransport = {
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? ETHEREUM_RPC_TIMEOUT_MS,
    maxResponseBytes: options.maxResponseBytes ?? ETHEREUM_RPC_MAX_RESPONSE_BYTES,
  };

  return async (to, data) => {
    try {
      for (const endpoint of endpoints) {
        if (new URL(endpoint).protocol !== 'https:') continue;
        const value = await callEndpoint(endpoint, to, data, transport);
        if (value !== null) return ok(value);
      }
      return err('unreachable');
    } catch {
      return err('unreachable');
    }
  };
}
