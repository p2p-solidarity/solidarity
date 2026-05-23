# Building `@solidarity/nitro-nfc-passport`

Reads ICAO 9303 e-passport NFC chips. BAC + PACE + passive auth.

| Platform | Lib | Native side |
|---|---|---|
| iOS | [NFCPassportReader](https://github.com/AndyQ/NFCPassportReader) via SwiftPM | `ios/HybridNfcPassport.swift` |
| Android | [jmrtd](https://jmrtd.org/) via Gradle JNI | `android/HybridNfcPassport.kt` |

## Codegen

```bash
bun install
cd nitro-modules/nfc-passport
bunx nitrogen     # → nitrogen/generated/{ios,android}/HybridNfcPassportSpec.{swift,kt}
```

## CSCA trust anchors

The Master List (CSCA root certs) ships as a JSON blob produced by
`scripts/generate_masterlist.py` (kept from the Swift project). The Nitro
module reads it at startup; refresh via `IssuerTrustAnchorStore` once the
backup-sync phase wires up periodic refresh.

## Permissions

In `apps/expo/app.json`:
- iOS: `NFCReaderUsageDescription`, `com.apple.developer.nfc.readersession.formats: ["TAG"]`
- Android: `android.permission.NFC` (auto-included by jmrtd's manifest)
