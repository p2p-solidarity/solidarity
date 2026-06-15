/**
 * Sakura messaging client — mirrors Swift MessageService.shared.
 *
 * Two layers:
 *   - HTTP layer: stateless POST/GET against the Sakura relay
 *     (EXPO_PUBLIC_SAKURA_API_URL). Wire shapes are snake_case per
 *     @solidarity/shared/types/sakura.
 *   - Crypto layer: sealBlob (X25519 ECIES + AES-GCM) wraps every payload
 *     before send; openBlob unwraps every inbox message with the holder's
 *     long-term recipient privkey.
 *
 * Sign step: every outbound SendRequest is ECDSA-signed with the sender's
 * P-256 signing key (see signSendRequest). The relay verifies the
 * signature against sender_pubkey before forwarding; the recipient
 * verifies again before opening the blob.
 */
import {
  ackRequestSchema,
  base64Decode,
  base64Encode,
  bytesToUtf8,
  inboxMessageSchema,
  openBlob,
  sealBlob,
  sealResponseSchema,
  sendRequestSchema,
  syncResponseSchema,
  utf8ToBytes,
  type AckRequest,
  type InboxMessage,
  type SealResponse,
  type SendRequest,
  type SyncResponse,
} from '@solidarity/shared';

const baseUrl = (): string => {
  const url = process.env['EXPO_PUBLIC_SAKURA_API_URL'];
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

/** Exchange an APNs/FCM device token for a sealed (blind) route. */
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

// ── Crypto-wrapped send/recv ─────────────────────────────────────────────────

export interface OutgoingMessage {
  /** Recipient's X25519 public key (base64). */
  readonly recipientPubKey: string;
  /** Recipient's sealed route from a prior `sealToken` exchange. */
  readonly recipientSealedRoute: string;
  /** Our sending key (signature side, P-256 ECDSA). */
  readonly senderSignPubKey: string;
  /** Plaintext payload bytes (will be JSON-stringified and sealed). */
  readonly payload: unknown;
}

/**
 * Build a `SendRequest`: seals the payload with the recipient's X25519
 * pubkey, then leaves `sender_sig` to the caller (which adds the ECDSA
 * signature using the keychain bridge).
 */
export function buildSealedSendRequest(
  msg: OutgoingMessage,
  unsignedSenderSig = ''
): SendRequest {
  const plaintext = utf8ToBytes(JSON.stringify(msg.payload));
  const blob = sealBlob(base64Decode(msg.recipientPubKey), plaintext);
  return {
    recipient_pubkey: msg.recipientPubKey,
    blob: base64Encode(blob),
    sealed_route: msg.recipientSealedRoute,
    sender_pubkey: msg.senderSignPubKey,
    sender_sig: unsignedSenderSig,
  };
}

/** Open a received inbox message with our long-term X25519 recipient privkey. */
export function openInboxMessage<T = unknown>(
  privKey: Uint8Array,
  message: InboxMessage
): T {
  const blob = base64Decode(message.blob);
  const plaintext = openBlob(privKey, blob);
  return JSON.parse(bytesToUtf8(plaintext)) as T;
}

export type {
  SealResponse,
  SendRequest,
  SyncResponse,
  InboxMessage,
  AckRequest,
};
