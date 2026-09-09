<div align="center">

<img src="./apps/expo/assets/icon.png" width="140" alt="Solid(ar)ity app icon" />

<h1>Solid(ar)ity</h1>

<p>
<strong>A verifiable identity page and business card that you own outright.</strong><br />
Local-first, no accounts, no server in the trust path — if this project disappeared tomorrow,
every page and every proof it ever produced would still verify.
</p>

[![License: Apache 2.0](https://img.shields.io/github/license/p2p-solidarity/solidarity)](./LICENSE)
[![Version 2.0.0](https://img.shields.io/badge/version-2.0.0-2b6cb0)](./apps/expo/app.json)
[![Platforms](https://img.shields.io/badge/platform-iOS%2017%2B%20%C2%B7%20Android%2010%2B-4a5568)](#build--release)

</div>

---

## What is Solid(ar)ity?

A **Verified Page**: a Linktree you hold the keys to. Every link, handle and credential on it is
either cryptographically checkable by any stranger, or honestly labelled as an unverifiable claim.
The app is the key holder and issuer; the web page is a static, replaceable renderer.

**North star — "the company dies, the mechanism still works."** That is the ruler every feature is
measured against. In practice it means: your data lives on your device and in _your_ cloud
(iCloud Drive / Google Drive), publication goes to open networks you don't need us for (Nostr,
atproto, a URL fragment), and verification runs entirely on the reader's client.

### Product principles (non-negotiable)

1. **No server.** We don't store user data, run accounts, or sit on the verification path.
2. **A green check means _control_, not identity.** It says "this person controls that account /
   domain / key right now" — never that they're famous, honest, or who they claim to be.
3. **One click to the evidence.** Every badge is at most one tap from the platform's own proof
   (a DNS answer, a signed post, a JWKS verification result).
4. **Light by default.** JWS and SD-JWT carry the product. Zero-knowledge proofs are an opt-in
   module and never sit on a hot path.
5. **Key lifecycle is the one place we don't go light.** Recovery is a day-one requirement.

### Three tabs

| Tab          | Route               | What it does                                                                                              |
| ------------ | ------------------- | --------------------------------------------------------------------------------------------------------- |
| **Page**     | `app/(tabs)/me`     | Your verified page and card — edit blocks and appearance, bind badges, publish, share a QR or link.       |
| **Present**  | `app/(tabs)/verify` | Show and verify: scan a QR, present a card or a selective-disclosure proof, review a verification result. |
| **Contacts** | `app/(tabs)/people` | People you've saved — snapshots plus quiet re-verification when their page changes.                       |

---

## How it works

### Identity and keys

- **One root identity.** A BIP-39 mnemonic → HKDF → a **P-256 `did:key`**. The same mnemonic
  produces the same DID in the app and on the web, so the identity is portable by construction
  (`packages/shared/src/derive.ts`, `HKDF_INFO_ROOT = solidarity-root-v1`).
- **One Nostr key from the same seed.** secp256k1 via `HKDF_INFO_NOSTR` → the same `npub`
  everywhere. (An existing `nsec` can be imported instead.)
- **Signing is gated by Face ID.** A three-mode biometric policy plus a set of _red-line_ actions
  that prompt in every mode because they're irreversible — key rotation, revealing the recovery
  bundle, deleting a ZK identity, releasing a card to a remote peer
  (`apps/expo/src/keychain/sensitiveActionPolicy.ts`).
- **Terminology is deliberately narrow** — Recovery Phrase, Root Identity, Signing Identity, Device
  Storage Key, Portable Backup Key, Backup Archive are six _different_ things. See
  [CONTEXT.md](./CONTEXT.md) before writing anything that says "key".

### Publishing surfaces (pick any, or all)

| Surface               | Shape                                                                                         | Needs                                           |
| --------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Nostr**             | NIP-78 replaceable event, `kind 30078`, `d = solidarity.profile`, plus `kind 0` `alsoKnownAs` | A keypair. No account. Default home.            |
| **atproto / Bluesky** | Record `app.solidarity.profile` (rkey `self`) in your own PDS, via atproto OAuth              | A Bluesky account                               |
| **URL fragment**      | Signed profile → raw-deflate → base64url after `#`                                            | Nothing — the fragment never leaves the browser |
| **NIP-05 directory**  | `name@creds.id`, registered with a NIP-98 signed request                                      | Only for the human-readable handle              |

`creds.id` is the production product host and default share origin; `solidarity.gg` hosts remain
valid for deep links and atproto OAuth client metadata.

### Verification and badges

Reader-side resolution is pluggable and runs the same code in the app and on the web (shipped from
`packages/shared`): **atproto**, **DNS** (`_did.<domain>` TXT, cross-checked over DoH), **ENS**, and
**NIP-05** — each with a reverse-binding check, because a one-way claim never earns a green check.

Badge state machine: `verified → stale → revoked`, plus `declared` for things that are structurally
unverifiable. Tiers follow creds T1: **A** = evidence on the public internet, re-checkable by any
visitor · **B** = one-time authorisation, not reproducible afterwards (OIDC / OpenPubkey-style)
· **C** = national PKI, trust anchor is the CSCA (passport).

### Exchange — QR, one direction at a time

There is no pairing session and no proximity handshake. You scan someone, it verifies locally, it
saves. They scan you back. Mutual exchange emerges instead of being coordinated.

The wire formats are specified in [`docs/ref/05-spec-qr-exchange.md`](./docs/ref/05-spec-qr-exchange.md)
(the single source of truth). The short version:

- **CRD1** — the preferred card wire: claims → CBOR → `COSE_Sign1` → zlib → Base45 → `CRD1:`.
  ES256, a hard 2,420-character cap, expiry clamped to 30 days, holder-binding fail-closed.
- **CRD1 evidence pack** — the same envelope signed by the **root** key, carrying only badges that
  passed a live check (`checkedAt` travels with them). Stale or declared entries can never be
  promoted; revoked ones can't be packed at all.
- **Verified Page fragment / `#nostr:<npub>` pointer / `@handle` URL** — the page-shaped payloads.
- **sqc1** — the chunked-QR transport used by selective-disclosure presentations, passport show, and
  web-sign responses.
- **Legacy wires stay readable forever.** Old QRs keep scanning; CRD1 is the preferred emission,
  not a flag day.

### App ↔ Web signing (websign)

Build a page in a browser on a real keyboard, sign it with the phone that holds the key. The web
produces a request, the phone scans it and shows a **per-field diff** of exactly what would change,
then Face ID signs. Ungated for every user since 2026-09-09 — the security boundary is the review
screen, not a developer toggle.

### Passport (opt-in, on device)

MRZ scan (Vision OCR) → NFC chip read → device-side passive authentication → a self-issued SD-JWT
whose `cnf` binds to your `did:key`. Selective disclosure lets you present `over_18` without
revealing a birth date. Zero-knowledge proofs (Noir / OpenAC v3) are an **opt-in top tier** — and
when the ZK path is unavailable the app says so rather than passing an SD-JWT fallback off as a
ZK attestation.

### Private channel (Pear lane)

For app-to-app exchange that shouldn't touch any public surface: a Bare worklet running Hyperswarm,
swarm topic = hash(DID), Noise-encrypted, DID ownership proven by signing a challenge inside the
channel. **Iron rule: private channels only** — the public page's storage and verification never go
through Pear, because zero-install browser viewers are the whole growth loop.

### Backup and recovery

The Recovery Phrase is the only root. Backup Archives are encrypted with a Portable Backup Key
derived from it and written to **your** cloud — iCloud Drive Documents on iOS, Google Drive on
Android — never to infrastructure we operate. Restore on a new device is: enter the phrase, pull
the archive, done. Evicted iCloud files report _downloading_, not _unreadable_.

### What we deliberately don't do

No inbox, no chat, no scores, no chain, no centralised badge database, no LinkedIn verification, and
no claim of "unique human". A page that can only be read through our domain would fail the north
star, so nothing is built that way.

---

## Repository layout

A Bun workspaces monorepo. **The app is `apps/expo/`.**

```
airmeishi/
├── apps/expo/            ← the app: Expo Router + React Native + TypeScript
├── packages/
│   ├── shared/           ← pure-TS crypto, wire formats and verification (app + web share it)
│   └── parity-fixtures/  ← FROZEN golden vectors — never edit, never regenerate
├── nitro-modules/
│   ├── attest/           ← @solidarity/nitro-attest — MrzOcr · NfcPassport · PassportZk · Semaphore
│   └── keystone/         ← @solidarity/nitro-keystone — SecretsVault · SpruceDid · CloudKit
└── docs/ref/             ← the live specs and plans (see "Where truth lives")
```

`packages/shared` is the reason app and web agree: DID/JWT primitives, canonical JSON, JWS, seed
derivation, CRD1 and QR-chunking codecs, fragment encoding, handle resolvers and badge verification,
Nostr NIP-01 event build/verify, the NIP-05 client, NIP-44 v2 primitives, Shamir splitting, vCard and
Linktree/Twitter importers — plus the conformance vectors both ends must reproduce identically. It is
a workspace dependency here and a packed tarball (`solidarity-shared-<version>.tgz`) vendored into
the web repo, so **re-pack it whenever you change it**.

The two Nitro modules were consolidated from eight in `386cbf9`. Keychain service names and
AndroidKeyStore alias prefixes were **not** renamed — they address existing users' keys.

<details>
<summary><strong><code>apps/expo/src</code> module map</strong></summary>

| Area              | Modules                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Identity & keys   | `identity` · `keychain` · `storage`                                                                   |
| Page & card       | `page` · `me` · `cards` · `profile` · `present` · `disclosure`                                        |
| Publish & resolve | `nostr` · `atproto` · `handles` · `nip05` · `domains` · `badges`                                      |
| Exchange          | `scan` · `sharing` · `deeplink` · `websign` · `pear`                                                  |
| Credentials       | `credentials` · `oidc` · `passport` · `zk` · `groups`                                                 |
| Data              | `contacts` · `people` · `vault` · `backup`                                                            |
| Shell             | `components` · `constants` · `navigation` · `onboarding` · `settings` · `i18n` · `feedback` · `legal` |

</details>

### The web side

The viewer and page builder live in a **separate repo**
([`p2p-solidarity/solidarity-app`](https://github.com/p2p-solidarity/solidarity-app)) and are served
from `creds.id`: a static SPA with no cookies, no accounts and no writes. It resolves `#fragment`,
`#nostr:<npub>` and `/@handle`, and verifies with the same `@solidarity/shared` code the app uses.
The builder can create an identity, sign and publish standalone: a passkey PRF wraps the seed so a
return visit only needs a touch, but the mnemonic stays the only root — no PRF support, or no
passkey, means re-entering the phrase, and nothing secret is ever persisted in the clear.

---

## Development

### Prerequisites

- **Bun 1.3.14** (pinned via `packageManager`) and Node ≥ 20.18
- **Xcode** for iOS — deployment target 17.0, developed and tested against iOS 26
- **Android SDK** with `minSdk 29`, `compileSdk`/`targetSdk` 36
- A physical iPhone for anything that touches NFC passport reading

`bunfig.toml` pins `linker = "hoisted"` — Metro's transformer loader can't traverse Bun's default
symlinked layout, so the workspace deliberately installs a flat root `node_modules/`.

### Quick start

```bash
git clone git@github.com:p2p-solidarity/solidarity.git
cd solidarity
bun install
```

```bash
cd apps/expo
bunx expo prebuild --clean --platform ios --no-install
bun run ios          # builds + installs the dev client, launches the simulator
```

### Expo Go is not a development path

The app ships Nitro modules and a vendored `BareKit.xcframework`; Expo Go only bundles Expo's own
native modules and will fail at _native module not found_. **Build a dev client once per native
dependency change**, then use `expo start` for the JS iteration loop.

Android `minSdkVersion` is **29** (not 26) because `react-native-bare-kit` declares `minSdk 29` and
AGP fails the manifest merge otherwise.

### Verify — run this before claiming anything works

```bash
bun run typecheck && bun run lint && bun run test
```

Current baseline on `2.0.0`: **0 type errors**, **0 lint errors** (warnings are cosmetic and
tolerated), **2,014 unit tests** across 216 files plus **114 parity tests** across 14 files.

| Script                | What it runs                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `bun run typecheck`   | `tsc --noEmit` over `apps/expo`                                    |
| `bun run lint`        | ESLint across the workspace (`lint:strict` for `--max-warnings 0`) |
| `bun run test:unit`   | `bun test __tests__/unit` with integration suites skipped          |
| `bun run test:parity` | Golden-vector parity against `packages/parity-fixtures`            |
| `bun run format`      | Prettier over `ts,tsx,js,jsx,json,md`                              |

`bun run test` covers `apps/expo` only. `packages/shared` carries its own suite (24 test files
against 17 golden-vector JSON files) — run it with `cd packages/shared && bun test`.

Parity fixtures are **frozen**: the Swift `FixtureExporter` that produced them was deleted with the
old app, so they can never be regenerated. Fixture-less parity suites print a notice and still
assert the TypeScript canonicalisation contract.

### Build & release

- **iOS** ships through **Xcode Cloud**. `ios/` is gitignored, so the `withXcodeCloudScripts` config
  plugin recreates `ios/ci_scripts/ci_post_clone.sh` after every `expo prebuild --clean` from the
  persistent source at `apps/expo/ci-scripts/ci_post_clone.sh`. That hook hands off to
  `apps/expo/scripts/prepare-ios-workspace.sh`, which seeds `Package.resolved` and stages the
  SHA-pinned 128 MB `passport.srs.bin` proving key from the `passport-noir` releases.
  `-skipPackagePluginValidation` is required by SPM plugin validation.
- **Android** builds via EAS Build, or `expo prebuild --platform android` + `./gradlew bundleRelease`.
- Identifiers: iOS `kidneyweakx.airmeishi`, Android `gg.solidarity.app`. URL schemes `solidarity://`,
  `airmeishi://`, `openid-credential-offer://`. Associated domains `solidarity.gg`,
  `app.solidarity.gg`, `creds.id`.
- `.github/workflows/release.yml` cuts a GitHub release when a `1.*`/`2.*` release PR merges to
  `main` (or on manual dispatch).

---

## Where truth lives

Read in this order. Anything not listed here is history, not guidance. `docs/ref/` is written in
Traditional Chinese; the code, comments and this README are in English.

1. **[`CLAUDE.md`](./CLAUDE.md)** — repo guide and hard rules.
   **[`apps/expo/CLAUDE.md`](./apps/expo/CLAUDE.md)** — the coding rulebook: themed primitives, the
   no-fake-data rule, worklet rules, and the Nitro `ArrayBuffer` crash class. Mandatory before
   editing anything under `apps/expo/`.
2. **Live plans** — [`docs/ref/06-plan-convergence-2.0.0.md`](./docs/ref/06-plan-convergence-2.0.0.md)
   (the 2.0.0 batch: north star, decisions Q1–Q6, keep/cut of older features) and
   [`docs/ref/07-plan-web-standalone.md`](./docs/ref/07-plan-web-standalone.md) (web standalone
   onboarding, phases 1–3).
3. **Specs** — `docs/ref/01` and `03` are the Verified Page product spec (§6 of `03` is the
   kept/evolved/frozen/deleted table); `docs/ref/05` is the QR and exchange SSOT; `02` is user
   stories. `04` is the superseded 1.3.3 plan, kept for history.
4. **Archive** — [`docs/ref/notes-archive-pre-2.0.0.md`](./docs/ref/notes-archive-pre-2.0.0.md)
   distils the deleted pre-2.0.0 plans.

> **Stale by design:** `spec.md` and `architecture.png` describe the deleted SwiftUI app and its
> pre-pivot architecture. Root `ios/`, `android/`, `app.json`, `solidarity.xcodeproj/` and
> `ci_scripts/` are leftover artifacts — the real native projects are `apps/expo/{ios,android}`,
> regenerated by prebuild.

### History — what was removed

The original SwiftUI app was deleted on 2026-06-27 (`3fd308e`). Along with it went
**MultipeerConnectivity proximity exchange**, **CloudKit group sync**, the **Sharing tab**, and
AirDrop-based transfer. Group / Semaphore ZK membership ("lists") is **frozen**, not deleted. Docs or
comments referring to `solidarity/Views/...`, `Color.Theme.*` or `solidarity.xcodeproj` are historical
naming — the live equivalents are the TypeScript modules above.

---

## Security

Contributions touching these paths are reviewed as high-risk changes:

- Sensitive paths: `apps/expo/src/{passport,keychain,identity,vault}` and
  `nitro-modules/{attest,keystone}`.
- Errors on security paths use tagged unions — never thrown raw, never swallowed, never logged with
  PII.
- Red-line Face ID actions deliberately bypass the biometric grace window. Adding a grace period
  there is a regression, not an optimisation.
- A Nitro `ArrayBuffer` argument from JS is **non-owning**: reading `.data` / `.size` inside
  `Promise.async` is an uncatchable native crash. Copy the bytes synchronously first.
- Never commit `apps/expo/secrets/`, any `.env*`, or `apps/expo/infra/terraform/terraform.tfstate*`
  / `terraform.tfvars`.

Found a vulnerability? Please report it privately through GitHub's security advisories on this
repository rather than opening a public issue.

---

## Built with

[Expo](https://expo.dev) · [React Native](https://reactnative.dev) ·
[Nitro Modules](https://github.com/mrousavy/nitro) · [Expo Router](https://docs.expo.dev/router/introduction/) ·
[NativeWind](https://www.nativewind.dev) · [Reanimated](https://docs.swmansion.com/react-native-reanimated/) ·
[MMKV](https://github.com/mrousavy/react-native-mmkv) · [Bare](https://github.com/holepunchto/bare) / [Hyperswarm](https://github.com/holepunchto/hyperswarm) ·
[Noir](https://noir-lang.org) · [Semaphore](https://semaphore.pse.dev) ·
[SpruceID](https://spruceid.com) · [Nostr](https://github.com/nostr-protocol/nips) ·
[atproto](https://atproto.com)

## License

Apache 2.0 — see [LICENSE](./LICENSE). Also: [Privacy Policy](./PRIVACY_POLICY.md) ·
[Terms of Service](./TERMS_OF_SERVICE.md).

---

<div align="center">
<strong>Solid(ar)ity</strong> — an identity page that outlives the company that built it.
</div>
