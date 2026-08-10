import { classifyWebSignScan } from '@/websign/transport';

/**
 * Developer-only QR and deep-link boundaries.
 *
 * These inputs start protocol-level ceremonies rather than the ordinary
 * visitor/card scan experience. Keep the classifier framework-free so the
 * scanner and app-level deep-link handler agree on the same boundary.
 */
const OIDC_PROTOCOLS = new Set([
  'openid4vp:',
  'openid-vp:',
  'openid-credential-offer:',
]);

const DEVELOPER_ONLY_DEEP_LINK_KINDS = new Set([
  'oidc',
  'credentialOffer',
  'webSign',
]);

/** True when a QR payload begins a developer-only protocol ceremony. */
export function isDeveloperOnlyScanPayload(payload: string): boolean {
  let url: URL;
  try {
    url = new URL(payload.trim());
  } catch {
    return false;
  }

  if (OIDC_PROTOCOLS.has(url.protocol)) return true;

  return classifyWebSignScan(payload) !== null;
}

/** True when a parsed app deep link requires Developer Options. */
export function isDeveloperOnlyDeepLinkKind(kind: string): boolean {
  return DEVELOPER_ONLY_DEEP_LINK_KINDS.has(kind);
}
