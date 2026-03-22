# AirMeishi (Solidarity) - Claude Code Instructions

## Rules

- **禁止建立重複的功能或頁面**：不要新增與現有功能/頁面重複的 View 或邏輯。修改前先確認是否已有相同功能存在，優先複用或擴充現有程式碼。
- **不要加假資料**：禁止在正式程式碼中使用 hardcoded sample/mock/dummy data。`.sample` 僅限 SwiftUI Preview 使用。
- **先讀再改**：修改任何檔案前必須先讀取該檔案，了解現有邏輯再動手。

## Build

```bash
xcodebuild -project airmeishi.xcodeproj -scheme airmeishi \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  build -skipPackagePluginValidation
```

- 必須加 `-skipPackagePluginValidation`（SwiftLint plugin 問題）
- iOS Deployment Target: 18.6（主 app）/ 17.0（tests）
- Bundle ID: `kidneyweakx.airmeishi`

## Project Structure

```
airmeishi/
├── airmeishi/                   # Main app target
│   ├── airmeishiApp.swift       # App entry, deep linking, CloudKit setup
│   ├── AppDelegate.swift        # CloudKit notification handling
│   ├── Models/                  # Data models
│   │   ├── BusinessCard.swift   # Core card model with privacy controls
│   │   ├── Contact.swift        # Received card wrapper (legacy Codable)
│   │   ├── IdentityEntities.swift # SwiftData: ContactEntity, IdentityCardEntity, ProvableClaimEntity
│   │   ├── Credentials/         # VC-related models
│   │   ├── GroupEntities.swift
│   │   ├── SecureMessagingModels.swift
│   │   └── ScanLanguage.swift
│   ├── Services/
│   │   ├── ZK/                  # Zero-Knowledge Proof layer
│   │   │   ├── SemaphoreIdentityManager.swift  # ZK identity (mopro)
│   │   │   ├── SemaphoreGroupManager.swift     # Group Merkle management
│   │   │   ├── MoproProofService.swift         # Passport ZK proof (Mopro → Semaphore → SD-JWT fallback)
│   │   │   ├── ProofGenerationManager.swift    # SD/attribute/range proofs
│   │   │   ├── ProofModels.swift
│   │   │   └── ZKLogger.swift
│   │   ├── Identity/            # DID & credential layer
│   │   │   ├── DIDService.swift               # did:key, did:ethr, did:web
│   │   │   ├── KeychainService.swift          # Secure Enclave + fallback
│   │   │   ├── KeychainService+Generation.swift # Key generation (SE + software)
│   │   │   ├── KeychainService+Pairwise.swift # Per-RP pairwise key management
│   │   │   ├── VCService.swift                # JWT VC issuance & verification
│   │   │   ├── VCLibrary.swift                # Encrypted VC storage
│   │   │   ├── OIDCService.swift              # OID4VP request/response
│   │   │   ├── CredentialIssuanceService.swift # OID4VCI pre-authorized flow
│   │   │   ├── ProofVerifierService.swift     # VP/ZKP local verification
│   │   │   ├── PassportPipelineService.swift   # Passport: MRZ→NFC→ZKP→VC orchestration
│   │   │   ├── NFCPassportReaderService.swift  # NFC chip read (BAC/PACE/DG1/DG2/SOD)
│   │   │   ├── IdentityCoordinator.swift      # State orchestration
│   │   │   ├── BiometricSigningKey.swift       # P-256 ECDSA for VCs
│   │   │   ├── BiometricGatekeeper.swift       # Face ID / passcode auth gate
│   │   │   ├── GroupCredentialService.swift    # Group VC issuance
│   │   │   └── IdentityImportHelper.swift     # Multi-format import
│   │   ├── Sharing/             # P2P exchange layer
│   │   │   ├── ProximityManager.swift         # MPC discovery/session
│   │   │   ├── ProximityManager+Actions.swift # Card send with ZK proof
│   │   │   ├── ProximityManager+SessionDelegate.swift  # Receive & verify
│   │   │   ├── ProximityPayload.swift         # Exchange data structure
│   │   │   ├── WebRTCManager.swift            # WebRTC data channel
│   │   │   ├── MessageService.swift           # Server-based messaging
│   │   │   ├── SecureKeyManager.swift         # X25519/Ed25519 keys
│   │   │   └── SecureMessageStorage.swift
│   │   ├── CloudKit/            # Cloud sync (groups, invites)
│   │   ├── Scan/                # Passport MRZ scanning
│   │   │   └── MRZScannerService.swift        # Vision OCR + TD3 ICAO 9303 parsing
│   │   ├── Card/                # Card CRUD, QR, OCR
│   │   │   ├── CardManager.swift
│   │   │   ├── ContactRepository.swift
│   │   │   ├── QRCodeScanService.swift        # QR decode + envelope handlers
│   │   │   ├── QRCodeGenerationService.swift  # 3 format generators
│   │   │   ├── ScanRouterService.swift        # QR payload routing (OID4VP/VCI/SIOP/JWT)
│   │   │   └── OCRManager.swift               # Vision framework (business card)
│   │   ├── Cache/
│   │   └── Utils/
│   │       ├── KeyManager.swift               # Master key + HKDF (isolated)
│   │       ├── EncryptionManager.swift
│   │       └── DeveloperModeManager.swift
│   └── Views/
│       ├── Common/              # Shared components
│       │   ├── MainTabView.swift              # Root tab view
│       │   ├── TabBarComponents.swift         # Tab enum
│       │   ├── IDView.swift                   # Identity view (3-layer)
│       │   └── ProximitySharingView.swift
│       ├── CardViews/           # Card creation, editing
│       ├── MatchViews/          # P2P proximity matching UI
│       ├── PeopleViews/         # Contact list & detail
│       ├── MeViews/             # Own card + identity
│       ├── ScanViews/           # QR scanner + OID4VP/VCI flows
│       │   ├── ScanTabView.swift              # Camera + ProofPresentationFlowSheet
│       │   └── CredentialImportFlowSheet.swift # OID4VCI import UI
│       ├── Onboarding/          # Onboarding flow
│       │   ├── OnboardingFlowView.swift       # 6-step onboarding (welcome→profile→avatar→keys→contacts→complete)
│       │   ├── PassportOnboardingFlowView.swift # Passport scan sub-flow (dev mode only)
│       │   └── MRZCameraView.swift            # Passport MRZ camera UI
│       ├── IDViews/             # Identity/group management
│       ├── ShoutoutViews/       # Social messaging (Sakura)
│       └── SettingsViews/
├── airmeishiClip/               # App Clip target
├── airmeishiTests/              # Unit tests
└── airmeishiUITests/
```

## Dependencies (Swift Package Manager)

| Package | Source | Purpose |
|---------|--------|---------|
| SemaphoreSwift | zkmopro/SemaphoreSwift (main) | ZK proof protocol (mopro) |
| SpruceKit Mobile | spruceid/sprucekit-mobile (0.12.11) | VC/DID handling |
| WebRTC | stasel/WebRTC (125.0.0) | Real-time P2P data channel |
| Swift Algorithms | apple/swift-algorithms (1.2.1) | Collection algorithms |
| Swift Numerics | apple/swift-numerics (1.1.1) | Numerical types |
| SwiftLintPlugins | SimplyDanny/SwiftLintPlugins (0.62.2) | Linting |

---

## Design System

### Theme — All views must use `Color.Theme.*`

| Token | Purpose |
|-------|---------|
| `pageBg` | Page background (all screens) |
| `cardBg` | Card surfaces |
| `searchBg` | Input / search field backgrounds |
| `divider` | Borders and separators |
| `textPrimary` / `textSecondary` / `textTertiary` | Text hierarchy |
| `terminalGreen` | Success / accent |
| `primaryBlue` | Brand mauve / tab tint |
| `accentRose` / `dustyMauve` | Sakura / decorative |
| `destructive` | Danger red |

**Do NOT use**: `Color.black`, `Color(.systemGroupedBackground)`, `.foregroundColor(.primary)` in custom views. Always use the semantic theme tokens above.

### Typography

- Terminal / monospaced aesthetic: section headers use `.system(size: 12, weight: .bold, design: .monospaced)`
- Page titles: `.system(size: 28-32, weight: .bold, design: .monospaced)`
- Body: `.system(size: 14)` with `Color.Theme.textSecondary`
- Captions: `.system(size: 10-12, design: .monospaced)`

### Card Pattern

```swift
.padding(16)
.background(Color.Theme.searchBg)  // or cardBg
.overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
```

### Button Styles

- `ThemedPrimaryButtonStyle()` — Primary CTA (dark bg, white text)
- `ThemedInvertedButtonStyle()` — Inverted (white bg, black text)
- `ThemedSecondaryButtonStyle()` — Translucent secondary
- `ThemedDottedOutlineButtonStyle()` — Dashed outline
- `ThemedDestructiveButtonStyle()` — Red destructive

---

## Architecture Notes

### Key Management — Three Systems

1. **`KeychainService`** (Primary) — Secure Enclave P-256 keys for DID/VC signing, per-RP pairwise keys, iCloud sync. Tags: `solidarity.master`, `solidarity.rp.{domain}`
2. **`KeyManager`** (Secondary) — Symmetric master key + HKDF + P-256 signing pair. Used by `ProofGenerationManager`, exchange signing
3. **`SecureKeyManager`** (Messaging) — Curve25519 Ed25519/X25519. **In-memory only** (TODO: persist)

### Proof Systems (Three Independent)

1. **`MoproProofService`** — Passport ZK proofs. Fallback chain: Mopro(deferred) → Semaphore → SD-JWT
2. **`SemaphoreIdentityManager`** — Real Semaphore ZK proofs (group membership, mopro-based)
3. **`ProofGenerationManager`** — Custom selective disclosure (SHA256 + ECDSA, NOT true ZK). Used by QR generation

### Trust Model

| Level | Badge | Source | Verification |
|-------|-------|--------|-------------|
| L3 Government | green | Passport NFC | ZKP (mopro) or NFC |
| L2 Institution | blue | TLSNotary (v2) | TLS transcript proof |
| L1 Self-issued | white | User-provided | None |

### Messaging Backend

- Server: `https://bussiness-card.kidneyweakx.com`
- E2E encrypted: ChaCha20-Poly1305 + X25519 key agreement + Ed25519 signatures

---

## Implementation Status

### What Works End-to-End

1. **Business card** — CRUD, 3 QR formats (plaintext / ZK selective / DID-signed JWT VC)
2. **QR scanning** — parse → route (OID4VP/OID4VCI/SIOP/VP token) → verify → save contact
3. **Proximity exchange** — MPC discovery → per-field scope → request/accept → ephemeral messages (140 char) → exchange signatures stored
4. **Semaphore ZK** — identity create → group membership proof → verify
5. **JWT VC** — biometric auth → ECDSA-P256 sign → encrypted storage → verification
6. **OID4VP** — scan `openid4vp://` → parse → biometric gate → VC with per-RP pairwise DID → VP envelope → submit
7. **OID4VCI** — scan `openid-credential-offer://` → parse → biometric gate → token exchange → credential with proof of possession → store
8. **Passport pipeline** — MRZ OCR → NFC chip read → Semaphore proof (v1) → VC persist (dev mode only)
9. **Secure messaging** (Sakura) — E2E ChaCha20-Poly1305 via server relay
10. **Onboarding** — Welcome → Profile → Avatar → Keys (Face ID) → Import Contacts → Complete
11. **DID** — did:key from P-256 + per-RP pairwise key generation + DID routing

### Known Gaps

| Gap | Detail | Priority |
|-----|--------|----------|
| Passport not in main onboarding | `PassportOnboardingFlowView` only accessible via Developer Mode | MEDIUM |
| CSCA Master List missing | `NFCPassportReaderService` 未設定 `masterListURL` → `passiveAuthPassed` 永遠 false → 無法驗證護照真偽 | HIGH |
| OpenPassport deferred | v1 uses Semaphore proof; Mopro FFI not linked, circuit files missing | HIGH |
| VP envelope not signed | JSON VP object, not signed JWT per OID4VP spec | MEDIUM |
| Exchange uses wrong key | `KeyManager` master key instead of DID pairwise key | MEDIUM |
| SecureKeyManager volatile | Curve25519 keys in-memory only, regenerated each launch | HIGH |
| Semaphore sync stubbed | `syncRootFromNetwork()` / `pushUpdatesToNetwork()` return false | HIGH |
| Contact merge silent | Auto-deduplicates by businessCard.id, no UI merge prompt | LOW |
| SharingLevel still in services | `SharingLevel` enum kept for backward compat; services/tests still reference it | LOW |
| Legacy Contact struct | `Contact.swift` (Codable) lacks spec fields; only `ContactEntity` has them | LOW |

### Known TODOs in Code

| File | Issue | Priority |
|------|-------|----------|
| `SemaphoreGroupManager.swift` | Network sync stubbed (needs CloudKit CKShare) | HIGH |
| `SemaphoreIdentityManager.swift:111` | External commitment conversion incomplete | HIGH |
| `GroupCredentialService.swift:142` | Proof signal verification not implemented | HIGH |
| `SecureKeyManager.swift:25` | Keychain storage not implemented | HIGH |
| `NFCPassportReaderService.swift` | 未設定 `masterListURL`，需載入 CSCA Master List | HIGH |
| `MoproProofService.swift:107` | Circuit files missing, always falls back to SD-JWT | HIGH |
| `ProximityManager+Actions.swift` | Exchange signing uses wrong key hierarchy | MEDIUM |
| `ScanTabView.swift:398` | VP envelope is JSON, not signed JWT | MEDIUM |
| `ProofVerifierService.swift` | No issuer signature verification | MEDIUM |
| `PassportOnboardingFlowView` | Not integrated in main onboarding flow | MEDIUM |

---

## Spec Reference

> Source: `Solid(ar)ity App — Product Specification v1.0` (2026-02-17)

### Core Value Proposition

1. **Face-to-face authenticated contact graph** — cryptographic signatures as reputation/voting primitive
2. **Ichigo-ichie** — bidirectional ephemeral messages during exchange (max 140 chars)
3. **ZKP proofs + zero infrastructure** — App-to-App local ZK verification

### User Journeys

**Onboarding**: Welcome → Keychain Setup (required) → Import Contacts (skip) → Scan Passport (skip) → Complete

**Passport Scan**: MRZ Camera → NFC Chip Read → ZK Proof Generation → Credential Created

**Face-to-Face Exchange**: Discovery (MPC) → Confirm Scope → Wait/Accept → Exchange Success (ichigo-ichie + DID signatures) → Contact Saved

**Present Proof**: Scan QR / Self-initiated → Review Request → Biometric + Sign → Submit VP Token → Success

### Spec Tab Structure (v1.2)

```
People (person.2.fill) | Share (dot.radiowaves.up.forward) | Me (person.text.rectangle)
```

- **Share tab** = `SharingTabView`（radar/orbit peer discovery + QR）
- QR scanner 從 sheet 開啟（Share tab 內的 "Scan QR" 按鈕），不是獨立 tab
- `ScanTabView` 仍存在，但作為 `.sheet` 使用

### Share Tab Layout

```
┌────────────────────────────────┐
│       [Radar / Orbit view]     │  ← hero, MPC peer discovery
│       [Start / Stop Matching]  │
│                                │
│          ┌──────────┐          │
│          │  QR Code  │          │  ← VP format, reflects share settings
│          └──────────┘          │
│       ⚙️ Share Settings →      │  ← NavigationLink → ShareSettingsView
│                                │
│   [Scan QR]      [My QR]      │  ← quick actions
└────────────────────────────────┘
```

### Share Settings（獨立頁面，從 Share tab 跳轉）

```
── Share Fields ──
✅ Name         (locked, always on)
⬜ Title
⬜ Company
⬜ Email
⬜ Phone

── Proofs ──
✅ Real Human    (default on, if passport claim exists)
⬜ Age 18+       (if passport claim exists)
```

- 以 `@AppStorage` 持久化用戶的欄位選擇
- QR payload = VP（Verifiable Presentation），包含選取的 card fields + proof badges
- **取消 `SharingLevel`**（public/professional/personal）— 改為逐欄位 toggle，預設最少資訊（僅 name）
- `ShareCardPickerSheet` 由 `ShareSettingsView` 取代

### Spec Data Models

```swift
@Model class Contact {
    var name: String
    var isVerified: Bool = false
    var myEphemeralMessage: String?      // ichigo-ichie: my message
    var theirEphemeralMessage: String?   // ichigo-ichie: their message
    var didPublicKey: String?
    var exchangeSignature: Data?         // their signature
    var myExchangeSignature: Data?       // my signature (for v2 Graph Export)
    var exchangeTimestamp: Date?
    var source: String                   // "imported" | "exchanged" | "manual"
}

@Model class IdentityCard {
    var type: String                 // "passport" | "student" | "socialGraph" | "imported"
    var trustLevel: String           // "government" | "institution" | "selfIssued"
    var issuerName: String
    var rawVC: Data
    @Relationship var derivedProofs: [ProvableClaim]
}

@Model class ProvableClaim {
    var label: String                // e.g. "Age >= 18"
    var claimType: String            // "age_over_18" | "verified_contact_count"
    var proofType: String            // "zkp" | "sdJwt" | "selfIssued"
    @Relationship(inverse: \IdentityCard.derivedProofs) var sourceCredential: IdentityCard?
}
```

### Face ID Rules

**Must trigger**: passport save, face-to-face exchange, present proof, SIOPv2 login, delete credential, export data
**No trigger**: browse contacts, view credential details, change settings, import VCF

### v1 MVP Scope

| # | Feature | Priority |
|---|---------|----------|
| 1 | Keychain + Key generation | P0 |
| 2 | Passport scan + ZKP | P0 |
| 3 | Age/human proofs | P0 |
| 4 | VCF contact import | P0 |
| 5 | Face-to-face exchange + verified | P0 |
| 6 | Ichigo-ichie (bidirectional 140 chars) | P0 |
| 7 | Proof presentation (OID4VP) | P0 |
| 8 | Proof verification (QR scan) | P0 |
| 9 | 3-Tab navigation (People/Share/Me) | P0 |
| 10 | iCloud backup | P1 |
| 11 | Full onboarding flow | P1 |

### Deferred

- OpenPassport Noir circuits (v1 uses Semaphore + SD-JWT fallback)
- Reclaim Protocol
- Group (Semaphore) management
- DIDComm / Credit card NFC / Ticket as VC

---

## CSCA Master List — Passport 驗證

### 問題

`NFCPassportReaderService` 呼叫 `PassportReader()` 時未設定 `masterListURL`。沒有 CSCA Master List，NFC 能讀資料但**無法驗證護照真偽**（`passiveAuthPassed` 永遠 `false`）。

### 驗證鏈

```
CSCA 根憑證（每國一把）→ Document Signer 憑證 → SOD 簽名 → DG1/DG2 hash
```

### Open Source CSCA 來源

| 來源 | 覆蓋 | 格式 | 授權 | 備註 |
|------|------|------|------|------|
| **Self (OpenPassport)** `selfxyz/self` | ~100 國 CSCA | TS/PEM (MIT) | MIT | `common/src/constants/skiPem.ts`，最完整的開源方案 |
| **ICAO PKD** `download.pkd.icao.int` | ~250 國 | LDIF/CMS | 禁止再散布 | 官方來源，需用 `extract.py` 轉 PEM |
| **JMRTD** `jmrtd.org/certificates.shtml` | ~16 國 | DER (.cer) | LGPL | 許多已過期 |
| **各國自行發布** (DE BSI, FR, IT) | 單國 | CMS (.ml) | 各異 | 需逐國取得 |

### 整合方式（NFCPassportReader）

```swift
let reader = PassportReader()
reader.setMasterListURL(Bundle.main.url(forResource: "masterList", withExtension: "pem")!)
```

**建立 `masterList.pem`**：
1. 從 ICAO PKD 下載 LDIF，或從 Self 專案轉出 PEM
2. 用 NFCPassportReader 的 `scripts/extract.py` 轉換：`python extract.py icaopkd.ldif`
3. 產出的 `masterList.pem` 放入 app bundle

### 推薦方案

**Self (OpenPassport) `selfxyz/self`** — MIT 授權，~100 國覆蓋，與未來 OpenPassport Noir circuit 整合最相容。需將 `skiPem.ts` 的 base64 憑證轉為 concatenated PEM 檔。也提供 remote API：`https://tree.self.xyz/csca`。
