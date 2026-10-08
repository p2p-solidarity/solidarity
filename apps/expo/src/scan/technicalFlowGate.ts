/**
 * Developer-only QR and deep-link boundaries.
 *
 * These inputs start protocol-level ceremonies rather than the ordinary
 * visitor/card scan experience. Keep the classifier framework-free so the
 * scanner and app-level deep-link handler agree on the same boundary.
 *
 * webSign is deliberately NOT gated here (07-plan P3, 2026-09-09): the
 * App↔Web signing request is part of the Page flow for every user. Its
 * security boundary is the consent screen (`app/websign/review.tsx` —
 * per-field diff against what the website could see, then Face ID), not a
 * developer toggle; the scanner still recognises the request only in its
 * explicit wrapped forms (`websign/transport.ts`).
 */
const OIDC_PROTOCOLS = new Set([
  'openid4vp:',
  'openid-vp:',
  'openid-credential-offer:',
]);

const DEVELOPER_ONLY_DEEP_LINK_KINDS = new Set(['oidc', 'credentialOffer']);

/** True when a QR payload begins a developer-only protocol ceremony. */
export function isDeveloperOnlyScanPayload(payload: string): boolean {
  let url: URL;
  try {
    url = new URL(payload.trim());
  } catch {
    return false;
  }

  return OIDC_PROTOCOLS.has(url.protocol);
}

/** True when a parsed app deep link requires Developer Options. */
export function isDeveloperOnlyDeepLinkKind(kind: string): boolean {
  return DEVELOPER_ONLY_DEEP_LINK_KINDS.has(kind);
}
