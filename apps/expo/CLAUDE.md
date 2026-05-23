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
