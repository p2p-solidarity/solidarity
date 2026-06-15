# 04 — Native iOS Capabilities + Entitlements Ledger

Generated 2026-05-24 by Explore agent. Source: `solidarity/solidarity.entitlements`, `Info.plist`, `PrivacyInfo.xcprivacy`, `solidarityClip/`, `solidarity.xcodeproj/`, `AppDelegate.swift`, `SolidarityApp.swift`, `Localizable.xcstrings`, `scripts/`, `ci_scripts/`.

---

## 1. Entitlements (`solidarity.entitlements`)

| Entitlement | Purpose | Expo / RN equivalent |
|---|---|---|
| `aps-environment` | Push notifications (APNs) | `expo-notifications` + EAS config (Android: FCM via `@react-native-firebase/messaging`) |
| `com.apple.developer.associated-domains` | Universal links (`applinks:solidarity.gg`) | `expo-linking` + config-plugin for AASA / assetlinks.json |
| `com.apple.developer.icloud-container-identifiers` | CloudKit container `iCloud.$(CFBundleIdentifier)` | **iOS Nitro bridge** (kept per user decision) |
| `com.apple.developer.icloud-services` | CloudDocuments + CloudKit | **iOS Nitro bridge** |
| `com.apple.developer.nfc.readersession.formats` | NFC TAG reading | Nitro (`react-native-nfc-manager` insufficient for ICAO BAC/PACE) |
| `com.apple.developer.pass-type-identifiers` | Wallet pass (`.pkpass`) | iOS-only Nitro (Android = Google Wallet REST or QR fallback) |

## 2. Info.plist privacy strings & URL schemes

### Main app
| Key | Value | Expo mapping |
|---|---|---|
| `NSCameraUsageDescription` | "scan QR codes and business cards" | `expo-camera` + `react-native-vision-camera` (v5) |
| `NSContactsUsageDescription` | "save business card information" | `expo-contacts` |
| `NSLocalNetworkUsageDescription` | "discover and connect with nearby devices" | Nitro (mDNS via NSNetServiceBrowser) |
| `NSNearbyInteractionUsageDescription` | "distance and direction of nearby devices" | iOS Nitro only (Android UWB API 31+ separate) |
| `NFCReaderUsageDescription` | "Read passport's NFC chip" | Nitro |
| `NSFaceIDUsageDescription` | "protect identity keys, authorize actions" | `expo-local-authentication` |
| `NSPhotoLibraryUsageDescription` | "save QR codes and business card images" | `expo-media-library` |
| `CFBundleURLTypes` | `solidarity://`, `airmeishi://`, `openid-credential-offer://` | `expo-linking` |
| `NSBonjourServices` | `_say-share._tcp.`, `_airmeishi-share._tcp.` | Nitro (mDNS) |

### App Clip (`solidarityClip/Info.plist`)
| Key | Value | Expo |
|---|---|---|
| `NSBonjourServices` | same as main | **N/A — App Clip is iOS-only, kept in `solidarityClip/`** |
| `NSCameraUsageDescription` / `NSContactsUsageDescription` | … | … |
| `NSAppClip.NSAppClipRequestEphemeralUserNotification` | `false` | … |

## 3. Privacy manifest (`PrivacyInfo.xcprivacy`)

| Privacy API | Reason | Purpose |
|---|---|---|
| `NSPrivacyAccessedAPICategoryUserDefaults` | CA92.1 | Local app prefs (no tracking) |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | C617.1 | Local file ops |
| `NSPrivacyAccessedAPICategorySystemBootTime` | 35F9.1 | Timestamp for app functionality |
| `NSPrivacyAccessedAPICategoryDiskSpace` | E174.1 | Display available storage |
| `NSPrivacyTracking` | `false` | App does NOT track users |
| `NSPrivacyTrackingDomains` | (empty) | No tracking domains |
| `NSPrivacyCollectedDataTypes` | (empty) | No data collection |

**Android counterpart**: replicate `NSPrivacyAccessedAPI*` in Google Play Data Safety form.

## 4. App Clip (`solidarityClip/`)
| Aspect | Value | Status |
|---|---|---|
| Bundle ID | `$(PRODUCT_BUNDLE_IDENTIFIER).Clip` | iOS-only |
| Associated Domain | inherited from main app | Deep-link via URL schemes |
| Services | Bonjour | Proximity sharing |
| **Android equivalent** | **None** (Instant Apps deprecated) | Keep `solidarityClip/` as iOS-only target; Android gets full app install |

## 5. SPM packages & frameworks

| Package | Repo | Version | Purpose | Expo / RN replacement |
|---|---|---|---|---|
| SemaphoreSwift | github.com/zkmopro/SemaphoreSwift | dynamic | ZK identity proofs (mopro) | Nitro wrapper |
| WebRTC | github.com/stasel/WebRTC.git | dynamic | P2P data transfer | `react-native-webrtc` + Nitro shim if needed |
| SpruceIDMobileSdkRs | github.com/spruceid/sprucekit-mobile | dynamic | W3C VC ops (Rust FFI) | Nitro wrapper (or `@spruceid/mobile-sdk-rs` wasm if perf OK) |
| NFCPassportReader | github.com/AndyQ/NFCPassportReader | dynamic | ICAO passport MRZ + NFC | Nitro: reuse iOS lib + jmrtd JNI on Android |
| OpenPassportSwift (passport-noir) | github.com/p2p-solidarity/passport-noir | ^1.0.0-beta.8 | Noir ZK + mopro proving | **Wrap as `nitro-modules/passport-zk/`** |
| SwiftLintPlugins | (build plugin) | — | Lint (dev only) | ESLint (TS side) |

Built-in iOS frameworks in use: `CloudKit`, `UIKit`, `SwiftUI`, `AVFoundation`, `Vision`, `VisionKit`, `PassKit`, `MultipeerConnectivity`, `NearbyInteraction`, `LocalAuthentication`, `Security`, `CryptoKit`, `CommonCrypto`, `Contacts`, `ContactsUI`, `PhotosUI`, `UniformTypeIdentifiers`, `UserNotifications`, `Network`, `SwiftData`, `AppIntents` (imported, no active use).

## 6. AppDelegate lifecycle hooks

| Hook | Implementation | Expo equivalent |
|---|---|---|
| `application(_:didFinishLaunchingWithOptions:)` | Push setup, badge clear, storage check | `expo-notifications` + Firebase init |
| `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` | Extract APNs token, seal for Sakura | `expo-notifications` token listener (Android: FCM token) |
| `application(_:didFailToRegisterForRemoteNotificationsWithError:)` | Clear sealed route on APNs failure | Error handler in notification setup |
| `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)` | CloudKit sync trigger, silent push, message processing | `expo-background-fetch` + messaging adapter |
| `userNotificationCenter(_:willPresent:withCompletionHandler:)` | Foreground notif handling, suppress for active app + message_id | `expo-notifications` foreground listener |
| `userNotificationCenter(_:didReceive:withCompletionHandler:)` | Notif tap, badge clear, message sync | `expo-notifications` response handler |

## 7. SolidarityApp.swift state & handlers

### `@StateObject` singletons
`CardManager.shared`, `ContactRepository.shared`, `ProximityManager.shared`, `DeepLinkManager.shared`, `ThemeManager.shared`, `IdentityDataStore.shared`, `IdentityCoordinator.shared`

→ Expo: Zustand stores (one per domain) seeded inside `app/_layout.tsx` provider.

### Lifecycle handlers
- `.onAppear` → `setupApp()`: permissions, encryption migration, identity init → Expo app init + `useEffect()`
- `.onOpenURL` → `handleIncomingURL()` → `expo-linking` `useLinking()` hook
- `.onContinueUserActivity(NSUserActivityTypeBrowsingWeb)` → universal link → `expo-linking` (Android: Handoff is iOS-only, drop)

### Simulator fallback
Injects dummy sealed token when APNs unavailable. Port: detect `process.env.EXPO_OS === 'ios' && Constants.deviceName?.includes('Simulator')`.

## 8. App Intents / Siri / Spotlight

| Implementation | Status | Expo |
|---|---|---|
| `import AppIntents` | Imported in SolidarityApp.swift, **no active usage** | — |
| Siri Shortcuts | Not implemented | Convert to deep-link routes + `expo-quick-actions` |
| Spotlight indexing | Not implemented | Drop (Android = Firebase App Indexing, separate setup) |

## 9. Localization (`Localizable.xcstrings`)

| Metric | Value |
|---|---|
| Total string keys | ~3,074 |
| File size | 245 KB |
| Source language | English (en) |
| Localized | Traditional Chinese (zh-Hant) |

**Expo migration**: `expo-localization` + `i18next`. Write `scripts/xcstrings-to-i18next.ts` to convert `.xcstrings` → `assets/locales/{en,zh-Hant}.json`.

## 10. Build / CI scripts

| Script | Type | Expo portability |
|---|---|---|
| `scripts/prepare_openpassport_build.sh` | Bash | **Adapt** — runs once in `expo prebuild` step (resolves passport-noir circuits) |
| `scripts/archive_ios_openpassport.sh` | Bash | **Keep iOS, drop Android** — Xcode Cloud handles archive |
| `scripts/generate_masterlist.py` | Python | **Keep** — CSCA cert PEM gen, runs in Xcode Cloud `ci_post_clone.sh` |
| `scripts/run_muter.sh` | Bash | Keep (mutation testing for Swift) |
| `ci_scripts/ci_post_clone.sh` | Bash (root, for Swift) | **Keep** for Swift target; **add new** at `apps/expo/ios/ci_scripts/ci_post_clone.sh` for Expo target |
| `ci_scripts/ci_pre_xcodebuild.sh` | Bash | Adapt: FFI shim gen now runs against Nitro modules |
| `ci_scripts/cloud-overrides.xcconfig` | Xcode config | Keep |

---

## Portability verdict

### (A) Trivially portable via Expo plugin / config
1. Push notifications — `expo-notifications` + Firebase
2. Deep linking — `expo-linking`
3. Camera — `expo-camera` + `react-native-vision-camera` v5 (barcode plugin)
4. Contacts — `expo-contacts`
5. Face ID / Touch ID — `expo-local-authentication`
6. Photo library — `expo-media-library`
7. Orientation control — `expo-screen-orientation`

### (B) Nitro module required
1. **CloudKit** — iOS-only Nitro bridge (kept), Drive on Android via `react-native-cloud-storage`
2. **MultipeerConnectivity** — Nitro: `MCSession` (iOS) + Nearby Connections API (Android)
3. **WebRTC** — `react-native-webrtc` + minor Nitro shim for iOS-specific hooks
4. **NFC passport** — Nitro: `NFCPassportReader` (iOS) + jmrtd JNI (Android)
5. **Semaphore ZK / Mopro** — Nitro wrap `passport-noir/mopro-binding`
6. **SpruceID SDK** — Nitro wrap Rust FFI (or wasm if perf OK)
7. **mDNS / Bonjour** — Nitro
8. **Nearby Interaction (UWB)** — Nitro: iOS NearbyInteraction + Android UWB API 31+

### (C) iOS-only (conditional render for Android)
1. **App Clip** — keep iOS-only target (`solidarityClip/`); Android gets full app install
2. **Apple Wallet `.pkpass`** — iOS via PassKit; Android shows QR fallback (Google Wallet REST integration deferred)
3. **CloudKit sharing (`CKShare`)** — iOS only; Android uses Drive share links instead

### (D) Drop or rebuild as deep link
1. **Siri Shortcuts** — convert to deep-link routes + quick actions
2. **Spotlight indexing** — drop (or Firebase App Indexing separately)

---

## CI / CD strategy — Xcode Cloud + EAS Build (per user direction 2026-05-24)

> **Decision**: keep **Xcode Cloud** for iOS builds — leverages the 25 free hours/month from the Apple Developer account, automates certs via App Store Connect, no EAS Build cost. EAS Build is used for Android only (or `expo run:android` + Play Console direct submit if EAS quota matters).

### iOS — Xcode Cloud + Expo CNG

Pipeline: GitHub push → Xcode Cloud → `ci_post_clone.sh` installs Node + runs `expo prebuild --clean --platform ios` → Xcode compiles + signs + ships to TestFlight.

**Layout** (after `expo prebuild --platform ios` once locally):
```
apps/expo/
├── ios/                       ← generated by `expo prebuild` (gitignored, except ci_scripts)
│   └── ci_scripts/
│       └── ci_post_clone.sh   ← force-tracked: `git add -f`
└── …
```

**`apps/expo/ios/ci_scripts/ci_post_clone.sh`**:
```bash
#!/bin/sh
set -e
echo "▸ cd to repo root"
cd "$CI_PRIMARY_REPOSITORY_PATH"

echo "▸ install Node via Homebrew"
brew install node

echo "▸ install workspace deps (bun)"
brew install oven-sh/bun/bun || true
cd apps/expo
bun install

echo "▸ regenerate iOS native project from Expo config"
bunx expo prebuild --clean --platform ios

echo "✓ ready — Xcode Cloud takes over for archive + sign + TestFlight"
```

**`.gitignore` rules**:
- `apps/expo/ios/` — gitignored (regenerated by prebuild)
- `apps/expo/ios/ci_scripts/` — **force-tracked** via `git add -f`
- `apps/expo/android/` — gitignored (regenerated by prebuild)

**Permissions**: `chmod +x apps/expo/ios/ci_scripts/ci_post_clone.sh` before committing.

**Workflow setup**: in Xcode → Product → Xcode Cloud → Create Workflow. Connect GitHub. Branch trigger + TestFlight action. Certs auto-managed via App Store Connect.

### Android — EAS Build OR `expo run:android` + Play Console

For Android, EAS Build is the simplest path (~30 builds/month on free tier; paid plan if more). Alternative: `expo prebuild --platform android` locally + `cd apps/expo/android && ./gradlew bundleRelease` + upload to Play Console manually.

### Existing Swift CI (`ci_scripts/` at repo root)
Untouched — used by the legacy `solidarity.xcodeproj` target. Will remain valid through Phase 9 of the migration. After Expo reaches parity (Phase 10), the legacy target is archived and root `ci_scripts/` can be removed.

### OTA updates (EAS Update)
Enable on JS-only changes (UI, copy, bug fixes). **Forbidden** OTA scope: Nitro modules, crypto, ZK code, anything inside `nitro-modules/*` or `packages/shared/src/crypto/*`. Use EAS Update channel `production` with `runtimeVersion: "1.3.1"` policy so JS bundle is pinned to the native code version.
