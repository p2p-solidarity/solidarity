/**
 * BadgeState — the single state machine shared by every badge verifier
 * (01-spec-verified-page.md §7), single source of truth for `packages/
 * shared`, apps/expo's UI, and the future web viewer.
 *
 *   verified — live check passed right now (both directions of a
 *              bidirectional binding hold, or the relevant single-sided
 *              proof is valid and unexpired).
 *   stale    — was possibly verified before; the current check could not
 *              run to completion (unreachable network/relay/endpoint,
 *              expired-but-not-yet-confirmed-revoked credential). NOT a
 *              verdict about the binding itself — only that "we can't
 *              confirm right now".
 *   revoked  — an explicit revocation signal was observed (NXDOMAIN,
 *              record removed, key superseded).
 *   declared — structurally a one-way/unconfirmed claim: either the
 *              platform has no reverse-binding mechanism at all (e.g.
 *              LinkedIn), or a reverse-binding mechanism exists but this
 *              specific claim does not (yet) reciprocate. Never rendered
 *              with a green check (01-spec §7 / 03-spec §3: "單向宣稱不畫
 *              綠勾是最重要的一條" — the single-direction-no-green-check
 *              rule).
 */
export type BadgeState = 'verified' | 'stale' | 'revoked' | 'declared';
