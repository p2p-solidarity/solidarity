/**
 * Sakura messaging client — mirrors Swift MessageService.shared.
 *
 * Wire format is snake_case JSON (preserved by @solidarity/shared/types/sakura).
 * Transport is plain fetch (https with HSTS); for cert pinning + per-message
 * encryption see crypto.ts (next iteration).
 *
 * The relay URL is provided via EXPO_PUBLIC_SAKURA_API_URL (see .env.example).
 */
import {
  ackRequestSchema,
  inboxMessageSchema,
  sealResponseSchema,
  sendRequestSchema,
  syncResponseSchema,
  type AckRequest,
  type InboxMessage,
  type SealResponse,
  type SendRequest,
  type SyncResponse,
} from '@solidarity/shared';

const baseUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_SAKURA_API_URL;
  if (!url) throw new Error('EXPO_PUBLIC_SAKURA_API_URL not set');
  return url.replace(/\/+$/u, '');
};

async function postJson<TIn, TOut>(
  path: string,
  body: TIn,
  parse: (raw: unknown) => TOut
): Promise<TOut> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`sakura POST ${path} → HTTP ${String(res.status)}`);
  }
  return parse((await res.json()) as unknown);
}

async function getJson<TOut>(
  path: string,
  parse: (raw: unknown) => TOut
): Promise<TOut> {
  const res = await fetch(`${baseUrl()}${path}`);
  if (!res.ok) {
    throw new Error(`sakura GET ${path} → HTTP ${String(res.status)}`);
  }
  return parse((await res.json()) as unknown);
}

/** Exchange a device token for a sealed route — equivalent of MessageService.sealToken. */
export async function sealToken(deviceToken: string): Promise<SealResponse> {
  return postJson('/v1/seal', { device_token: deviceToken }, (r) =>
    sealResponseSchema.parse(r)
  );
}

export async function sendMessage(req: SendRequest): Promise<void> {
  await postJson('/v1/send', sendRequestSchema.parse(req), () => undefined);
}

export async function syncInbox(pubkey: string): Promise<readonly InboxMessage[]> {
  const out = await getJson(`/v1/inbox?pubkey=${encodeURIComponent(pubkey)}`, (r) =>
    syncResponseSchema.parse(r)
  );
  return out.messages.map((m) => inboxMessageSchema.parse(m));
}

export async function ackMessages(req: AckRequest): Promise<void> {
  await postJson('/v1/ack', ackRequestSchema.parse(req), () => undefined);
}

export type { SealResponse, SendRequest, SyncResponse, InboxMessage, AckRequest };
