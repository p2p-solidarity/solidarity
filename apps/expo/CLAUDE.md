# `apps/expo` — Solidarity Expo client

Identity + business-card app. Port of `solidarity/` (SwiftUI). Aims for
**1:1 visual + behavioural parity** with Swift v1.3.1 plus full Android
support via Expo + Nitro Modules.

## Quick start

```bash
bun install                                                  # workspace root
cd apps/expo
bunx expo prebuild --clean --platform ios --no-install
bun run ios                                                  # launches simulator
bun run typecheck                                            # 0 errors expected
bun test                                                     # 78+ unit + parity
bun run lint                                                 # 0 errors (cosmetic warnings ok)
```

### Dev client required — Expo Go is not a development path

`react-native-bare-kit` (Pear lane, `docs/ref/04-plan-app.md` Phase A3) ships
a `BareKit` TurboModule + a vendored `BareKit.xcframework` / Bare Android
runtime. Expo Go only bundles Expo's own module set, so **Expo Go cannot run
this app** — it never could, given the existing Nitro modules
(`nitro-attest`, `nitro-keystone`, …), but
bare-kit makes it explicit. Always build a **dev client**:

```bash
bunx expo prebuild --clean --platform ios --no-install
bun run ios       # expo run:ios     — builds + installs the dev client
bun run android   # expo run:android — builds + installs the dev client
```

`expo start` alone (no `--dev-client` build first) will still print a QR
code, but scanning it into Expo Go fails at the native-module-not-found
stage. Build the dev client once per native dependency change, then
`expo start` for the JS iteration loop.

**Android `minSdkVersion` is 29**, not 26 — bumped in `app.json`
(`expo-build-properties.android.minSdkVersion`) because
`react-native-bare-kit`'s own `android/build.gradle` declares `minSdk 29`;
AGP fails the manifest merge if the app's minSdk is lower than a library's.

## Aniseekr-expo rules — adopted

These are pinned from `../../ani/aniseekr-expo/CLAUDE.md`. Skip them and
you re-introduce bugs the aniseekr team already paid for.

### Rule 1. Buttons → `ThemedButton` only
- `src/components/themed/ThemedButton.tsx` is the **only** primitive for
  CTAs. Variants: `primary | inverted | secondary | dottedOutline |
  destructive`.
- Never roll a per-screen `PrimaryButton`. Extend variants if you need
  more.
- `fullWidth` uses `alignSelf: 'stretch'` (never `flex: 1`).
- Foreground colour computed via `readableTextOn(accent)` so light
  accents stay legible (`components/themed/contrast.ts`).

### Rule 2. Text → `ThemedText`
- `src/components/themed/ThemedText.tsx`. Variants: `headlineLarge,
  headlineMedium, titleLarge, titleMedium, bodyLarge, bodyMedium,
  bodySmall, caption, label`.
- Never inline `fontSize: 17, fontWeight: '600'`.

### Rule 3. Surfaces → `ThemedSurface`
- Variants: `card | elevated | outlined | inset`. Use them for any
  card / sheet / muted bg instead of writing custom borderRadius +
  borderColor + backgroundColor blocks.

### Rule 4. Colours from `Colors` token, never inline hex
- `src/constants/Colors.ts` is the **single source** for brand hex.
  Mirrors Swift `Color.Theme.*` names 1:1.
- NativeWind classes (`bg-pageBg`, `text-text1`, `bg-accentRose`) read
  from `tailwind.config.js` which references `Colors`.
- Hex literals are allowed **only** in `Colors.ts` and `contrast.ts`
  (`ON_DARK` / `ON_LIGHT`).

### Rule 5. Theme mode + contrast knobs
- `global.css` exposes CSS vars per light/dark `@media`. NativeWind
  picks the right one automatically. Don't bypass with hardcoded hex.

### Rule 6. Touch targets ≥ 44 × 44
- `ThemedButton size="md"` already meets this. Custom hit areas: use
  44 explicitly.

### Rule 7. Haptics built into ThemedButton
- `ThemedButton` calls `haptic()` per default table
  (primary→success, destructive→warning, others→tap).
- Override with `haptic="…"` or `haptic={false}`.
- Direct usage: `import { haptic } from '@/feedback/haptics'`.

### Rule 8. No fake data
- Three valid states for any data-driven UI: `loading | ready | error`.
- Mock data only behind `usePreferences((s) => s.developerMode)` flag.
- Currently legitimate mock paths (must stay labelled clearly):
  - `/passport` "Start mock flow" button (until Nitro NFC + ZK wires).
  - `/oidc/consent` Approve button toasts "lands next iteration".

### Rule 9. State ownership
- High-frequency state (gestures, animations) → `SharedValue` via
  Reanimated 4. See `RadarMatching.tsx` for the canonical pattern.
- Persisted preferences → `usePreferences` zustand store (one place).
- Local UI state (selected variant, expanded section) → `useState` in
  the smallest component that renders the control.

### Rule 10. Navigation feel — never await on first paint
- All zustand stores seed in-memory `DEFAULTS` and hydrate on `useEffect`,
  so cache hits paint frame 1 without a skeleton.
- List → detail pages pass `{ id, name }` via `router.push({pathname,
  params})` so the detail hero is on screen before MMKV resolves.

## Repo layout (this app)

```
apps/expo/
├── app/                       ← Expo Router screens (file-based)
│   ├── _layout.tsx            ← MMKV init + i18n + deep-link wiring
│   ├── index.tsx              ← onboarding gate (reads usePreferences)
│   ├── (tabs)/                ← people/share/me
│   ├── onboarding/            ← 7-step flow
│   ├── settings/              ← hub + 6 sub-pages
│   ├── people/[id].tsx        ← PersonDetail (with MauvePetalMotif watermark)
│   ├── cards/edit.tsx         ← BusinessCardForm
│   ├── credentials/{index,[id],offer}.tsx
│   ├── groups/{index,[id]}.tsx
│   ├── shoutouts/{index,[id],new}.tsx
│   ├── vault/{index,new}.tsx
│   ├── passport/index.tsx
│   ├── scan/index.tsx         ← vision-camera QR scanner
│   └── oidc/consent.tsx
├── src/
│   ├── components/
│   │   ├── themed/            ← Themed{Text,Surface,Button} + contrast
│   │   ├── brand/Wordmark.tsx ← Swift Wordmark.svg port
│   │   ├── decor/             ← DecorativeBlobs / MauvePetalMotif / PaperStack
│   │   ├── people/ContactRow + ContactsList
│   │   ├── settings/SettingRow + ToggleRow
│   │   └── share/RadarMatching
│   ├── constants/Colors.ts    ← brand palette (single source)
│   ├── storage/               ← MMKV + secure-store + AES-GCM
│   ├── keychain/              ← signing key + pairwise + biometric gate
│   ├── backup/                ← iCloud + Drive + gesture-triggered
│   ├── contacts/              ← repository (zustand) + VCF importer
│   ├── cards/cardManager      ← business card CRUD (zustand)
│   ├── credentials/store      ← VC library (zustand)
│   ├── groups/store           ← group + member (zustand)
│   ├── shoutouts/store        ← Sakura messaging (zustand)
│   ├── vault/{store,storage}  ← encrypted file vault
│   ├── sakura/client          ← messaging relay client + ECIES
│   ├── oidc/{parseAuthRequest,proofVerifier}
│   ├── passport/pipeline      ← MRZ → NFC → ZK orchestrator
│   ├── deeplink/{parser,router}
│   ├── settings/preferences   ← MMKV-backed prefs (zustand)
│   ├── feedback/{haptics,toast}
│   ├── i18n/                  ← i18next + en/zh-Hant
│   ├── onboarding/{state,steps}
│   ├── people/usePeopleScreen
│   └── scan/{QrScanner,useCameraPermission}
└── __tests__/{unit,parity}/   ← 13 suites, 78 passing
```

## Why some files use `expo-file-system/legacy`

`expo-file-system` v56 split into a new `Paths` / `File` / `Directory`
class API. The legacy `documentDirectory` + `writeAsStringAsync`
helpers live behind the `/legacy` sub-import. We keep the legacy path
for now because it's shorter; migrate when there's time.

## CI

iOS releases ship via **Xcode Cloud** (Apple Developer 25 h/month free,
auto cert mgmt). The `withXcodeCloudScripts` config plugin
(`apps/expo/plugins/`) re-creates `ios/ci_scripts/ci_post_clone.sh`
after every `expo prebuild --clean` from the persistent source at
`ci-scripts/ci_post_clone.sh`.

Android builds via **EAS Build** or `expo prebuild --platform android`
+ `./gradlew bundleRelease`.

`react-native-bare-kit` needs **no custom config plugin** — it autolinks
via its own `react-native.config.js` + `react-native-bare-kit.podspec` +
`android/build.gradle` (same as `holepunchto/bare-expo`'s reference
integration). The only app.json change it required is the
`minSdkVersion: 29` bump above.

## Error handling & crash diagnostics

Hard-won from the MRZ-camera + DAG/P2P-Lab 閃退 hunt. Read this BEFORE debugging
any crash — it turns "hours" into "minutes". The recurring failure was an
exception escaping opaquely (`abort() called`, no type) because error handling
itself was broken or absent.

### Where crashes are caught — and where they are NOT

| Crash class | Caught by | Result |
|---|---|---|
| JS **render** throw in any screen | `RootErrorBoundary` (Expo Router `ErrorBoundary`, re-exported from `app/_layout.tsx`) | Themed error screen + Retry, never a white screen |
| Uncaught JS error off the render path (timers, events, un-awaited rejects) | global `ErrorUtils` handler (installed by `src/feedback/RootErrorBoundary.tsx`) | Logged `[solidarity:uncaught]`, chained to default |
| **Native** uncaught exception — a TurboModule raising an NSException on its queue, a worklet throwing out of VisionCamera's async-runner, a C++ `abort` | **nothing — it terminates the process** | …but it NAMES ITSELF (see below). Fix at the call site. |

JS error boundaries CANNOT catch native crashes. The DAG/P2P-Lab crashes are a
native TurboModule NSException (`ObjCTurboModule::performVoidMethodInvocation`) —
no JS try/catch or boundary will stop them; read the crash report and guard the
call site (e.g. don't mount the native view when its module is unavailable).

### Self-identifying crashes — `MrzInstallCrashDiagnostics`

`nitro-modules/attest/ios/MrzVisionGuard.mm` installs a process-wide
`std::set_terminate` handler **at app launch** (`+load` → `dispatch_async(main)`
so it wraps RN/Hermes' handlers). On any uncaught exception it writes the
demangled type + message into:
- the crash report's **Application Specific Information** (`CRSetCrashLogMessage`,
  via `dlsym` — so it lands in the `.ips` you pull WITHOUT sudo), and
- an `os_log` fault tagged `[MRZ-FATAL]`.

A `facebook::jsi::JSError`'s message carries the **JS stack**, so a worklet/JS
crash names the exact function. Without this you get only `abort() called`.

### Pulling a device crash report (the A12 test phone)

Crashes live ON the device (`~/Library/Logs/DiagnosticReports` on the Mac only
has the Mac's own). Repro device = iPhone XR / A12 (`idevice_id -l`).

```bash
idevicecrashreport -u <UDID> -k /tmp/xr-crashes   # -k keeps them on device
# newest Solidarity-*.ips → read the header `asi` (now names the exception) +
# the faulting thread's queue/stack.
```

Need the full unified log (Espresso/ANE lines, the raw libc++abi message)?
`log collect` needs root — run it yourself with `! sudo …`, then `log show` the
archive with an ABSOLUTE PATH (a `log` shell function shadows `/usr/bin/log`):

```bash
! sudo log collect --device-udid <UDID> --last 20m --output /tmp/dev.logarchive
/usr/bin/log show /tmp/dev.logarchive --predicate 'process == "Solidarity"' --info --debug
```

### Worklet rules (VisionCamera frame processors / async-runner)

The OCR worklet runs on VisionCamera's **async-runner runtime** — NOT the
Reanimated UI runtime — which has NONE of react-native-worklets' JS-scheduling
globals. On that runtime:

- ❌ `scheduleOnRN(...)` and `console.log(...)` **throw** (`Object is not a
  function`; `console.log` routes through `scheduleOnRN`). A throw out of
  `runAsync` unwinds past Nitro and `std::terminate`s the whole app.
- ✅ A worklet must be **incapable of escaping**: body in try/catch/finally where
  the catch and finally only write SharedValues or swallow — never call anything
  that can throw (guard `frame.dispose()` too).
- ✅ Hand results back to JS via **SharedValues** (the one channel shared across
  runtimes), drained by a JS-thread poll. See `MRZCameraStep.tsx`
  (`acceptSeq`/`errorSeq` channel + 100 ms drain). `scheduleOnRN` IS fine on the
  UI runtime (gestures/animations, e.g. `FocusedCardView.tsx`) — the ban is
  async-runner only.

### Native (Nitro / Vision) rules

- A Nitro HybridObject method must NOT throw per-frame for a transient failure —
  return an empty/no-op result and let the caller skip. Re-throwing across the
  Nitro/worklet boundary every frame is a terminate risk.
- Apple Vision `.accurate` on the A12 ANE raises an uncaught **C++** exception
  (Espresso), NOT an NSException, mid-inference. Catch it in ObjC++ with
  `catch (...)`, not only `@catch (NSException *)`. See `MrzPerformVisionRequest`.
- A Nitro `ArrayBuffer` **argument from JS is non-owning** — its backing store is
  valid ONLY for the synchronous duration of the call. NEVER touch
  `buffer.data` / `buffer.size` inside `Promise.async` (that body runs later, on
  the Swift-concurrency cooperative pool): the buffer is gone, Nitro raises an
  Objective-C exception → `EXC_BREAKPOINT` / SIGTRAP — an **uncatchable native
  crash**. No JS `try/catch`, `RootErrorBoundary`, or `Result` can stop it, so it
  reads as a silent 閃退 with "no error". **Copy to an owning `Data` BEFORE
  `return Promise.async {` and capture the `Data`**, e.g.
  `let bytes = copyPayload(payload); return Promise.async { … use bytes … }`.
  Buffers you create yourself via `ArrayBuffer.copy(data:)` are owning → exempt.
  This bug hid for months because an earlier throw (SpruceID-unavailable)
  short-circuited the flow before signing ever reached the `ArrayBuffer` read;
  fixing that throw unmasked it. Swept across `signJws`, proximity
  `invitePeer`/`sendData` (L2CAP path only — Multipeer was already correct),
  secrets-vault `wrap`, semaphore `identityFromSeed`/`importPrivateKey`,
  passport-zk `verifyNoirProof` (commit `6c77010`). When auditing a new
  HybridObject method: any `: ArrayBuffer` param read inside `Promise.async` is
  this bug.
