# Building `@solidarity/nitro-mrz-ocr`

ICAO 9303 MRZ text recognition for VisionCamera v5 frame processors.

| Platform | Recogniser | Native side |
|---|---|---|
| iOS | Vision `VNRecognizeTextRequest` (built-in) | `ios/HybridMrzOcr.swift` |
| Android | ML Kit Text Recognition v2 (bundled model) | `android/HybridMrzOcr.kt` |

The native side recognises text on the Frame, filters TD3-looking rows,
canonicalises OCR-shortened rows back to 44 chars, and returns a draft
only after the BAC-critical ICAO 9303 check digits validate. JS receives
only scan progress metadata plus the validated draft.

## Codegen

```bash
bun install
cd nitro-modules/mrz-ocr
bunx nitrogen     # → nitrogen/generated/{ios,android,shared}/...
```

Re-run after editing `src/specs/MrzOcr.nitro.ts`.

## Why bundled ML Kit on Android

`com.google.mlkit:text-recognition` (vs `com.google.android.gms:play-services-mlkit-text-recognition`):

- Works on AOSP / GMS-less devices (no Play Services dependency).
- No network call on first launch.
- ~3 MB APK uplift — acceptable for a privacy-focused app.

## Permissions

Camera permission is declared by the consumer app
(`apps/expo/app.json` → `ios.infoPlist.NSCameraUsageDescription` +
`android.permissions: ["android.permission.CAMERA"]`). This module ships
an empty AndroidManifest because it has no additional runtime
permission of its own.
