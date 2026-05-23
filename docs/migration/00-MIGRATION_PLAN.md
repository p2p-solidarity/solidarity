# Solidarity Migration Plan — Swift / SwiftUI → Expo / React Native + Nitro

**Source**: `solidarity/` (iOS 26 / 17, 320 Swift files, ~67k LOC)
**Target**: `apps/expo/` (Expo 56 + RN 0.85 + React 19.2 + TS 6.0 + NativeWind 4.2 + Reanimated 4.3 + FlashList 2.3 + MMKV 4.3 + VisionCamera v5 + Nitro Modules 0.35 + Zod 4 + Zustand 5)
**Goal**: 1:1 functional parity of v1.3.1 + Android support + same Bundle ID (`kidneyweakx.airmeishi`) → in-place upgrade for existing iOS users.

---

## Confirmed decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Monorepo layout | **Now** — `apps/{expo,ios-legacy}` + `packages/{shared,parity-fixtures}` + `nitro-modules/{passport-zk,proximity,nfc-passport}` |
| 2 | Bundle ID | **Sí** — reuse `kidneyweakx.airmeishi` → Expo build is in-place upgrade. Must import legacy Keychain / UserDefaults / CloudKit data on first launch |
| 3 | Android NFC + UWB | **Full parity** — jmrtd JNI for passport NFC + Android UWB API 31+ for ranging — 2 dedicated Nitro modules |
| 4 | CloudKit | **Keep iOS CloudKit + Drive on Android** — local MMKV is source-of-truth, settings page lets user pick iCloud (iOS) or Drive (both) |
| 5 | Commit style | `feat/chore/fix/refactor/docs(scope): summary` ≤120 chars, one batch per logical chunk |
| 6 | Lint | ESLint flat config, `max-lines: 500`, `@typescript-eslint/no-explicit-any: error` everywhere except `**/*.bridge.ts`, `**/*.handler.ts`, `**/native-modules/**` |
| 7 | TDD | bun test parity oracle — Swift `FixtureExporter` writes golden JSON, TS asserts identical output |
| 8 | CI/CD | **Xcode Cloud (iOS)** via Expo CNG + `apps/expo/ios/ci_scripts/ci_post_clone.sh` (25 h/month free, auto cert mgmt). **EAS Build (Android)** or `expo run:android` + Play Console direct. See `04-native-capabilities.md` §CI/CD. |
| 9 | OTA | EAS Update enabled for JS-only (UI/copy/bug fixes). Forbidden scope: Nitro modules, crypto, ZK. `runtimeVersion: 1.3.1` policy pin. |

---

## Repo layout (final target)

```
airmeishi/                       (repo root = bun workspace root)
├── apps/
│   ├── expo/                   ← new Expo / RN app (becomes the shipping app)
│   └── ios-legacy/             ← current Swift code (kept until expo reaches parity, then archived)
├── packages/
│   ├── shared/                 ← TS types, Zod schemas, pure utils (DID, JWT, crypto helpers shared between expo + nitro)
│   └── parity-fixtures/        ← golden JSON exported from Swift XCTest, consumed by bun test
├── nitro-modules/
│   ├── passport-zk/            ← wraps passport-noir/mopro-binding (iOS xcframework + Android JNI)
│   ├── proximity/              ← MultipeerConnectivity (iOS) ↔ Nearby Connections (Android) + UWB
│   └── nfc-passport/           ← CoreNFC (iOS) ↔ jmrtd (Android) for ICAO 9303 BAC/PACE
├── docs/migration/             ← agent-produced inventories (this directory)
├── solidarity/                 ← legacy Swift (will be git-mv'd to apps/ios-legacy/ after expo reaches parity)
├── solidarityClip/             ← App Clip (iOS-only, kept)
├── solidarity.xcodeproj/
├── solidarityTests/
├── package.json                ← bun workspaces root
├── tsconfig.base.json
├── eslint.config.mjs
└── .prettierrc
```

**Why additive (not git-mv now)**: the Xcode project has relative paths; moving Swift to `apps/ios-legacy/` requires rewriting `solidarity.xcodeproj/project.pbxproj`. Defer until expo app passes TestFlight; then do the move in one PR.

---

## Phased execution

Each phase = 1+ commit, batched. `/loop` continues until phase done; user can sit on `/goal` and let it grind.

### Phase 0 — Foundation (THIS SESSION)
- [x] 4-agent inventory → `docs/migration/{01,02,03,04}-*.md`
- [ ] Monorepo skeleton: `package.json` (bun workspaces), `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`
- [ ] `apps/expo/` scaffold (no `bun install` yet — user runs it)
- [ ] `nitro-modules/{passport-zk,proximity,nfc-passport}/` spec scaffolds
- [ ] `packages/{shared,parity-fixtures}/` scaffolds
- [ ] `.gitignore` updates
- Commit: `docs(migration): add inventory ledgers from 4-agent recon`
- Commit: `chore(monorepo): scaffold bun workspaces + strict lint baseline`
- Commit: `chore(expo): scaffold apps/expo with NativeWind + Reanimated + FlashList`
- Commit: `chore(nitro): scaffold passport-zk/proximity/nfc-passport HybridObject specs`

### Phase 1 — Bottom of dependency stack (pure TS + Nitro storage bridge)
Goal: prove the parity-fixture pattern works on the simplest layer.
- `packages/shared/src/types/` — port `BusinessCard`, `Contact`, `CardError`, `SharingFormat`, `AnimalCharacter`, `SocialNetwork`, `Skill`, etc. as Zod schemas + TS types (snake_case wire format preserved via `.transform()` where applicable)
- `apps/expo/src/storage/` — MMKV + expo-secure-store wrapper, mimics `StorageManager.swift` + `EncryptionManager.swift` (AES-256-GCM via `@noble/ciphers`, master key in Keychain via `expo-secure-store`)
- `packages/parity-fixtures/` — write Swift test helper that dumps `EncryptionManager.encrypt(...)` outputs to JSON
- bun test: TS decrypts Swift-produced ciphertexts → green = parity proven
- Commit: `feat(shared): port BusinessCard/Contact/CardError to Zod schemas`
- Commit: `feat(storage): MMKV + secure-store encryption parity with Swift`

### Phase 2 — Identity primitives (DID, JWT, P-256 ECDSA)
- `packages/shared/src/identity/` — DID:key derivation, JWK encoding, JWT sign/verify via `@noble/curves` + custom JWS builder
- Parity: Swift signs a JWT, TS verifies with same key → green
- Commit: `feat(identity): DID:key + ES256 JWT parity with KeychainService`

### Phase 3 — Keychain Nitro bridge
- `nitro-modules/passport-zk/` is for ZK; keychain bridge lives in `apps/expo/modules/keychain-bridge/` (Expo module)
- iOS: reuse `expo-secure-store` (already wraps Keychain with kSecAttrAccessControl + biometry)
- Android: Keystore via expo-secure-store, AES-GCM at rest
- Migrate v1 → v2 master alias logic (the iCloud Keychain phantom workaround) — replicate in TS
- Parity: legacy iOS key derived in Swift → same key derived from TS via reading legacy Keychain entry
- Commit: `feat(keychain): bridge legacy Swift Keychain via expo-secure-store + v2 migration`

### Phase 4 — QR codes + chunking
- `apps/expo/src/qr/` — generation (`@bwip-js/react-native` or `react-native-qrcode-svg`), scanning (`react-native-vision-camera` v5 barcode plugin), chunking protocol port
- Parity: Swift generates chunked QR → TS reassembles to same payload
- Commit: `feat(qr): generation/scan/chunking parity with QRCodeManager`

### Phase 5 — UI shell: theme, themed buttons, tab bar, onboarding
- NativeWind theme tokens map to `Color.Theme.*` (pageBg/cardBg/textPrimary/textSecondary/textTertiary/accentRose/divider/primaryBlue/dustyMauve/blobCenter/gradientPeach/gradientLavender)
- Themed components: `ThemedButton` (primary/inverted/secondary/dotted/destructive) + `ThemedText` + `ThemedSurface` per aniseekr-expo rules
- `MainTabView` → Expo Router `(tabs)/`
- Onboarding flow (7-step state machine, terminal welcome, avatar grid, dark profile form)
- Commit: `feat(ui): theme tokens + Themed* primitives + tab shell`
- Commit: `feat(onboarding): 7-step flow with typewriter + avatar grid`

### Phase 6 — Sharing pipeline (ProximityManager + WebRTC + UWB)
- Nitro module `proximity/` — TS spec, iOS Swift impl wrapping MultipeerConnectivity, Android Kotlin impl wrapping Nearby Connections API. Unified peer-discovery + invite/accept/send API.
- UWB ranging — separate Nitro spec (iOS NearbyInteraction + Android UWB API)
- WebRTC — `react-native-webrtc` for data channel
- `MessageService` (Sakura) — TS layer, snake_case wire format preserved
- Commit: `feat(proximity): Nitro module for MPC↔Nearby Connections unified API`
- Commit: `feat(uwb): Nitro module for NearbyInteraction↔Android UWB ranging`

### Phase 7 — Passport pipeline (MRZ + NFC + ZK proof)
- `MRZScannerService` → `react-native-vision-camera` frame processor + custom TD3 parser
- `nfc-passport/` Nitro — iOS reuses `NFCPassportReader.swift` lib, Android uses jmrtd JNI bridge
- `passport-zk/` Nitro — wraps `passport-noir/mopro-binding` xcframework (iOS) + new Android JNI shim to `libpassport_zk_mopro.so` (aarch64-linux-android + x86_64-linux-android)
- Circuit + SRS file resolution: bundle as assets (or download via expo-asset)
- Commit: `feat(passport): MRZ + NFC + ZK proof pipeline parity`

### Phase 8 — OIDC / VC / Verifier
- `OIDCService`, `CredentialIssuanceService`, `VCService`, `ProofVerifierService` — pure TS via `@spruceid/mobile-sdk-rs` WASM build (or new Nitro bridge if WASM perf insufficient)
- Commit: `feat(oidc): OID4VP + OID4VCI flows parity`

### Phase 9 — Backup / Cloud sync
- iOS: keep CloudKit (Nitro bridge using existing `CloudKitGroupSyncManager` Swift sources reused via Nitro hybrid object)
- Android + iOS: Drive via `react-native-cloud-storage` + `@react-native-google-signin/google-signin`
- Gesture-triggered auto-backup (pull-to-refresh + on-app-background) via `react-native-gesture-handler`
- Commit: `feat(backup): CloudKit (iOS) + Drive (cross-platform) sync layer`

### Phase 10 — Migrate Swift app dir → apps/ios-legacy/, ship to TestFlight
- `git mv solidarity apps/ios-legacy/solidarity` + fix `project.pbxproj` paths
- Swift target stays buildable until expo passes TestFlight
- Commit: `chore(repo): finalize monorepo by relocating Swift to apps/ios-legacy`

---

## Lint enforcement targets

```js
// eslint.config.mjs (root)
{
  rules: {
    'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    '@typescript-eslint/no-explicit-any': 'error',
    'max-depth': ['error', 4],
    'max-params': ['error', 5],
    'complexity': ['warn', 12],
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'react-hooks/exhaustive-deps': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
  },
  overrides: [
    {
      files: ['**/*.bridge.ts', '**/*.handler.ts', '**/native-modules/**', 'nitro-modules/**/specs/**'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' }, // boundary layer
    },
  ],
}
```

---

## Parity TDD pattern

Each ported service has 2 test files:
- `__tests__/parity/<service>.parity.test.ts` — reads `packages/parity-fixtures/<service>/*.json` (produced by Swift) and asserts TS output matches
- `__tests__/unit/<service>.test.ts` — TS-native unit tests

Swift side (added to `solidarityTests/FixtureExporter.swift`):
```swift
final class FixtureExporter: XCTestCase {
  func test_exportEncryptionFixtures() throws {
    // For each test case, run Swift impl, capture input + output, write to
    // ../packages/parity-fixtures/encryption/<case>.json
  }
}
```

CI fails if either side diverges.

---

## What's deferred / out of scope for v1.3.1-expo

- **App Clip** — stays iOS-only (`solidarityClip/` unchanged)
- **PassKit `.pkpass` on Android** — Google Wallet REST API integration is a follow-up; Android gets QR fallback for v1.3.1
- **Siri Shortcuts / App Intents** — convert to deep links (works on both platforms)
- **Live Activities / Widgets / Watch app** — not in scope (none in current Swift)
- **Vault inheritance flow (TimeLockConfig)** — port but feature-flag OFF until escrow contact backend ready
- **Server-side mopro fallback** — not pursued; on-device only
