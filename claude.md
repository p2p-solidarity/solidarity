# Solidarity - Claude Code Instructions

## Rules

- **禁止建立重複的功能或頁面**：不要新增與現有功能/頁面重複的 View 或邏輯。修改前先確認是否已有相同功能存在，優先複用或擴充現有程式碼。
- **不要加假資料**：禁止在正式程式碼中使用 hardcoded sample/mock/dummy data。`.sample` 僅限 SwiftUI Preview 使用。
- **先讀再改**：修改任何檔案前必須先讀取該檔案，了解現有邏輯再動手。

## Build

```bash
xcodebuild -project solidarity.xcodeproj -scheme solidarity \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  build -skipPackagePluginValidation
```

- 必須加 `-skipPackagePluginValidation`（SwiftLint plugin 問題）
- iOS Deployment Target: 18.6（主 app）/ 17.0（tests）
- Bundle ID: `kidneyweakx.airmeishi`

## Project Structure

```
solidarity/
├── solidarity/                  # Main app target
│   ├── SolidarityApp.swift      # App entry, deep linking, CloudKit setup
│   ├── AppDelegate.swift        # CloudKit notification handling
│   ├── Models/                  # Data models
│   │   ├── BusinessCard.swift / BusinessCard+Extensions.swift # Core card + sharing prefs
│   │   ├── Contact.swift        # Received card wrapper (legacy Codable)
│   │   ├── IdentityEntities.swift # SwiftData: ContactEntity, IdentityCardEntity, ProvableClaimEntity
│   │   ├── AnimalCharacter.swift / CardError.swift / SharingFormat.swift / ScanLanguage.swift
│   │   ├── EventParticipation.swift / GroupCredentialContext.swift / GroupCredentialDeliverySettings.swift
│   │   ├── CloudKitGroupModels.swift / GroupEntities.swift / SecureMessagingModels.swift
│   │   ├── Credentials/         # BusinessCardCredential.swift
│   │   ├── OIDC/                # OIDCScope.swift
│   │   └── Vault/               # VaultModels.swift, TimeLockConfig.swift
│   ├── Services/
│   │   ├── ZK/                  # Zero-Knowledge Proof layer
│   │   │   ├── SemaphoreIdentityManager.swift  # ZK identity (mopro)
│   │   │   ├── SemaphoreGroupManager.swift     # Group Merkle management
│   │   │   ├── MoproProofService.swift         # Passport ZK proof (Mopro → Semaphore → SD-JWT fallback)
│   │   │   ├── ProofGenerationManager.swift    # SD/attribute/range proofs
│   │   │   ├── ProofModels.swift
│   │   │   └── ZKLogger.swift
│   │   ├── Identity/            # DID & credential layer
│   │   │   ├── DIDService.swift / DIDKeyResolver.swift / DIDDocumentExporter.swift
│   │   │   ├── KeychainService.swift (+Generation/+Pairwise/+KeyUtilities)
│   │   │   ├── VCService.swift (+JWT)         # JWT VC issuance & verification
│   │   │   ├── VCLibrary.swift                # Encrypted VC storage
│   │   │   ├── OIDCService.swift (+Helpers/+Response/+Submit) # OID4VP req/resp + JARM
│   │   │   ├── OID4VPPresentationService.swift
│   │   │   ├── ProofVerifierService.swift (+VPToken) # VP/ZKP local verification
│   │   │   ├── PassportPipelineService.swift  # Passport: MRZ→NFC→ZKP→VC orchestration
│   │   │   ├── NFCPassportReaderService.swift # NFC chip read (BAC/PACE/DG1/DG2/SOD) + masterListURL
│   │   │   ├── IdentityCoordinator.swift (+Import/+Issuance/+OIDC/+Verification)
│   │   │   ├── IdentityCacheStore.swift / IdentityState.swift
│   │   │   ├── BiometricSigningKey.swift / BiometricGatekeeper.swift
│   │   │   ├── BusinessCardCredentialEnvelope.swift
│   │   │   ├── GroupCredentialService.swift / GroupCredentialDeliveryService.swift
│   │   │   ├── IdentityImportHelper.swift
│   │   │   ├── SensitiveActionPolicyStore.swift / IssuerTrustAnchorStore.swift
│   │   │   └── VerifiedClaimIndex.swift
│   │   ├── OIDC/                # OID4VCI issuance flow
│   │   │   ├── CredentialIssuanceService.swift (+Proof)
│   │   │   ├── CredentialIssuanceModels.swift
│   │   │   ├── OIDCRequestHandler.swift
│   │   │   └── OIDCTokenService.swift
│   │   ├── Sharing/             # P2P exchange layer
│   │   │   ├── ProximityManager.swift (+Actions/+Discovery/+Exchange/+SessionDelegate/+Types)
│   │   │   ├── ProximityPayload.swift / ProximityEvents.swift / ProximityDebug.swift / ProximityVerificationHelper.swift
│   │   │   ├── GroupProximityManager.swift
│   │   │   ├── NearbyInteractionManager.swift (+Delegate/+Types)
│   │   │   ├── AirDropManager.swift / PassKitManager.swift (+Generation)
│   │   │   ├── WebRTCManager.swift            # WebRTC data channel
│   │   │   ├── MessageService.swift           # Server-based messaging
│   │   │   ├── SecureKeyManager.swift         # X25519/Ed25519, persisted in Keychain
│   │   │   ├── SecureMessageStorage.swift
│   │   │   ├── ShareLinkManager.swift / ShareScopeResolver.swift / ShareSettingsStore.swift
│   │   │   └── ZIPWriter.swift
│   │   ├── CloudKit/            # Cloud sync (groups, invites)
│   │   ├── Scan/                # Passport MRZ scanning + QR routing
│   │   │   ├── MRZScannerService.swift        # Vision OCR + TD3 ICAO 9303 parsing
│   │   │   └── ScanRouterService.swift        # QR payload routing (OID4VP/VCI/SIOP/JWT)
│   │   ├── Card/                # Card CRUD, QR, OCR
│   │   │   ├── CardManager.swift / ContactRepository.swift
│   │   │   ├── QRCodeScanService.swift (+Handlers/+Verification)
│   │   │   ├── QRCodeGenerationService.swift / QRCodeManager.swift / QRCodeModels.swift
│   │   │   └── OCRManager.swift               # Vision framework (business card)
│   │   ├── Backup/              # BackupManager.swift
│   │   ├── Contacts/            # ContactImportService.swift (VCF/system contacts)
│   │   ├── Importer/            # TwitterArchiveImporter (+Models/+Parsing) + StreamParser
│   │   ├── Recovery/            # IdentityRecoveryService.swift
│   │   ├── SocialGraph/         # SocialGraphPrepServices + ProximityManager+GraphPrep
│   │   ├── Vault/               # SovereignVault, Shamir, file encryption, ZK age verification
│   │   ├── Cache/
│   │   └── Utils/               # KeyManager (+Keychain), EncryptionManager, DeveloperModeManager,
│   │                            # ThemeManager, DeepLinkManager, NotificationSettingsManager, etc.
│   └── Views/
│       ├── Common/              # Shared components
│       │   ├── MainTabView.swift              # Root tab view (People / Share / Me)
│       │   ├── TabBarComponents.swift         # MainAppTab enum + CustomFloatingTabBar
│       │   ├── ReceivedCardView.swift / ContactPickerView.swift / VCFDocumentPicker.swift
│       │   ├── ThemedButtonStyles.swift / SakuraIconView.swift / DecorativeBlobs.swift
│       │   ├── AdaptiveLayout.swift / RippleButton.swift / CryptoCompilingOverlay.swift
│       │   └── Toast/ (toast overlay)
│       ├── CardViews/           # Card creation, editing, wallet pass generation
│       ├── MatchViews/          # P2P proximity matching UI (radar/orbit, share-link, QR)
│       │   └── Matching/        # MatchingRootView, ShareCardPickerSheet, peer popups, etc.
│       ├── PeopleViews/         # Contact list & detail (PeopleListView, PersonDetailView, TrustGraphContactRow)
│       ├── MeViews/             # MeTabView (+Sections) + MeTabComponents + CredentialDetailView
│       ├── ScanViews/           # QR scanner + OID4VP/VCI flows
│       │   ├── ScanTabView.swift              # Camera scan entry (presented as sheet)
│       │   ├── ProofPresentationFlowSheet.swift / VerifierResultSheet.swift
│       │   └── CredentialImportFlowSheet.swift # OID4VCI import UI
│       ├── SharingViews/        # Share tab (SharingTabView, RadarMatchingView, ShareSettingsView, ProximitySharingView)
│       ├── Onboarding/          # 7-step onboarding: welcome → profile → avatar → keys → contacts → scanPassport → complete
│       │   ├── OnboardingFlowView.swift (+Steps)
│       │   ├── TerminalWelcomeScreen.swift / DarkProfileSetupForm.swift / AvatarSelectionGrid.swift
│       │   ├── PassportOnboardingFlowView.swift (+Steps) + PassportPipelineViewModel.swift
│       │   └── MRZCameraView.swift            # Passport MRZ camera UI
│       ├── IDViews/             # Identity/group management (GroupDetailView, ZKSettingsView, etc.)
│       ├── ShoutoutViews/       # Social messaging (Sakura)
│       └── SettingsViews/
├── solidarityClip/              # App Clip target
├── solidarityTests/             # Unit tests
└── solidarityUITests/
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
2. **`KeyManager`** (Secondary) — Symmetric master key + HKDF + P-256 signing pair. Used by `ProofGenerationManager` for selective-disclosure signing
3. **`SecureKeyManager`** (Messaging + proximity exchange signing) — Curve25519 Ed25519/X25519. Persisted in Keychain (`solidarity.messaging.signing` / `solidarity.messaging.encryption`). `mySealedRoute` lives in `UserDefaults`.

### Proof Systems (Three Independent)

1. **`MoproProofService`** — Passport ZK proofs. Fallback chain: OpenPassport (Mopro/Noir) → Semaphore → SD-JWT, gated at runtime by a crash sentinel and bundle-resource check (`openpassport_disclosure.acir` + `openpassport_srs.bin`)
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
6. **OID4VP** — scan `openid4vp://` → parse → biometric gate → VC with per-RP pairwise DID → VP envelope → submit (`direct_post` and `direct_post.jwt`/JARM-signed responses)
7. **OID4VCI** — scan `openid-credential-offer://` → parse → biometric gate → token exchange → credential with proof of possession → store
8. **Passport pipeline** — MRZ OCR → NFC chip read (with CSCA Master List) → OpenPassport (Mopro) → Semaphore → SD-JWT fallback chain → VC persist; integrated into onboarding
9. **Secure messaging** (Sakura) — E2E ChaCha20-Poly1305 via server relay; Curve25519 keys persisted in Keychain
10. **Onboarding** — Welcome → Profile → Avatar → Keys (Face ID) → Import Contacts → Scan Passport → Complete (7 steps)
11. **DID** — did:key from P-256 + per-RP pairwise key generation + DID routing

### Known Gaps

| Gap | Detail | Priority |
|-----|--------|----------|
| OpenPassport native prover stability | Circuit (`openpassport_disclosure.acir`) and SRS (`openpassport_srs.bin`) ship in bundle; runtime gated by crash sentinel + Semaphore/SD-JWT fallback | MEDIUM |
| Exchange signing key hierarchy | `ProximityManager` signs with `SecureKeyManager` (Curve25519 Ed25519), not the per-RP pairwise DID key | MEDIUM |
| Semaphore sync stubbed | `SemaphoreGroupManager.syncRootFromNetwork()` / `pushUpdatesToNetwork()` return false (needs CloudKit/CKShare or chain hookup) | HIGH |
| Issuer signature verification | `ProofVerifierService` does not yet verify the issuer's signature on presented VCs | MEDIUM |
| Contact merge silent | Auto-deduplicates by businessCard.id, no UI merge prompt | LOW |
| SharingLevel still in services | `SharingLevel` enum kept for backward compat; ~30 files still reference it (and `ShareCardPickerSheet` is wired up alongside `ShareSettingsView`) | LOW |
| Legacy Contact struct | `Contact.swift` (Codable) lacks spec fields; only `ContactEntity` has them | LOW |

### Recently Resolved (was in earlier gap list)

- **CSCA Master List** — `solidarity/Resources/masterList.pem` ships in bundle and is wired via `reader.setMasterListURL(...)` in `NFCPassportReaderService`.
- **OpenPassport circuits present** — `openpassport_disclosure.acir` and `openpassport_srs.bin` ship in bundle; `MoproProofService.isAvailable` checks both files plus a crash sentinel.
- **VP envelope signing** — `OIDCService+Response.swift` now supports `direct_post.jwt` (JARM) responses signed with the per-RP pairwise key.
- **SecureKeyManager persisted** — `SecureKeyManager` now reads/writes Curve25519 signing & encryption keys to Keychain via `kSecClassGenericPassword` queries.
- **Passport in main onboarding** — `OnboardingFlowView` adds a `.scanPassport` step between contacts import and the completion screen; no longer dev-mode-only.

### Known TODOs in Code

> Verified against the source tree on 2026-04-26. Line numbers checked against current files.

| File | Issue | Priority |
|------|-------|----------|
| `Services/ZK/SemaphoreGroupManager.swift:285,295` | `syncRootFromNetwork()` / `pushUpdatesToNetwork()` are stubs ("Replace with real on-chain or API fetch/push") | HIGH |
| `Views/IDViews/ZKSettingsView.swift:55` | `// TODO: Implement identity deletion` | MEDIUM |
| `Views/IDViews/GroupDetailView+Subviews.swift:162` | `// TODO: Generate Proof` (group proof from detail screen) | MEDIUM |
| `Views/CardViews/WalletPassGeneration/WalletPassGenerationComponents.swift:225` | Implement signed `.pkpass` bundle (manifest + signature + images) | MEDIUM |
| `Views/MatchViews/Matching/MatchingRootView.swift:124` | Add local visual effect on connect | LOW |
| `Views/PeopleViews/PeopleListView.swift:233` | Wire up dedicated manual-add contact flow | LOW |

---

## Spec Reference

> Source: `Solid(ar)ity App — Product Specification v1.0` (2026-02-17)

### Core Value Proposition

1. **Face-to-face authenticated contact graph** — cryptographic signatures as reputation/voting primitive
2. **Ichigo-ichie** — bidirectional ephemeral messages during exchange (max 140 chars)
3. **ZKP proofs + zero infrastructure** — App-to-App local ZK verification

### User Journeys

**Onboarding** (current code, 7 steps): Welcome → Profile Setup → Avatar Setup → Secure Keys (Face ID) → Import Contacts (skip) → Scan Passport (skip) → Complete

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
- 規劃方向：取消 `SharingLevel`（public/professional/personal），改為逐欄位 toggle，預設最少資訊（僅 name）
- 現況：`SharingLevel` enum 仍保留並被 ~30 個檔案引用（向下相容）；`ShareCardPickerSheet` 與新的 `ShareSettingsView` 並存（前者由 `MatchingRootView` 使用，後者由 `SharingTabView` / `SettingsView` 使用）

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

### 現況（已實作）

`NFCPassportReaderService.read(...)` 會在建立 `PassportReader` 後呼叫
`reader.setMasterListURL(Bundle.main.url(forResource: "masterList", withExtension: "pem")!)`，
bundle 內的 `solidarity/Resources/masterList.pem` 即是聚合後的 CSCA 憑證集。
若日後要更新涵蓋國家或更新到期憑證，只需替換這份 `masterList.pem` 即可。

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
