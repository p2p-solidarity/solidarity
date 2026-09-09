> **HARD SCOPE — read this line before anything else.** Every file, screen, store, Nitro module API, and dependency spawned by this document lives behind `usePreferences((s) => s.developerMode) === true`. The v1.3.1 public surface — `(tabs)/me`, `(tabs)/people`, `(tabs)/share`, `settings/dids.tsx` public block, the seven onboarding steps, and the existing share/scan flows — is frozen by Swift parity and **MUST NOT** change as a side-effect of any sandbox work. If a sandbox capability wants public surface, it goes through the §11 graduation criteria, not a back-door PR.

# Dev Sandbox — DID-first Extension Playground

Status: design draft · Owner: `apps/expo` · Anchor screen: `app/settings/developer.tsx` (sandbox flattened in; no separate route)

## 1. First principle: DID is the root, everything else is what a DID *gains the ability to do*

Solidarity is a sovereign card-holder. The card-holder is the user's **DID** — every other primitive (VC, contact, group, exchange, presentation, attendance, message) is something that DID *signs*, *holds*, *issues*, *receives*, or *links to*. There is no second identity primitive. There is no "social account". There is no "Solidarity user id".

This sandbox is the place we extend what the DID can do **without inventing new identity primitives**. Every module below is an answer to one question:

> *What can the user's existing active DID do that the public surface doesn't currently expose?*

If a proposal cannot be phrased that way, it is a fusion-frankenstein. Kill it. Examples:

| Proposal | DID-first? | Verdict |
|----------|-----------|---------|
| DAG of signed events, each `author = activeDID` | ✅ DID gains ability to sign causally-linked events instead of one-off blobs | Build |
| BLE+WebRTC peer-to-peer of any signed payload | ✅ DID gains ability to exchange arbitrary signed payloads with another DID, no backend | Build |
| Nostr projection: same key, Nostr-shaped envelope | ✅ DID gains ability to ride existing relay infra | Build |
| Common-friends via DAG diff | ✅ DID gains ability to discover shared neighbours from its own state | Build |
| New "Solidarity account" with email + password | ❌ New identity primitive competing with DID | Kill |
| Real-time chat product | ❌ Not a DID extension — a separate product (Sakura already exists) | Kill |
| DID-Calendly (availability claims) | ✅ DID can sign availability VCs | Build *later*, not first cycle |
| Removing passport, replacing with phone OTP | ❌ Removes anti-sybil ground truth | Kill |

## 2. Range of motion

**In sandbox** (this doc + its child files):
- Lab sections inlined under `app/settings/developer.tsx`, plus any `app/dev/**` child screens we add later.
- New stores under `src/dag/**` and `src/sandbox/**`.
- New Nitro module APIs that don't change existing module surfaces (additive only).
- A **separate** secp256k1 dev-key under MMKV namespace `dev:secp256k1:v1` (see §8).
- Read-only projections of existing stores (`@/credentials/store`, `@/contacts/repository`, `@/groups/store`, `@/cards/cardManager`, `@/identity/coordinator`).

**Never in sandbox**:
- Mutations of public stores. Sandbox reads them, never writes them.
- Changes to `app/(tabs)/**`, `app/onboarding/**`, `app/settings/dids.tsx`'s top block, or any Swift parity surface.
- Replacement of the active Spruce DID with secp256k1. The dev-key is *additional*, never substitutive.
- Network calls to any backend other than Nostr relays explicitly entered by the developer. **No default relay list.** No telemetry. No analytics.
- Publishing the dev secp256k1 pubkey on the public DID document (would link the Nostr identity to the production DID and defeat the separation).

## 3. The five Labs

Each Lab is one section in `app/settings/developer.tsx` (flattened — no separate sandbox route). Doc order below follows the dependency chain (canvas → substrate → transport → bridge → application). **Iteration priority is the opposite**: §3.3 P2P Lab is the headline capability — the user-facing reason the sandbox exists. UWB-bump exchange (§3.3.1) is the polish layer that turns the existing radar matching into a tap-your-phones gesture indistinguishable from NFC. Build P2P first, then the substrate that gives it more interesting payloads to carry.

### 3.1 Identity Tree

**Question it answers**: "If my DID is the root, what does the tree of things rooted at it look like?"

**Implementation**: a read-only projection. Aggregates from existing stores into a tree:

```
ActiveDID (did:key:z…)
├── Cards I hold
│   └── (foreach VC in useCredentialStore) → leaf showing issuer + type + status
├── Contacts I've exchanged with
│   └── (foreach ContactEntity in src/contacts/repository) → leaf with their DID + last exchange ts
├── Groups I've joined
│   └── (foreach Group in src/groups/store) → leaf with group root + role
└── DAG events I've authored
    └── (foreach Node in src/dag/store where author === activeDID) — empty until §3.2 ships
```

**No new data.** Every leaf links back to the existing public screen for that entity (tap a card leaf → opens existing `/credentials/[id]`). The Tree is a *lens*, not a store.

**Anti-pattern to refuse**: do not add an "edit this card" button on the tree node. The tree is read-only by construction; mutations go through the existing public screens.

### 3.2 DAG Lab

**Question it answers**: "What can my DID sign if signatures can carry causal order, not just isolated blobs?"

**Schema** (canonical form, see §6):

```ts
interface DagNode {
  readonly id: string;               // sha256(canonical_json(envelope_without_id_and_sig))
  readonly author: string;           // dev secp256k1 pubkey, hex
  readonly parents: readonly string[]; // 0..N parent node ids; [] = root
  readonly kind: number;             // Nostr-compatible kind (see §6.2)
  readonly action: string;           // payload discriminator, e.g. "exchange" | "presented" | "attended" | "joined" | "revoked"
  readonly payload: Readonly<Record<string, unknown>>; // action-specific
  readonly created_at: number;       // unix seconds, NOT ms (Nostr compatibility)
  readonly sig: string;              // schnorr secp256k1 sig over id, hex
}
```

**Lab UI**:
- Local HEADs list (multiple HEADs = unmerged branches, this is normal in DAG land)
- "Append test node" button (creates `kind=30078`, `action="dev.test"`, `payload={ note: <input> }`, parents = current HEADs)
- "Replay state from DAG" — rebuild a projection from the full chain, prove determinism
- "Export DAG" / "Import DAG" — JSON file, round-trips through Files
- "Verify all signatures" — walks the chain, reports invalid sigs

**Storage**: MMKV under `dag:v1:nodes:<id>` (one node per key) plus `dag:v1:heads` (the HEAD set). Cap node payload at 4 KiB to keep MMKV reads fast. Larger payloads go through `expo-sqlite` (defer to §3.3 sync).

### 3.3 P2P Lab

**Question it answers**: "Can two DIDs exchange signed events without ever touching a backend?"

**Transport reality (audited 2026-05-25)**:

| Channel | Library | Status | Backend-less? | Offline-LAN? |
|---------|---------|--------|---------------|--------------|
| BLE L2CAP | `@solidarity/nitro-proximity` (workspace) | ✅ shipped, drives Share tab | ✅ | ✅ airplane + BT |
| WebRTC | `react-native-webrtc@124` | ⚠️ installed, `src/sakura/webrtc.ts` **all methods TODO**, falls back to Sakura HTTPS | ❌ today | ❌ today |
| Sakura HTTP relay | `src/sakura/client.ts` | ✅ shipped | ❌ centralized | ❌ |
| mDNS / Bonjour | none | ❌ missing | — | — |
| Wi-Fi Direct (Android) | none | ❌ missing | — | — |
| Nostr relay | none | ❌ missing | depends on relay | ❌ |

**Path forward** (this is what P2P Lab actually builds):

1. **BLE as the signaling channel** (already there). Two devices on Share tab discover each other via the existing proximity advertise/browse loop. Reuses `src/proximity/wire.ts` framing.
2. **WebRTC DataChannel for the data path**, with SDP exchanged over the BLE channel. No STUN/TURN needed for LAN-direct. For cross-NAT we'd need ICE servers — defer that to a later cycle, sandbox is LAN-first.
3. **Sync protocol on top of the DataChannel** — the user's spec from chat:
   - Step 1: exchange HEAD hash sets (small, one frame)
   - Step 2: each side replies with the subset of HEADs it doesn't have
   - Step 3: walk-back fetch — request nodes by id, peer streams `[id, …node body…]`
   - Step 4: verify signatures locally, merge into store, recompute HEADs

**This means `src/sakura/webrtc.ts` stops being a stub** — but as a sandbox-only consumer. The public Sakura relay path remains the production messaging channel.

**Three offline modes the Lab supports**:

| Mode | Internet | LAN | Bluetooth | Works? |
|------|----------|-----|-----------|--------|
| Same room, no Wi-Fi | ❌ | ❌ | ✅ | ✅ BLE-only path; small payloads only |
| Same Wi-Fi, no internet | ❌ | ✅ | ✅ | ✅ BLE signal → WebRTC LAN data |
| Remote, both online | ✅ | — | — | ⚠️ requires Nostr relay (§3.4), not BLE+WebRTC |
| Remote, no internet on one side | ❌ | — | — | ❌ impossible by physics |

**Lab UI**:
- "Generate handshake QR" — encodes `{ devPubkey, blePsm, bleAdvertisingName }` for the other phone to scan if BLE discovery fails
- "Scan peer handshake" — open camera, scan, jump-start BLE connection
- "ICE servers" text input — empty by default per §13.1; LAN-direct unless the developer pastes a STUN URL
- "Connect" / "Disconnect" — explicit lifecycle for debugging
- Live transport log (BLE state, WebRTC ICE state, frames in/out, bytes)
- "Sync now" — runs Steps 1-4 above on the active connection

### 3.3.1 UWB Bump Exchange — the NFC-tap-feel UX

**Question it answers**: "When two phones running Solidarity get physically close enough to touch, can the exchange happen *automatically*, with the same satisfying haptic-and-flash gesture as an NFC tap or Apple's NameDrop?"

**Current state (verified 2026-05-25)**:

| Piece | Exists where | Working? |
|-------|--------------|----------|
| BLE discovery + invite/accept lifecycle | `src/matching/session.ts`, `@solidarity/nitro-proximity` | ✅ ships in public Share tab |
| UWB distance ranging (CoreLocation / NearbyInteraction) | iOS: `solidarity/Services/Sharing/NearbyInteractionManager.swift` + `+Delegate.swift`; native bridge via Nitro `distanceUpdate` events | ✅ events flow |
| `UwbSpatialState` state machine type | `src/components/share/UwbStatusPill.tsx:10-15` | ✅ typed |
| State machine **driver** in TS | nowhere — `useMatchingSession.uwbSpatial` initialised to `{kind:'idle'}` and never mutated | ❌ **this is the gap** |
| Per-transition haptic | Swift: `ProximityManager+Discovery.swift:262` ("Fire haptic exactly once per state transition") | ⚠️ exists in Swift, not ported to Expo |
| Auto-invite on `confirmed` | nowhere | ❌ user still has to tap-to-connect |
| Visual "bump" splash | nowhere | ❌ |

**Per-platform driver split** (decided in §13.4):

| Device class | Proximity signal | Consent on `confirmed` |
|--------------|------------------|------------------------|
| iOS U1+ (iPhone 11+) / Android UWB-capable | UWB distance < 10 cm × 3 frames | auto-invite |
| iOS pre-U1 / Android without UWB | BLE RSSI > −50 dBm × 3 frames | 3-second auto-decline sheet, must accept |

Both branches feed the same `UwbSpatialState` machine. Only the driver that produces the `approaching` ticks and the `confirmed → exchanging` consent gate differ. Same-peer-twice in one session always shows the sheet (§13.5).

**Spec for the missing pieces**:

```
State machine driver (sandbox-only initially, lives in src/matching/uwbBumpDriver.ts):

  on Nitro distanceUpdate event for peer P:
    let d = event.distance  // meters
    let s = current uwbSpatial

    transition rules:
      s.kind === 'idle' && d > 0:
        → { kind: 'approaching', framesSeen: 1, requiredFrames: 3 }
        haptic: 'soft' (UIImpactFeedbackGenerator.soft)

      s.kind === 'approaching' && d < 0.10 (10cm):
        if s.framesSeen + 1 >= s.requiredFrames:
          → { kind: 'confirmed' }
          haptic: 'heavy' (UIImpactFeedbackGenerator.heavy)
          visual: full-screen white flash 200ms, fade out 400ms
          auto-action:
            - UWB branch + first-time peer + "Always confirm" off → invitePeer(P) automatically
            - RSSI branch OR same-peer-twice OR "Always confirm" on → present 3s auto-decline sheet
        else:
          → { kind: 'approaching', framesSeen: s.framesSeen + 1, requiredFrames: 3 }

      s.kind === 'approaching' && d > 0.30 (30cm):
        → { kind: 'idle' }  // user pulled away before confirming
        no haptic

      s.kind === 'confirmed' && sessionEstablished event for P:
        → { kind: 'exchanging' }
        no haptic (already fired on confirmed)

      s.kind === 'exchanging' && dataReceived event for P:
        → { kind: 'cooldown' }
        haptic: 'success' (UINotificationFeedbackGenerator.success)
        timer: after 2s → { kind: 'idle' }
```

**Why the framesSeen counter**: UWB distance is noisy (NearbyInteraction can spike to <5cm for a frame, then back to 80cm). Requiring 3 consecutive close frames before firing the bump avoids "ghost taps" when phones are merely waved near each other.

**Why auto-invite only when both advertising**: if only one side is advertising, the bump is ambiguous — who initiated? Requiring both to be in "Start Matching" mode means both consented to exchange before getting close. Mirrors the Swift logic.

**Cooldown reason**: prevents the bump from re-firing if users keep their phones in contact for several seconds after the exchange. Without cooldown, the state machine would loop confirmed → exchanging → confirmed → … and produce a haptic storm.

**Bump visual**: a top-layer `Pressable`-blocking white view fading in/out over the radar. Same component will eventually graduate to the public Share tab to replace the current tap-to-connect flow.

**Sandbox vs. public**: the bump driver lives in `src/matching/uwbBumpDriver.ts` and is **only registered as a listener when `usePreferences.developerMode === true`**. The existing public Share tab continues to use the manual tap-to-connect flow until the bump graduates (per §11). During sandbox testing the bump runs *in parallel* with the manual flow — both produce a successful exchange — so the public surface is not affected.

**Lab UI**:
- "Enable bump driver" toggle — registers/unregisters the distanceUpdate listener
- Live state-machine view (current state + framesSeen counter + last 10 transitions log)
- "Test bump (simulate)" — fakes a distance progression so QA can verify haptics + visual without two phones
- "Force cooldown" / "Force idle" — escape hatches

### 3.4 Nostr Bridge Lab

**Question it answers**: "Can my DID ride the Nostr relay ecosystem without being a Nostr account?"

**Key binding** (this is the load-bearing part):

- Production identity stays Spruce / ed25519 / `did:key:zUC7…`. **Not touched.**
- Sandbox derives a separate secp256k1 keypair, stored under MMKV `dev:secp256k1:v1`. The Nostr pubkey = hex(x-only public key) of this key. See §8 for derivation.
- This secp256k1 key signs DAG nodes (Schnorr BIP-340) and Nostr events. Same key, two envelopes.
- **No `KeyAttestation` VC links the secp256k1 pubkey to the production DID.** That would publicly assert "this Nostr identity is me", which defeats the sandbox isolation. If a developer wants attestation later, they do it explicitly via a sandbox-export action.

**Lab UI**:
- Show derived secp256k1 pubkey + npub form
- Relay URL input — empty by default per §13.2; helper text below names two public options and the privacy cost
- "Publish HEAD" — wraps the current DAG HEAD as `kind=30078` (Application-specific Data, NIP-78) replaceable event, publishes to entered relay
- "Subscribe" — `REQ` for events with `["d", "solidarity-dag-v1"]` from any pubkey, lists incoming events
- "Round-trip test" — publish, subscribe, verify same event comes back, measure latency
- Last-used relay is **not** persisted across app restarts (per §13.2)

**Why kind 30078 specifically**:
- NIP-78 replaceable event range (30000-39999) means we can publish a single "current HEAD" event per `d` tag and let it replace older ones — exactly the semantics of "this is my latest state".
- `["d", "solidarity-dag-v1"]` tag namespaces our usage so we don't collide with other NIP-78 consumers.
- Full DAG nodes ride as `kind=1` reposts of NIP-78 content, with `["e", parent_id, "", "reply"]` for parent links. (Nostr `e` tag *is* our `parents`.)

**Envelope mapping** (canonical DAG ↔ Nostr, see §6):

```
DagNode                        Nostr event
─────────                      ─────────────
id              <—same—>       id
author          <—same—>       pubkey
created_at      <—same—>       created_at
kind            <—same—>       kind
parents         <—projects—>   tags: [["e", parent_id, "", "reply"], …]
action          <—projects—>   tags: [["a", "solidarity-action", action]]
payload         <—JSON—>       content (NIP-44 encrypted if recipient pubkey set; else plain canonical JSON)
sig             <—same—>       sig
```

A reader holding both protocols can parse the same bytes either way. A pure Nostr client sees a valid event with extra tags it ignores. A Solidarity reader unpacks the DAG semantics.

### 3.5 Common Friends (DAG diff, no PSI)

**Question it answers**: "Which DIDs has my DID exchanged with that this peer's DID has also exchanged with?"

**Implementation**: after a P2P sync completes (§3.3), both devices hold each other's full set of `action="exchange"` DAG nodes. Intersect on the `payload.peer_did` field. Done. No private set intersection cryptography needed.

**Privacy**: sync only transmits nodes the requesting side asked for by id. The requesting side learns nothing about exchange nodes it didn't already know existed via HEAD sharing. The HEAD set itself leaks a node count but not the content (HEADs are opaque hashes). This is materially stronger than the current Swift `SocialGraphIntersectionService.swift:31-36` which hashes `name|nonce` — names are low-entropy and the hash leaks ordering.

**Migration**: the Swift `SocialGraphIntersectionService` is **not ported**. The Expo replacement is the DAG diff. Document this in the eventual graduation PR so anyone porting from Swift knows to drop the PSI service.

**Lab UI**:
- "After-sync intersect" button (enabled only when a P2P sync has completed with a peer)
- Lists intersecting DIDs with: their DID, when each side first met them, count of shared events

## 4. What we are NOT building this cycle

| Item | Why deferred |
|------|--------------|
| DID-Calendly remote scheduling | Calendly's value is remote scheduling; P2P-only collapses to proximity-only; remote needs Nostr relay + NIP-44 stranger discovery — defer to second cycle |
| Real PSI (DH-PSI, Bloom+ECDH) | DAG diff makes it unnecessary for common-friends; if a future use case actually needs it, reopen the question |
| 18+ ZK age proof demo | User explicitly removed from priorities |
| Multi-device DID sync via DAG | Conflicts with iCloud / Drive backup model in `src/backup/`; needs its own design |
| Public Nostr broadcasting of all DAG nodes | Privacy: would expose social graph publicly; sandbox only publishes to relays the dev explicitly entered |
| ICE / STUN / TURN for cross-NAT WebRTC | Sandbox is LAN-first; cross-NAT is a Nostr-bridge problem, not a WebRTC problem |
| C++/Rust crypto port | Defer to performance pass — `@noble/curves` in JS is fine for sandbox-volume signing |
| Replacing public Spruce DID with secp256k1 | Hard scope: public DID is frozen |

## 5. Transport plan

### 5.1 Make BLE L2CAP carry DAG sync frames

Reuse `src/proximity/wire.ts` framing (2-byte big-endian length prefix, 64 KiB max per frame). Add a `frameKind` byte at offset 0 of the payload to multiplex:

```
[uint16-be length] [uint8 frameKind] [frameKind-specific body]
```

`frameKind` values reserved for sandbox:
- `0x10` — `HEADS` — body = concat of 32-byte HEAD ids
- `0x11` — `WANT` — body = concat of 32-byte node ids the sender wants
- `0x12` — `NODE` — body = canonical JSON of one DagNode
- `0x13` — `WEBRTC_SDP` — body = SDP for the upgrade-to-WebRTC handshake
- `0x14` — `WEBRTC_ICE` — body = single ICE candidate

Frame kinds above `0x80` reserved for the existing card-exchange protocol; sandbox stays in the `0x10`-`0x7F` window.

**Implementation**: add `src/dag/wire.ts` that imports `frameMessage` / `drainFrames` from `src/proximity/wire.ts` and layers the frameKind multiplex on top. No changes to `proximity/wire.ts` itself.

### 5.2 Wire WebRTC for real

Replace the all-TODO bodies in `src/sakura/webrtc.ts` only if we move it to `src/dag/webrtc.ts` first. Reason: sakura's stub references a relay-fallback semantic that's wrong for the LAN-direct sandbox case. Leave `src/sakura/webrtc.ts` untouched; build a *new* `src/dag/webrtc.ts` that:

- Calls `new RTCPeerConnection({ iceServers: [] })` — empty iceServers = LAN-direct only, no fallback
- Creates one DataChannel named `solidarity-dag-v1`
- Sends SDP / ICE candidates **over the BLE channel** using `frameKind=0x13/0x14`
- On DataChannel `open`, streams `HEADS` / `WANT` / `NODE` frames

This isolates the sandbox WebRTC from the production Sakura relay path completely.

### 5.3 Nostr client — pick one, isolate behind an adapter

Recommended: `nostr-tools` (most mature, TypeScript-native). Install only when 3.4 is being built; not a day-1 dependency. Wrap behind `src/dag/nostrAdapter.ts` so the rest of the sandbox never imports `nostr-tools` directly — if we ever swap implementations, only the adapter changes.

## 6. DAG schema details

### 6.1 Canonical form for `id` computation

```ts
function canonicalize(node: Omit<DagNode, 'id' | 'sig'>): string {
  // Sort object keys recursively, ASCII-sort. No trailing newlines, no whitespace.
  // Numbers: JSON.stringify default (no leading +, no .0 suffix).
  // Strings: utf-8, JSON-escape only the strictly-required chars.
}

const id = sha256_hex(utf8(canonicalize(node)));
```

Spec: same as Nostr NIP-01 serialization (`[0, pubkey, created_at, kind, tags, content]` → sha256). We adopt NIP-01's algorithm exactly so the `id` field is identical across both envelopes.

### 6.2 Kind allocation

| Kind | Purpose | NIP-78 replaceable? |
|------|---------|---------------------|
| 30078 | DAG HEAD pointer (latest state) | Yes — `d` tag = `solidarity-dag-v1` |
| 1063 | Single DAG node (immutable, by id) | No (regular event) |
| 1064 | DAG sync request (npub broadcast) | No |

We squat on existing Nostr kinds where possible to avoid kind-number wars. 1063 is NIP-94 (file metadata) — close enough semantically (immutable content hash) and unlikely to collide in practice. If collision becomes real, allocate from the 30000-39999 NIP-78 range with a `d` tag.

### 6.3 Conflict resolution rule

DAGs allow forks. The merge policy:

- **Per-author, per-`(action, payload.key)` pair: last-writer-wins by `created_at`, with `id` as tiebreaker (lexicographic).**
- Where `payload.key` is action-specific:
  - `action="exchange"` → key = `payload.peer_did`
  - `action="presented"` → key = `payload.verifier_did + payload.vc_id`
  - `action="attended"` → key = `payload.event_id`
  - `action="joined"` → key = `payload.group_id`
  - `action="revoked"` → key = `payload.revokes_id` (revocations are themselves LWW, but only apply forward in time)

This is a CRDT-equivalent rule (LWW-register per key). It's not full CRDT semantics (no causal-consistency guarantee across keys) but it's enough for the sandbox's use cases and trivially deterministic.

### 6.4 Revocation

Append-only stores need a revocation gesture or events become unkillable. Rule:

- Author X can revoke their own node N by signing a `kind=1063, action="revoked", payload={revokes_id: N.id}` node. Mergers honour it: N stays in the store (provenance preserved) but does not appear in projections.
- Author X cannot revoke another author's node. Group operators can revoke *membership* (`action="joined"`) but not the underlying personal nodes.

## 7. Sandbox-only secp256k1 dev-key derivation

Generation:

```ts
import { schnorr } from '@noble/curves/secp256k1';
import { randomBytes } from '@noble/hashes/utils';

const privkey = randomBytes(32);        // generated once, persisted
const pubkey  = schnorr.getPublicKey(privkey); // 32 bytes, x-only
```

Storage: MMKV instance with id `dev:secp256k1:v1`, key `privkey` (bytes), guarded by the existing biometric gate when `usePreferences.biometricPolicy.exportGraph === true` (reuse the gate, do not invent a new policy flag).

Lifecycle:
- Generated on first sandbox use, never rotated automatically.
- "Reset sandbox identity" button in DAG Lab wipes the key + clears all DAG nodes. Hard reset, no soft alternatives.
- **Never exported via the production backup flow.** Sandbox state stays on-device. If a developer wants cross-device sandbox sync, they explicitly export the key as JSON from the sandbox UI.

Naming convention to make this visible everywhere:
- TS: `getDevSecpKey()` (never `getActiveKey()`)
- MMKV: `dev:secp256k1:v1` (never `keychain:active`)
- UI label: "Sandbox key" (never "your key")

## 8. Nitro module surface

No new Nitro modules in cycle 1. Reuse:

- `@solidarity/nitro-proximity` — already does BLE L2CAP, accept new frameKinds via the existing data path. Native code unchanged; TS-side multiplexer added in `src/dag/wire.ts`.
- `react-native-webrtc` — existing dependency, currently unused. Direct import from `src/dag/webrtc.ts`. **Do not** introduce a Nitro wrapper around it yet; pay that cost only if React-side perf is measurably bad.

Future (out of scope for this doc, listed for orientation):
- `@solidarity/nitro-schnorr` — if `@noble/curves` JS becomes a bottleneck (>1000 signatures/sec needed). Implementation: Rust FFI via `secp256k1` crate, exposes `sign(privkey, msg) → sig` and `verify(pubkey, msg, sig) → bool`. **Do not start until profiling proves the need.**
- `@solidarity/nitro-webrtc-lan` — only if `react-native-webrtc` 's Android bindings turn out to be unstable in the no-internet scenario. Out of scope today.

## 9. UX integration map

```
Settings hub  (app/settings/index.tsx)               [public, frozen]
└── Developer  (app/settings/developer.tsx)          [toggle + inlined Lab sections, this doc]
    ├── Identity Tree  (route TBD: app/dev/identity-tree.tsx)
    ├── DAG Lab        (route TBD: app/dev/dag.tsx)
    ├── P2P Lab        (route TBD: app/dev/p2p.tsx)
    ├── Nostr Bridge   (route TBD: app/dev/nostr.tsx)
    └── Common Friends (route TBD: app/dev/common-friends.tsx)
```

Each Lab's screen is created when that section's work begins, not now. The sandbox hub screen ships with stub rows that link nowhere (or link to a placeholder) until each Lab is actually built.

## 10. Test matrix

For each Lab, the minimum tests before that section can be considered shipped *inside the sandbox*:

- **3.2 DAG**: round-trip `canonicalize → sha256` matches a Nostr-tools reference event. `verify` rejects a tampered payload. LWW rule deterministic across 3 reorderings. Export → import preserves all node ids.
- **3.3 P2P**: BLE-only mode delivers a 4-KiB DAG node in <2 s on the dev rig. WebRTC-LAN mode delivers a 1-MiB DAG export in <5 s. Both modes survive a 10-second connection drop (auto-reconnect, no node duplication).
- **3.3.1 UWB Bump**: simulated distance progression 0→50→20→8→8→8 cm fires exactly one `soft` haptic + one `heavy` haptic + one visual flash; pulling away to 40cm before the third close frame returns to `idle` with zero haptics. Real two-phone test: bringing phones into contact fires the bump within 500 ms of the third close frame, exchange completes within 1 s of the bump, cooldown clears after 2 s.
- **13.3 Replay perf gate**: a synthetic DAG of 10 000 valid nodes plus 100 revocations sprinkled in replays in ≤ 50 ms on the dev rig. A second test with 50 000 nodes is allowed to exceed the budget (proof that 10k is not coincidentally fast).
- **13.4 Driver selection**: `selectDriver()` returns `'uwb'` on iPhone 11+ simulator probe and `'rssi'` on iPhone X simulator probe; Android equivalents pass too.
- **13.5 Same-peer-twice**: scripted bump A→B→A within one Start Matching session fires the auto-invite once and shows the "already exchanged" sheet on the second bump, even on the UWB branch.
- **3.4 Nostr**: publish a HEAD, subscribe from a second device, receive within relay-RTT + 500 ms. Tampered signature rejected client-side.
- **3.5 Common Friends**: with 100 fake exchanges on each side and 30 in common, intersect returns exactly 30, no duplicates, no false positives.

## 11. Graduation criteria (sandbox → public)

A Lab cannot be promoted to the public surface until **all** of:

1. Test matrix passes on iOS + Android dev rigs.
2. A separate public-facing design doc lives at `apps/expo/docs/<feature>.md` and references the sandbox doc.
3. The Lab has run for ≥ 2 weeks of dev use without a `developerMode` regression bug.
4. Swift parity question is answered explicitly: either Swift gets the same feature (port back) or the public Expo surface ships ahead of Swift with a justification.
5. The user explicitly approves the graduation. No auto-promotion.

## 12. Anti-patterns

If you find yourself doing any of these, you are violating the hard scope:

- Importing `@/dag/**` from a file inside `app/(tabs)/**`, `app/onboarding/**`, or any public screen.
- Calling `getDevSecpKey()` from any file outside `src/dag/**` or `app/settings/developer.tsx`.
- Adding a default Nostr relay URL anywhere in code (must come from user input).
- Mutating `usePreferences` or any public store from a Lab.
- Writing fake DAG nodes for screenshots — sandbox shows empty state until real nodes exist.
- Reintroducing the Swift `SocialGraphIntersectionService` hash-PSI approach.
- Treating the dev secp256k1 key as the user's primary identity in any UI label.

## 13. Decisions

The following replace the original §13 open-question list. They are normative — implementation work in §3.3 / §3.3.1 / §3.4 / §6 must follow them. Reopen only via a separate doc edit if a real new constraint surfaces; do not silently re-litigate during PR review.

### 13.1 WebRTC cross-NAT — no defaults, developer-configurable

**Rule**: `RTCPeerConnection` is constructed with `iceServers: <user-entered list>` where the default is `[]` (LAN-direct only). P2P Lab exposes a free-form text input "ICE servers (comma-separated)" with placeholder text:

> `empty = LAN-direct only; paste stun:stun.l.google.com:19302 for cross-room testing (exposes your IP to that operator)`

**Never** ship a TURN URL — TURN relays the actual payload bytes, which has both a privacy cost (the operator sees the traffic shape) and a $-cost. If a future cycle needs TURN, that's a separate design decision.

**Why**: matches the hard scope §2 "no default backend" rule, but accepts that two-network testing is a real dev need. Configurable beats forbidden.

### 13.2 Nostr relay default — empty input + suggestive helper text

**Rule**: Nostr Bridge Lab relay input is empty by default. Below the input, in the existing helper-text slot, display:

> `Free public relays: wss://relay.damus.io, wss://nos.lol. Your DAG HEAD becomes visible to that operator.`

The developer must explicitly copy-paste or type. No auto-fill, no "tap to fill" shortcut, no remembered last-used relay outside the current session (forget on app restart).

**Why**: hard scope §2 "no default relay list" is preserved literally — the input is empty. The hint reduces onboarding friction without removing the explicit consent moment. Privacy cost is named in the same UI surface, so a developer cannot claim they didn't know.

### 13.3 Replay on revocation — full replay, perf-gated

**Rule**: when a `revoked` node arrives (in or out of order), the projection is cleared and the entire DAG is walked from genesis, with revoked node ids skipped during application. No patch-in-place, no dependency tracking.

**Perf gate** (additional to §10): replay must complete in ≤ 50ms for a DAG of ≤ 10 000 nodes on the dev rig. The test in §10 enforces this. If a future user hits the wall (replay > 500ms on a real device), revisit — that's a real problem, not a hypothetical one.

**Why**: personal card-holder DAGs are estimated at < 10k nodes per lifetime; replay is a non-issue at that scale. Patch-in-place needs dependency tracking which has a large bug surface. YAGNI applies.

### 13.4 UWB bump on Android — unified state machine, platform-specific driver

**Rule**: every device uses the same `UwbSpatialState` state machine (defined in `src/components/share/UwbStatusPill.tsx:10-15`). The proximity signal feeding it, and whether the `confirmed → exchanging` transition fires a consent sheet, depends on hardware:

| Device class | `approaching → confirmed` signal | `confirmed → exchanging` consent |
|--------------|----------------------------------|-----------------------------------|
| iOS with U1 chip (iPhone 11+) | `NearbyInteraction` distance < 10 cm × 3 consecutive frames | auto-invite, no sheet |
| Android with `androidx.core.uwb` (Pixel 6 Pro+, S21 Ultra+, etc.) | same UWB driver, same threshold | auto-invite, no sheet |
| iOS pre-U1 (≤ iPhone X) | BLE RSSI > −50 dBm × 3 consecutive frames | 3-second auto-decline sheet, must explicitly accept |
| Android without UWB hardware (majority) | same RSSI driver | same 3-second sheet |

**Capability detection**: P2P Lab shows "This device: **UWB mode**" or "This device: **RSSI mode**" so the developer always knows which branch is active. Helper text under the badge explains the consent-sheet divergence.

**Why option (a) alone was rejected**: pure RSSI without a confirmation step false-fires when phones are in a pocket facing each other; the consent sheet absorbs the noise. **Why option (c) was rejected**: silently disabling bump on majority Android == admitting defeat on the headline UX. **Why option (b) "two-finger tap"**: rejected because it requires teaching a non-standard gesture; the RSSI-plus-sheet path produces the same outcome with no new gestures to learn.

**Implementation hook**: `src/matching/uwbBumpDriver.ts` exports `selectDriver(): 'uwb' | 'rssi'` based on `Platform.OS` + native capability probe. The state machine is platform-agnostic; only the driver and the consent-sheet flag are conditional.

### 13.5 Bump auto-invite consent — derived from §13.4

**Rule**: consent behaviour follows §13.4's driver split, with two additional rules:

1. **Always-confirm escape hatch** (UWB branch only): P2P Lab exposes a toggle "Always confirm bumps" defaulting to off. When on, the UWB branch *also* shows the 3-second sheet — gives privacy-anxious developers an opt-in match for the RSSI branch's behaviour.
2. **Same-peer-twice in one session always triggers a sheet** (both branches): the bump driver maintains a sandbox-local `Set<peerId>` of peers it has already auto-invited during the current "Start Matching" session. A second bump to the same peer always shows the sheet titled "Already exchanged with X — re-exchange?". The set clears when matching stops. This blocks the "phone in pocket at a conference" disaster scenario where two devices repeatedly brush against each other.

**Why no per-bump confirmation on UWB by default**: the headline UX promise is NFC-tap-feel. NFC tap has no confirmation step. Reproducing that feel is the whole reason §3.3.1 exists. The opt-in toggle satisfies the cautious case; the same-peer-twice rule satisfies the runaway case; the rest stays magic.
