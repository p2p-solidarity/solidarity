# Building `@solidarity/nitro-proximity`

Nitro module that bridges JS to:

- **iOS**: MultipeerConnectivity (peer discovery + transport) + NearbyInteraction (UWB ranging)
- **Android**: Google Nearby Connections (peer discovery + transport) + UWB API 31+ (ranging) with BLE RSSI fallback for older devices

The TS spec is the source of truth: `src/specs/Proximity.nitro.ts`. Native classes implement the spec; nitrogen generates the bridge.

## One-time setup

```bash
# from repo root
bun install
cd nitro-modules/proximity
bunx nitrogen
# → writes nitrogen/generated/{ios,android,shared}/*
# → produces HybridProximitySpec.swift  (the Swift protocol that ios/HybridProximity.swift extends)
# → produces HybridProximitySpec.kt     (the Kotlin abstract class that android/HybridProximity.kt extends)
```

## Per-platform build

The Expo CNG step runs `nitrogen` automatically, so the developer flow is just:

```bash
# iOS — Xcode Cloud handles this via ios/ci_scripts/ci_post_clone.sh
cd apps/expo && bunx expo prebuild --clean --platform ios

# Android — via EAS or local
cd apps/expo && bunx expo prebuild --clean --platform android
cd android && ./gradlew :solidarity_nitro_proximity:assemble
```

## Permissions

The autolinker doesn't add platform permissions — they live in `apps/expo/app.json`:

- iOS: `NSLocalNetworkUsageDescription`, `NSNearbyInteractionUsageDescription`, `NSBonjourServices`
- Android: `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION`, `UWB_RANGING`, `NEARBY_WIFI_DEVICES`

## Event-loop design

The TS spec exposes `addEventListener(cb)`. On both platforms we maintain a single `Listener` callback set; native classes push events from their respective delegates / callbacks. The JS bridge always serialises one event at a time, so callers don't need to lock the renderer.

UWB ranging events fire at up to ~10 Hz on iOS (NearbyInteraction native cadence) — consumers must throttle if used to drive React state (use a `SharedValue` + animated subscriber instead, per aniseekr-expo rule 9).
