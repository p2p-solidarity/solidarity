/**
 * Webhook manager — TS port of solidarity/Services/Utils/WebhookManager.swift.
 *
 * The Swift original is a simulator-only stub for Apple Wallet pass
 * updates (every send is a `print(...)`). The Expo port keeps the same
 * surface but actually performs the outbound POST. Configs live in MMKV
 * under `webhook:` so adding/removing a hook persists across launches.
 *
 * Signature header: `X-Solidarity-Signature` carries the lowercase hex of
 * HMAC-SHA-256(secret, body). Mirrors the Apple Wallet pass-update
 * convention (lowercase hex digest) and matches what the Swift planner
 * documented for "what an outbound webhook will look like" — there is no
 * pre-existing header name in Swift to mirror verbatim (the Swift impl
 * never actually sends), so we pick the canonical name and the matching
 * docs will follow when the Wallet flow ships.
 *
 * Dispatch is fire-and-forget: errors are logged via the event
 * repository (warn level) so they're inspectable but never block the
 * caller. Each config's `events` list filters which event names route
 * through it; an empty list means "subscribe to all events".
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { record as recordEvent } from '@/feedback/eventRepository';
import { getMmkv } from '@/storage/mmkv';

import { bytesToHex, utf8ToBytes } from '@solidarity/shared';

export interface WebhookConfig {
  readonly id: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly secret?: string;
}

const KEY_PREFIX = 'webhook:';
export const WEBHOOK_SIGNATURE_HEADER = 'X-Solidarity-Signature';

function storageKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

function readConfig(id: string): WebhookConfig | null {
  try {
    const raw = getMmkv().getString(storageKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as WebhookConfig;
  } catch {
    return null;
  }
}

function writeConfig(config: WebhookConfig): void {
  getMmkv().set(storageKey(config.id), JSON.stringify(config));
}

export function listWebhooks(): readonly WebhookConfig[] {
  const out: WebhookConfig[] = [];
  for (const key of getMmkv().getAllKeys()) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const id = key.slice(KEY_PREFIX.length);
    const cfg = readConfig(id);
    if (cfg) out.push(cfg);
  }
  return out;
}

export function addWebhook(config: WebhookConfig): void {
  writeConfig(config);
}

export function removeWebhook(id: string): void {
  try {
    getMmkv().remove(storageKey(id));
  } catch {
    // No-op — the entry's already gone from the user's perspective.
  }
}

function sign(secret: string, body: string): string {
  const mac = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(body));
  return bytesToHex(mac);
}

function shouldDispatch(config: WebhookConfig, event: string): boolean {
  return config.events.length === 0 || config.events.includes(event);
}

export async function dispatch(event: string, payload: unknown): Promise<void> {
  const body = JSON.stringify({ event, payload, at: new Date().toISOString() });
  for (const config of listWebhooks()) {
    if (!shouldDispatch(config, event)) continue;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.secret) {
      headers[WEBHOOK_SIGNATURE_HEADER] = sign(config.secret, body);
    }
    try {
      await fetch(config.url, { method: 'POST', headers, body });
    } catch (err) {
      recordEvent('webhook', {
        kind: 'dispatch-failed',
        configId: config.id,
        event,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
