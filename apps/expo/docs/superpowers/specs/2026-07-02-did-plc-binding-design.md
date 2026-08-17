# did:plc Binding — Design (DRAFT)

> **SUPERSEDED (2026-07-03)** by `docs/ref/01-spec-verified-page.md` + `02-user-stories.md` + `03-app-web-mechanisms.md` — the refined 1.3.3 spec set (verified page, badge library, Pear lane). Kept for the rejected-alternatives rationale (alsoKnownAs, post-proof) and the offline CAR-proof notes.

Status: **superseded** · Date: 2026-07-02 · Owner: `apps/expo`
Open decisions are marked ⚠️ OPEN — resolve before writing the implementation plan.

## 0. Context

Positioning: solidarity = the **verified-human handshake** — bind at:// / Nostr /
(optional) passport personhood under a self-custodied did:key root, bidirectionally
verified. The Nostr side already has a sandbox prototype (`src/dag/*`,
`docs/dev-sandbox-identity-graph.md` §3.4). This spec adds the atproto (did:plc)
side and sequences toward a public verifiable profile page ("verifiable linktree",
phase 3).

DID-first test (sandbox doc §1): *"the user's did:key gains the ability to prove it
currently controls an at:// identity, publicly verifiable"* → Build.

## 1. Binding artifact — one record, both directions

A custom lexicon record in the user's own atproto repo,
collection `gg.solidarity.binding`, rkey `self`:

```json
{
  "$type": "gg.solidarity.binding",
  "subject": "did:key:z…",
  "sig": "<base64url P-256 sig by did:key over canonical(did:plc ‖ did:key ‖ createdAt)>",
  "createdAt": "<ISO8601>"
}
```

- **atproto → did:key**: the record's existence in the repo is the proof — repo
  commits are signed by the atproto signing key resolvable from the did:plc document.
- **did:key → atproto**: the embedded `sig`.
- **Revocation for free**: the user deleting the record (from any atproto client)
  revokes the binding.

Rejected alternatives:
- **`alsoKnownAs` in the PLC doc** — editing requires a PLC rotation key;
  bsky.social custodial accounts don't hold theirs. Not viable for mainstream users.
- **Post-based proof (Keybase style)** — deletable, unstructured, feed clutter.

## 2. Verification paths

1. **Online**: unauthenticated XRPC `com.atproto.repo.getRecord` + did:plc
   resolution (cached — plc.directory is rate-limited) → verify embedded sig and
   that the repo owner matches the did:plc.
2. **Offline**: `com.atproto.sync.getRecord` returns a CAR with a merkle inclusion
   proof + signed commit. Bundle `{record, proof, plc-doc snapshot, ts}` = an
   offline-presentable binding credential. Honest boundary built in: proves control
   *as of T*, not forever.
3. **Browser (phase 3)**: path (1) in client-side JS on the public profile page —
   the zero-install verifier surface.

## 3. Write path — atproto OAuth

- atproto OAuth (app-passwords are legacy). Cost: one static `client-metadata.json`
  hosted at an https URL (the URL *is* the client_id). A single static file — does
  not break the zero-infrastructure story.
- Expo: `@atproto/oauth-client` with universal-link redirect; sandbox iteration can
  use the loopback dev client_id.

## 4. Local representation

A confirmed binding is wrapped as a **self-issued SD-JWT VC** into the existing
credential store — no new identity primitive; it rides the existing
present/exchange UI. Signing the binding statement goes through Face ID
(security rule: sign ⇒ biometric).

## 5. Placement ⚠️ OPEN (default: sandbox + explicit exception)

New Lab under the dev sandbox ("atproto Bridge Lab"). Tension: sandbox rules forbid
linking sandbox keys to the production DID, but a binding is *meaningful only if
signed by the production did:key*. Default resolution, pending approval:

- amend dev-sandbox doc §2 with a narrowly-scoped exception: the atproto Lab may
  request production did:key signatures, each behind an explicit Face ID prompt;
- everything stays behind `developerMode` until §11 graduation.

Rejected for now: shipping straight to the public surface before OAuth + lexicon
are proven end-to-end.

## 6. Sequencing

- **Phase 1**: did:plc resolution (+cache), OAuth login, write/verify the binding
  record, Lab UI.
- **Phase 2**: align the Nostr prototype — same binding schema as a Nostr event
  (dedicated kind), upgrade from dev-key to a did:key-bound identity.
- **Phase 3**: public profile page ("verifiable linktree") rendering these records.
  Riding three protocol-native verification idioms for free:
  NIP-05 (`/.well-known/nostr.json`), Mastodon `rel=me` green checks, Bluesky
  domain handles via `/.well-known/atproto-did`.
  ⚠️ OPEN: page source of truth — recommended: the user's own networks (PDS record
  + Nostr events) with solidarity.gg storing only a handle→did:key registry +
  cache ("we host a lens, not your data").

## 7. Not doing (this cycle)

- No PLC operations / `alsoKnownAs` writes.
- No Bluesky labeler or `app.bsky.graph.verification` Trusted Verifier — that's the
  distribution track, separate spec.
- No nullifier/uniqueness (issuance-time dedup is a later, separate decision).
- No Mastodon / Farcaster / Lens integration.

## 8. Positioning-doc amendments (from the 2026-07-02 review)

1. Fix the "alsoKnownAs = zero-integration binding surface" claim: true for Nostr
   kind-0 only. On Bluesky the realistic visible surfaces are a **labeler** (short
   term) and **Trusted Verifier** via `app.bsky.graph.verification` (mid term).
2. Add **Keybase** as precedent + differentiation (self-custody, personhood layer,
   protocol-native records instead of platform posts; it died by acquisition, not
   lack of demand).
3. Add **key loss/recovery** to risks: did:key cannot rotate — mitigations: iCloud
   Keychain sync today, re-issue/re-bind flow, KERI-style pre-rotation later.
4. Add **binding freshness** to the honest boundaries: offline presentation proves
   control as-of-binding-time; define TTL + re-attestation policy.
5. Agentic-web hook (one line): a human did:key issues a delegation credential to
   an agent key — "this agent is operated by this verified human".
6. Date-stamp all ecosystem numbers (as of 2026-06).

## References

- linkat.blue — link-in-bio as `blue.linkat.board` records (prior art for the
  record-based approach on atproto)
- did:plc spec — https://web.plc.directory/spec/v0.1/did-plc
- atproto OAuth — https://atproto.com/specs/oauth
- NIP-05 — https://github.com/nostr-protocol/nips/blob/master/05.md
- Mastodon rel=me verification — https://docs.joinmastodon.org/user/profile/#verification
