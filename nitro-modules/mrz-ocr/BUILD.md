# Building `@solidarity/nitro-mrz-ocr`

ICAO 9303 MRZ text recognition for VisionCamera v5 frame processors.

| Platform | Recogniser | Native side |
|---|---|---|
| iOS | VisionKit `VNRecognizeTextRequest` (built-in) | `ios/HybridMrzOcr.swift` |
| Android | ML Kit Text Recognition v2 (bundled model) | `android/HybridMrzOcr.kt` |

The native side returns *every* recognised line on the Frame. The
JS layer (`apps/expo/src/passport/mrzOcr.ts`) filters lines that look
like MRZ (regex `^[A-Z0-9<]{30,44}$`), feeds the candidate pair to the
[`mrz`](https://www.npmjs.com/package/mrz) npm parser, and only accepts a
draft after N consecutive frames produce the same check-digit-valid
result.

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
