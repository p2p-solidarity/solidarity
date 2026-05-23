# Building `@solidarity/nitro-spruce-did`

Nitro module that bridges JS to:

- **iOS**: Secure Enclave (P-256) + Apple Keychain + `SpruceIDMobileSdkRs`
  (https://github.com/spruceid/sprucekit-mobile)
- **Android**: AndroidKeyStore (StrongBox where available) +
  `com.spruceid.mobile.sdk:mobilesdk`
  (https://central.sonatype.com/artifact/com.spruceid.mobile.sdk/mobilesdk)

The TS spec is the source of truth: `src/specs/SpruceDid.nitro.ts`. Native
classes implement the spec; nitrogen generates the bridge.

## One-time setup

```bash
# from repo root
bun install
cd nitro-modules/spruce-did
bunx nitrogen
# → writes nitrogen/generated/{ios,android,shared}/*
# → produces HybridSpruceDidSpec.swift  (the Swift protocol that ios/HybridSpruceDid.swift extends)
# → produces HybridSpruceDidSpec.kt     (the Kotlin abstract class that android/HybridSpruceDid.kt extends)
```

## iOS — wiring the SpruceID SPM package

The iOS implementation depends on `SpruceIDMobileSdkRs` which is distributed
exclusively via Swift Package Manager. CocoaPods can't pull it in, so the
consuming app must add the SPM dependency to its Xcode project.

For the Expo client, this is done by the `withSpruceIdSpmPackage.js` config
plugin (`apps/expo/plugins/`) which injects the SPM reference after every
`expo prebuild --clean`.

Manual integration steps (used by Xcode Cloud + local devs):

1. In `apps/expo/ios/Solidarity.xcworkspace`, select the project, then the
   Solidarity target.
2. **Package Dependencies → +**
3. Enter `https://github.com/spruceid/sprucekit-mobile` and pin to
   the version recorded in `apps/expo/ios/SolidaritySpruceDidVersion.txt`
   (currently `0.14.10`, matches the legacy SwiftUI app).
4. Add products `SpruceIDMobileSdk` and `SpruceIDMobileSdkRs` to the
   Solidarity target.

## Android — wiring the Maven artifact

The Android implementation pulls `com.spruceid.mobile.sdk:mobilesdk:0.14.10`
from Maven Central. No extra setup beyond the standard nitro-module gradle
file — the dep is declared in `android/build.gradle`.

## Per-platform build

The Expo CNG step runs `nitrogen` automatically, so the developer flow is just:

```bash
# iOS
cd apps/expo && bunx expo prebuild --clean --platform ios
cd ios && xcodebuild -workspace Solidarity.xcworkspace -scheme Solidarity \
  -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -skipPackagePluginValidation build

# Android — via EAS or local
cd apps/expo && bunx expo prebuild --clean --platform android
cd android && ./gradlew :solidarity_nitro-spruce-did:assembleDebug
```

## Migration from `@noble/curves` random keys

Before this module, `packages/shared/src/identity/keyPair.ts` generated
P-256 keys via `@noble/curves` which falls back to `crypto.randomBytes()`
under React Native — a non-CSPRNG source. After this module is wired into
`apps/expo/src/keychain/signingKey.ts`, the JS layer no longer holds any
private-key material:

- `ensureSigningKey()` now returns an opaque `SpruceDidIdentity` handle
  carrying the alias + cached public JWK.
- `signJwt(header, payload)` posts the payload bytes to native and
  receives the compact JWS back, so the private key never leaves the
  enclave.
- Legacy keys under `gg.solidarity.signing.v2` are migrated lazily on the
  first call to `ensureSigningKey()`. See the migration block in
  `signingKey.ts` for the alias mapping.

## Permissions

The autolinker doesn't add platform permissions — they live in
`apps/expo/app.json`:

- iOS: `NSFaceIDUsageDescription` (already present for the existing
  Face ID-gated passport flow).
- Android: `android.permission.USE_BIOMETRIC` (already present for the
  existing biometric prompt in vault unlock).

## Event-loop design

The TS spec exposes `addEventListener(cb)`. Native pushes:

- `keyGenerated` — once after `generateKey()` succeeds. Includes the
  `hardwareBacked` flag.
- `keyDeleted` — once after `deleteKey()` resolves true.
- `biometricPromptCancelled` / `biometricPromptFailed` — surface every
  user-side biometric outcome so the UI can render a "please try again"
  toast without parsing OS-specific errors.
- `keyRotationDetected` — emitted if a sign attempt finds the alias has
  been re-created (e.g. after an OS update changed the SE token).
- `error` — catch-all for unexpected SecKeychain / Keystore failures.
