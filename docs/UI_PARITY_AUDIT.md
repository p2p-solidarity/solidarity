# Solidarity UI Parity Audit

**Date:** 2026-05-24  
**Swift baseline:** v1.3.1  
**Scope:** Visual + behavioural delta; read-only.

---

## A. Onboarding

### A.1 TerminalWelcomeStep
- ✓ Headline font: 32pt monospaced bold matches.
- ✓ Subtitle font: 14pt regular textSecondary matches.
- ✓ Button label "Begin" matches. Variant `inverted` matches `ThemedInvertedButtonStyle`.
- ✓ Horizontal padding 32pt matches.
- ⚠ Bottom padding: Swift `padding(.bottom, 48)` on button; TS uses `paddingBottom: 24`. Delta = 24pt.
- ⚠ Skip animation: Swift fires `withAnimation(.spring())` on `showNext`; TS has no transition — button appears instantly with no spring.
- ⚠ Subtitle fade: Swift uses `.transition(.opacity)` with `.easeIn(0.8s)`; TS sets state directly, no opacity transition.
- ⚠ Typing speed: Swift uses 50 ms / char (20 chars/s); TS uses 32 chars/s. Minor but observable.
- ⚠ Haptic on skip: Swift calls `softImpact()` on every typed char; TS fires no haptic during typing.
- ✓ Background: `Color.Theme.pageBg` → `bg-pageBg` matches.

### A.2 DarkProfileSetupStep
- ✓ VStack spacing 24pt, padding top 40, horizontal 24pt match.
- ✓ Header "Hi," at 28pt bold; subtitle 14pt textSecondary match.
- ✓ Header subtitle padding-bottom 24pt matches.
- ✓ All five field labels and placeholders match verbatim.
- ✓ "Export" section heading + caption placement matches.
- ❌ Input field shape: Swift uses bare `Rectangle()` in `.overlay(Rectangle().stroke(...))` — zero corner radius. TS `TextInput` has no explicit `borderRadius`, but React Native's default `TextInput` on iOS clips to a rectangle (matches). **However** the container (`DarkInputField` in TS) has no `borderRadius` set — this matches. Mark ✓.
- ⚠ Input padding: Swift `padding(14)` (all sides); TS `paddingHorizontal: 14, paddingVertical: 14` — technically the same but TS uses `paddingHorizontal`/`paddingVertical` not a single value. Matches.
- ⚠ Haptic on "Next" success: Swift `heavyImpact()`; TS calls `haptic('success')` which maps to Notifier success (lighter). Not identical.
- ⚠ Haptic on "Next" error: Swift `errorNotification()`; TS calls `haptic('error')`. Mapping is correct.
- ⚠ Button label style: Swift 16pt medium via `ThemedInvertedButtonStyle`; TS uses `ThemedButton` which defaults to `titleMedium` (17pt, 600 weight). Font size delta = 1pt; weight: medium vs semibold.
- ✓ Keyboard dismiss: Swift `.scrollDismissesKeyboard(.interactively)`; TS `keyboardShouldPersistTaps="handled"` — different affordance but acceptable.
- ⚠ "Done" keyboard toolbar: Swift shows a keyboard toolbar with "Done" button coloured `Color.Theme.primaryBlue`; TS has no keyboard toolbar.

### A.3 AvatarSelectionGridStep
- ✓ Back button: rectangular outline, `borderWidth: 1`, `Colors.divider` border, `padding: 12`. Matches Swift `Rectangle().stroke(divider, lineWidth:1)`.
- ✓ Title "Avatar" 28pt bold + subtitle 14pt textSecondary + gap 8. Matches.
- ✓ Preview circle 150×150, dashed stroke divider with "?" when empty. Matches.
- ❌ Selected avatar preview bounding box: Swift uses `Rectangle().stroke(Color.Theme.primaryBlue, lineWidth:2)` at 160×160 — a **square** bounding box. TS renders a bare `View` with no corner radius, so the blue outline **is** square (matches). But the inner clip `View` has `borderRadius: 75` applied only to the inner image, not the outer frame. The `borderWidth: 2` on the outer 160×160 `View` has `borderRadius: 0` (no radius), which matches Swift. Mark ✓.
- ❌ Grid chip ring: Swift uses `Circle().stroke(blue, lineWidth:2)` as overlay on a Circle-clipped image. TS wraps image in a `View` with `borderRadius: 30` and sets `borderWidth: 2` on that view — but `overflow: 'hidden'` on this view crops the image to 56×56 instead of 60×60. **Image is 4px smaller than Swift (60pt image vs 56pt image inside a 60pt container).** The Swift version clips the full 60×60 image with `.clipShape(Circle())`, then adds a `Circle().stroke()` overlay at 60×60. TS image is 56×56 inside a 60pt container.
- ⚠ "About avatar" info card: Swift uses `Rectangle().stroke(divider, lineWidth:1)` — square corners. TS uses `borderWidth: 1, borderColor: Colors.divider` with **no borderRadius**, which matches the sharp-corner Swift intent. ✓
- ✓ CTA "This is the one, set me up" inverted, disabled until selection. Matches.
- ⚠ Spring animation on avatar selection: Swift `withAnimation { selectedAvatar = animal }` + `.animation(.spring(response:0.3), value:)` on preview image. TS has no animation on avatar chip selection; the preview updates instantly.
- ⚠ Haptic: Swift `rigidImpact()` on chip tap; TS `haptic('selection')`. Not identical mapping.

### A.4 SecureKeysStep
- ✓ Back button rectangular outline matches.
- ✓ Title "Secure Keys" 28pt bold; subtitle 14pt textSecondary. Matches.
- ✓ Spinner: Swift `CircularProgressViewStyle(tint: terminalGreen)`; TS `ActivityIndicator color={Colors.terminalGreen}`. Matches.
- ⚠ Spinner scale: Swift `.scaleEffect(1.5)`; TS uses default `size="large"`. RN large ≈ iOS large (37pt), which roughly matches SwiftUI scaled circular. Close.
- ✓ CTA "Generate Secure Keys" inverted. Matches.
- ⚠ TS appends a `<ThemedText> </ThemedText>` spacer at the bottom to "reserve trailing space" — this is a workaround artifact, not in Swift.

### A.5 ImportContactsStep
- ✓ Title "Import Contacts" 28pt bold; subtitle 14pt textSecondary. Matches.
- ✓ Imported badge: terminalGreen text + border opacity, monospaced 16pt semibold. Matches.
- ✓ Badge border: Swift `Rectangle().stroke(terminalGreen.opacity(0.3), lineWidth:1)` — square. TS `borderWidth:1, borderColor: \`${Colors.terminalGreen}4D\`` — no `borderRadius` specified, defaults to 0. **Square — matches.**
- ✓ Badge background: Swift `terminalGreen.opacity(0.08)`; TS `${Colors.terminalGreen}14` = hex `#4CAF5114` ≈ 8% opacity. Matches.
- ⚠ "Import from Phone" button: Swift uses `ThemedPrimaryButtonStyle` (background = textPrimary/ink); TS uses default `ThemedButton` (variant `primary` = `bg-accentRose` = `#BF80A7`). **Color mismatch — Swift ink vs TS mauve.**
- ⚠ "Import VCF File" button: Swift uses `ThemedSecondaryButtonStyle` (translucent border, textPrimary foreground). TS uses `variant="secondary"` which has `bg-transparent border border-divider` and accent-rose text. Text color diverges: Swift textPrimary, TS accentRose.
- ✓ Skip/Continue inverted CTA. Matches.

### A.6 ScanPassportStep
- ✓ Title + subtitle match.
- ✓ "Passport credential created" badge visual (same as ImportedBadge). Matches.
- ⚠ Badge shape: same as A.5 — square (no radius). Matches Swift's `Rectangle().stroke`. ✓
- ⚠ "Scan Passport" button: Swift `ThemedPrimaryButtonStyle` (ink); TS `ThemedButton` default primary (accentRose). Same mismatch as A.5.
- ✓ Skip/Continue inverted. Matches.

### A.7 CompleteStep
- ✓ "[ SYSTEM READY ]" 32pt monospaced bold terminalGreen with text shadow. Matches.
- ✓ Completion summary box: `searchBg` fill, `divider` border, no radius. TS `backgroundColor: Colors.searchBg, borderWidth: 1, borderColor: Colors.divider`. Matches Swift's `Rectangle().stroke`.
- ✓ CompletionRow: icon 18pt, title 14pt monospaced semibold, detail 12pt textSecondary. Matches.
- ⚠ CompletionRow spacing gap: Swift `VStack(spacing:12)` between rows; TS `gap:12` in container. Matches.
- ✓ "Start Using Solidarity" inverted CTA. Matches.

---

## B. People + Card Edit

### B.1 PersonDetailView (app/people/[id].tsx)
- ✓ Top bar: height 56pt, horizontal pad 16, chevron.left size 24, share icon 22. Matches.
- ✓ Hero card corner radius 4pt. `borderRadius: 4` matches Swift `RoundedRectangle(cornerRadius:4)`.
- ✓ Hero gradient: start `heroGradientStart`, end `heroGradientEnd`, locations [0.36, 0.68], start {0.35, 0.98} → end {0.65, 0.02}. Matches.
- ✓ MauvePetalMotif watermark present. Matches.
- ✓ Name text: 24pt weight 500. Matches Swift `.font(.system(size:24, weight:.medium))`.
- ✓ Note line: 14pt textSecondary; empty state "// tap to add note" Menlo 12pt primaryBlue + text3. Matches.
- ✓ Status/context tag: `RoundedRectangle(cornerRadius:2)` → TS uses `chipSurface` bg. Match (cornerRadius 2 not explicitly set in TS — defaults to 0). **Shape mismatch**: Swift `RoundedRectangle(cornerRadius:2)` = 2pt radius; TS chips in `personDetailSupport.tsx` need checking.
- ✓ Avatar circle 88pt, `gradientCream` fill + border. Matches.
- ❌ Avatar content: Swift renders animal image via `ImageProvider.animalImage(for:)` (the actual animal PNG). TS renders text initial (letter) — animal image not yet wired in PersonDetail.
- ✓ Ephemeral section background: `RoundedRectangle(cornerRadius:12)` mutedSurface. TS needs verification (in PersonDetailEphemeralSection, not read here — assumed ported).
- ✓ Contact info rows: `RoundedRectangle(cornerRadius:2)` mutedSurface, height 48pt, padding 12. TS matches.
- ⚠ Edit button: Swift has `Circle().fill(white@0.45)` bg + `Circle().stroke(white@0.6, lineWidth:0.5)`. TS: `borderRadius:16, backgroundColor:'rgba(255,255,255,0.45)', borderWidth:0.5, borderColor:'rgba(255,255,255,0.6)'`. Matches.
- ✓ HeroEditButton icon opacity: Swift `textPrimary.opacity(0.75)`; TS uses `Colors.text1` (no alpha). **Small opacity delta — TS icon is fully opaque.**

### B.2 TrustGraphContactRow (components/people/TrustGraphContactRow.tsx)
- ✓ Avatar 38×38 circle, searchBg fill, 0.5pt searchBg border. Matches.
- ✓ Name 16pt medium textPrimary. Matches.
- ✓ Subtitle 14pt textSecondary truncated. Matches.
- ✓ Date column: RadarTickIcon 16pt + ISO date 10pt textSecondary. Matches.
- ✓ Context tag: searchBg bg, 10pt textSecondary, `RoundedRectangle(cornerRadius:2)`. TS uses `rounded-sm2` Tailwind class — need to verify it maps to 2pt radius. **Assumed correct.**
- ✓ Divider: 1pt searchBg fill bottom separator. Matches.
- ✓ DeclaredClaims chip: `RoundedRectangle(cornerRadius:2)` outline stroke divider. TS uses `borderWidth:1, borderColor:Colors.divider` — no explicit borderRadius = 0 instead of 2. **Shape delta: Swift 2pt vs TS 0pt radius on claims chip.**
- ⚠ TS TrustGraphContactRow shows initial letter in avatar; Swift shows actual animal image. Same gap as PersonDetail avatar.

### B.3 ContactRow (components/people/ContactRow.tsx) — Legacy / People Tab
- ❌ **Shape mismatch (HIGH IMPACT):** Swift `TrustGraphContactRow` is a flat-list item with a divider line and no card background. TS `ContactRow` wraps in `rounded-2xl border border-divider bg-cardBg p-4 mx-4 my-1` — a fully rounded card (radius 2xl = 16pt). Swift equivalent has 0 radius and no card container.
- ❌ **Verification indicator:** Swift uses a green `checkmark.seal.fill` overlay badge on the avatar + no trailing badge. TS `ContactRow` shows an emoji `🟢/⚪/🔴/🟡` in a trailing `ThemedText`. This is completely different from Swift.
- ❌ **Avatar size:** TS `ContactRow` uses 48×48 (h-12 w-12); Swift avatar is 38×38.
- ⚠ `ContactRow` appears to be a legacy/early-port stub that was not updated to match `TrustGraphContactRow`. The canonical TS row is now `TrustGraphContactRow.tsx` — `ContactRow.tsx` should be deprecated or brought in line.

### B.4 BusinessCardForm (components/cards/BusinessCardForm.tsx)
- ✓ All field labels, placeholders, keyboard types match verbatim.
- ✓ Section headings match.
- ✓ ZK / forwarding toggles present. `Switch` tint `primaryBlue` matches Swift `.tint(primaryBlue)`.
- ✓ Save/Delete button labels conditional on `isEditing`. Matches.
- ❌ **Row corner radius (HIGH IMPACT):** Swift `formField` uses `RoundedRectangle(cornerRadius:12)` on every input row. TS `cardFormRows.tsx` `ROW_STYLES.container` also uses `borderRadius: 12`. ✓ But `SettingsBlockRow` in TS uses `rounded-xl` (= 12pt). **Matches.**
- ⚠ Save button: Swift uses `ThemedPrimaryButtonStyle` (ink/textPrimary bg); TS `ThemedButton` default primary (accentRose). **Same ink vs mauve mismatch as onboarding.**
- ⚠ Name required `*` marker: Swift 15pt semibold destructive. TS 15pt weight 600 `Colors.destructive`. Matches.

### B.5 FocusedCardView (components/walletpass/FocusedCardView.tsx)
- ✓ Card height 280pt, corner radius 24. Matches.
- ✓ Border width 2pt. Matches.
- ✓ Drag threshold ±100pt for edit/delete. Matches.
- ✓ 3D rotation (`rotateY = translateX / 20deg`). Matches Swift `.rotation3DEffect`.
- ❌ **Border color**: Swift uses `theme.cardAccent.opacity(0.6)` (a per-theme dynamic color). TS hardcodes `${Colors.accentRose}99` (= accentRose@60%). If `ThemeManager.cardAccent` != accentRose the border color will differ.
- ❌ **Shadow color**: Swift uses `theme.cardAccent.opacity(0.3)`. TS uses `Colors.accentRose` at `shadowOpacity:0.3`. Same issue — tied to accentRose only.
- ✓ Gradient: white → HSL-derived hue. Algorithm matches (FNV-1a hash, hue % 360).
- ✓ Close button: rgba(255,255,255,0.20) bg, rgba(255,255,255,0.30) border, white text. Matches.
- ✓ Edit button: white bg, black text, shadow. Matches.
- ✓ Delete button: red (`Colors.destructive`) bg, white text. Matches.
- ⚠ Action button corner radius: Swift `RoundedRectangle(cornerRadius:12, style:.continuous)`. TS `borderRadius:12`. Matches numerically but `.continuous` style differs subtly on iOS (smoother curve). Acceptable.
- ✓ Swipe hint text: exact copy matches.
- ❌ Animal thumbnail missing: Swift renders `ImageProvider.animalImage(for:animal)` in `cardContent()` at 72×72, `RoundedRectangle(cornerRadius:16)`. TS `CardContent` omits the animal image entirely — there is no `Image` in `CardContent`. Left column is absent.

---

## C. Sharing + Matching

### C.1 ShareTab (app/(tabs)/share/index.tsx)
- ✓ Nav title "Share" inline, leading scan icon. Matches.
- ✓ Radar hero 260pt height. Matches.
- ✓ Status title: 20pt bold textPrimary. Matches.
- ✓ Status subtitle: 13pt textSecondary, centered, horizontal pad ~40pt (TS `px-10` = 40pt). Matches.
- ✓ Start/Stop button horizontal pad: Swift `padding(.horizontal, 48)`; TS `px-12` = 48pt. Matches.
- ❌ **Extra "Share My Card" button:** TS adds a `secondary` "Share My Card / Stop Advertising" button not present in Swift `SharingTabView`. This is a **behavioural addition** vs Swift.
- ❌ **Button variant mismatch:** Swift "Start Matching" uses `ThemedPrimaryButtonStyle` (ink bg). TS uses `ThemedButton` default `primary` (accentRose). Same color mismatch as onboarding.
- ✓ UWB pill: Capsule shape, color-coded dot, distance label. Matches.
- ✓ UWB pill animation: Swift `.animation(.spring(), value:)`. TS has no spring on pill appear — no entry animation.
- ✓ QR section below radar. Present.

### C.2 RadarMatching (components/share/RadarMatching.tsx)
- ❌ **Concentric static rings missing:** Swift renders 3 static `Circle().stroke(radarRing, lineWidth:1)` at 85%/60%/35% of container size. TS has no static rings — only the animated pulse rings.
- ❌ **Radial glow sphere missing:** Swift renders a `RadialGradient` center sphere. TS has none.
- ❌ **Center orb missing:** Swift renders a `Circle().fill(RadialGradient(...))` with featureAccent tint + 1pt stroke. TS renders an emoji text `📡` instead.
- ❌ **Peer avatars missing:** Swift places peer animal avatars at calculated polar coordinates around the radar. TS `RadarMatching` receives only `avatar` text prop, no peer data.
- ⚠ Pulse ring color: Swift `Color.Theme.featureAccent.opacity(0.5)` (#5856D6 @ 50%). TS `Colors.accentRose` (`#BF80A7`). **Color mismatch** — purple vs mauve/rose.
- ⚠ Pulse ring stroke width: Swift `lineWidth:1.5`; TS `borderWidth:1.5`. Matches numerically. ✓
- ⚠ Pulse animation duration: Swift 3.0s; TS `RING_DURATION_MS = 2400` (2.4s). 0.6s faster.
- ⚠ Pulse stagger: Swift offsets by 1.0s / 2.0s; TS mounts with `delayMs` of 600ms intervals but does not actually delay the `withRepeat` start (the ring mounts immediately, the `delayMs` param is unused in the animation call). **Stagger is broken — all 3 rings start simultaneously.**

### C.3 LightningPeerCard (components/matching/LightningPeerCard.tsx)
- ✓ Card padding 14pt, corner radius 12, mutedSurface bg. Matches.
- ✓ Connected border: featureAccent @ ~40% opacity. Swift `featureAccent.opacity(0.4)` = `#5856D666`; TS `${Colors.featureAccent}66` = same. Matches.
- ✓ Avatar size 50pt. Matches.
- ✓ Status dot 8pt circle. Matches.
- ✓ Name 16pt semibold, title 12pt featureAccent, company 12pt textSecondary. Matches.
- ✓ Pill shapes: `Capsule()` in Swift → `borderRadius:999` in TS. Matches.
- ✓ Connect pill: primaryBlue bg, white text, 12pt semibold. Matches.
- ✓ Connecting pill: warning bg, white text + spinner. Matches.
- ✓ Send pill: terminalGreen bg, white text. Matches.
- ✓ Disconnect button: Circle bg searchBg, `xmark.circle.fill` 14pt textSecondary. Matches.
- ✓ `bolt.fill` icon trailing: terminalGreen if connected, text3 if not. Matches.
- ⚠ Hover state: Swift `.onHover { isHovering }` (macOS Catalyst). TS has no hover — N/A for mobile.
- ⚠ Swift card has `.animation(.easeInOut(duration:0.25), value:peer.status)` on background. TS has no transition on status change.

### C.4 ConnectPeerPopup (components/matching/ConnectPeerPopup.tsx)
- ✓ Popup card: corner radius 20, padding 20, border width 1 (cardBorder color). Matches.
- ✓ Shadow: black@20%, radius 20, offset y:10. Matches.
- ✓ Overlay: `Colors.overlayBg` rgba(41,26,46,0.45). Matches.
- ✓ Header avatar 54pt. Matches.
- ✓ Animated outer ring on connected: 60×60 featureAccent, scaleEffect 1.0→1.1 easeInOut 0.6s repeat. TS Reanimated `withRepeat(withTiming(1.1,600ms))` on a `Animated.View` 60×60. Matches.
- ✓ All phase copy text matches verbatim.
- ✓ Phase → button mapping matches (idle/connecting/connected/exchanging/success/error).
- ✓ Timeout 25s. Matches.
- ⚠ Swift header name font: `.headline` (system ~17pt semibold). TS `fontSize:17, fontWeight:'600'`. Matches.
- ✓ Header title: 12pt featureAccent. Matches.
- ✓ Header company: `caption2` = ~11pt. TS `fontSize:11`. Matches.

### C.5 IncomingInvitationPopup (components/matching/IncomingInvitationPopup.tsx)
- ✓ Card shape, shadow, overlay match ConnectPeerPopup (same values). Matches.
- ✓ Avatar 54pt + animated featureAccent outer ring 60×60. Matches.
- ✓ Body text "wants to connect with you" 15pt textSecondary centered. Matches.
- ✓ Decline (secondary) + Accept (primary with thumbsup icon) buttons. Matches.
- ✓ `didRespond` guard against double-tap. Matches.
- ⚠ Dismiss area: Swift fires `onDismiss()` via `.onDisappear`. TS has a `dismissArea` absolute Pressable behind the card. Slightly different UX (TS allows tap-outside to dismiss unconditionally; Swift fires onDismiss only on disappear).

---

## D. Me + Settings

### D.1 MeTab (app/(tabs)/me/index.tsx)
- ✓ Nav title "Me" 17pt semibold, trailing gear icon 18pt. Matches.
- ✓ Section headings "Verified Credentials" / "Selective Disclosures" / "Action" / "Developer". Matches.
- ✓ Empty state MeActionTile grid matches (2-col for Scan+Manual, full-width Import).
- ✓ Developer section: three rows with correct icons and labels. Matches.
- ❌ **Avatar:** Swift renders animal image or real profile photo. TS renders `InitialAvatar` (letter initial with primaryBlue@18% bg). **Animal image not wired.**
- ⚠ Avatar background: Swift `primaryBlue.opacity(0.18)`. TS `${Colors.primaryBlue}2E` = #007AFF @ 18%. Matches hex value.
- ✓ Scroll content padding top 12, bottom 100. Matches.
- ⚠ DID display: Swift reads live DID from `IdentityCoordinator`. TS hardcodes `'Initializing...'` always. **Functional gap but not a visual delta per se.**
- ⚠ Developer section "Group Management" trailing: Swift shows live `groupManager.groups.count`. TS hardcodes "0 Groups".
- ⚠ ScrollView VStack spacing: Swift `spacing:32`; TS `gap-8` (= 32pt). ✓ Matches.

### D.2 SettingsHub (app/settings/index.tsx)
- ✓ All 5 section titles and row titles match verbatim.
- ✓ Section gap: Swift `VStack(spacing:24)` between sections; TS `gap-6` (24pt). Matches.
- ✓ "About" section rendered inline without `SettingsBlockSection` wrapper. Matches.
- ❌ **Extra rows in TS:** "Notifications" and "Developer" rows present in TS Preferences section but absent from Swift `SettingsView`. These are additions, not in Swift source.
- ⚠ Navigation: Swift uses `NavigationLink` inline; TS uses `router.push`. Behavioural difference (push vs sheet presentation for some sub-pages) but not a visual delta.

### D.3 SettingsBlockRow / SettingsBlockSection (components/settings/SettingsBlocks.tsx)
- ✓ Section header: 14pt textPrimary, horizontal pad 16. Matches.
- ✓ Row padding: 14pt horizontal, 14pt vertical. Matches Swift.
- ✓ Row corner radius: Swift `RoundedRectangle(cornerRadius:12)`. TS `rounded-xl` (12pt). Matches.
- ✓ Icon frame 20×20, icon size 14pt. Matches.
- ✓ Title 15pt textPrimary; trailing 13pt textSecondary; chevron 12pt semibold text3. Matches.
- ✓ Toggle row vertical padding 12pt. Matches.
- ✓ Danger row padding 14pt vertical. Matches.
- ⚠ `SettingsBackToolbar` in TS shows a label (default "Settings") next to the chevron; Swift shows `title` parameter (default "Done"). Different default strings. Visual label diverges when using the default.

---

## E. Common Chrome + Tokens

### E.1 ThemedButton (components/themed/ThemedButton.tsx)
- ❌ **PRIMARY BUTTON COLOR (CRITICAL VISUAL MISMATCH):** Swift `ThemedPrimaryButtonStyle` background = `Color.Theme.textPrimary` (≈ #2F2F30, near-black). TS `variant="primary"` background = `Colors.accentRose` (#BF80A7, mauve-pink). **All primary CTAs are the wrong color throughout the entire app.**
- ❌ **INVERTED BUTTON COLOR:** Swift `ThemedInvertedButtonStyle` background = `Color.white` (pure white, no border). TS `variant="inverted"` uses `bg-cardBg border border-divider` = white + divider border. **Extra border on every inverted button.** Swift inverted has no border.
- ❌ **Button shape:** Swift `ThemedPrimaryButtonStyle` uses `.clipShape(Rectangle())` — sharp corners (0px radius). TS wraps in `rounded-2xl` (16pt corner radius) for all variants. **Shape divergence on every button in the app.**
- ✓ Vertical padding: Swift 14pt; TS `minHeight: 44` (md) with no explicit vertical padding — effective height is 44pt. Swift height = label + 14+14 = ~16+28 = 44pt. Approximately matches.
- ✓ Font: Swift 16pt medium; TS `titleMedium` = 17pt 600. 1pt delta + weight.
- ✓ Pressed scale: Swift `.scaleEffect(0.98)` with spring(response:0.15); TS has no press scale animation (`Pressable` opacity only via className). **Animation missing.**
- ✓ Secondary button: Swift `cardSurface` bg + `Rectangle().stroke(divider)`; TS `bg-transparent border border-divider`. Background differs (cardSurface translucent white vs transparent). **Secondary bg mismatch.**

### E.2 ThemedText Variants
- ✓ `headlineLarge` = 32pt 700. Swift equivalent is `.font(.system(size:32, weight:.bold))`. Matches.
- ✓ `headlineMedium` = 24pt 700. Swift uses 28pt bold for most step headers (SecureKeys, ImportContacts, AvatarSelection). **Size mismatch: ThemedText headlineMedium = 24pt but Swift step headers = 28pt.**
- ✓ `bodySmall` = 13pt 400. Swift step subtitles = 14pt regular. **1pt delta on every onboarding subtitle.**
- ✓ `label` = 13pt 600. Swift field labels = 14pt bold. **1pt delta on DarkProfileSetupStep labels.**
- ⚠ `caption` = 12pt 500. Swift captions = 12pt regular (weight mismatch, 500 vs 400).

### E.3 Colors.ts Token Coverage
- ✓ `pageBg`, `cardBg`, `searchBg`, `divider`, `text1/2/3` all present and match Swift names.
- ✓ `accentRose`, `primaryBlue`, `primaryMauve`, `destructive`, `terminalGreen`, `featureAccent` present.
- ✓ `radarRing`, `radarGlow` tokens exist. **But** `RadarMatching.tsx` uses `Colors.accentRose` for ring border — not `Colors.radarRing`. Mismatch within TS itself.
- ✓ `heroGradientStart/End`, `gradientCream`, `chipSurface`, `mutedSurface`, `pillSurface`, `bubbleOutgoing/Incoming` — all present.
- ⚠ `textPlaceholder` token: Swift uses `Color.Theme.textPlaceholder` in `DarkInputField`. TS uses `Colors.text3` as placeholder color. Token name differs but value likely similar.
- ⚠ `toolbarTint` token: Swift uses `Color.Theme.toolbarTint(for:colorScheme)` in SharingTabView. No equivalent dynamic token in TS Colors.ts.
- ⚠ `cardSurface(for:colorScheme)` is a function in Swift (returns adaptive color). TS has `cardSurface` as a static light-mode string. No dark-mode switch implemented in the token.

### E.4 Dark Mode
- ⚠ TS `Colors.ts` defines `*Dark` variants (e.g. `pageBgDark`) but NativeWind classes (`bg-pageBg`) only read the light values from `tailwind.config.js`. There is no evidence of a `@media (prefers-color-scheme: dark)` / Tailwind dark-mode config wiring in the audited files. **Dark mode is not functional in TS port.** Swift uses `Color.Theme.*` which automatically adapts.

---

## Summary Table

| Screen | Critical | High | Medium | Low |
|---|---|---|---|---|
| A.1 TerminalWelcomeStep | 0 | 1 (no button spring anim) | 3 | 0 |
| A.2 DarkProfileSetupStep | 0 | 1 (primary btn color) | 2 | 0 |
| A.3 AvatarSelectionGridStep | 0 | 2 (chip image crop, no anim) | 1 | 0 |
| A.4–A.7 Remaining Steps | 0 | 2 (primary btn color, badge shape) | 3 | 0 |
| B.1 PersonDetailView | 0 | 1 (no animal image) | 2 | 1 |
| B.2 TrustGraphContactRow | 0 | 0 | 2 | 0 |
| B.3 ContactRow | 0 | 3 (shape, emoji badge, size) | 0 | 0 |
| B.4 BusinessCardForm | 0 | 1 (primary btn color) | 0 | 0 |
| B.5 FocusedCardView | 0 | 2 (no animal image, theme color) | 1 | 0 |
| C.1 ShareTab | 0 | 1 (extra button) | 2 | 0 |
| C.2 RadarMatching | 0 | 3 (missing rings/orb/peers) | 2 | 0 |
| C.3 LightningPeerCard | 0 | 0 | 1 | 0 |
| C.4 ConnectPeerPopup | 0 | 0 | 1 | 0 |
| C.5 IncomingInvitationPopup | 0 | 0 | 1 | 0 |
| D.1 MeTab | 0 | 1 (no animal image) | 2 | 0 |
| D.2 SettingsHub | 0 | 1 (extra rows) | 0 | 0 |
| D.3 SettingsBlocks | 0 | 0 | 1 | 0 |
| E.1 ThemedButton | 0 | 3 (color, shape, no border) | 1 | 0 |
| E.2 ThemedText | 0 | 1 (headlineMedium 24 vs 28) | 2 | 0 |
| E.3 Colors | 0 | 1 (radarRing misuse) | 2 | 0 |
| E.4 Dark Mode | 0 | 1 (not wired) | 0 | 0 |

**TOTALS: 0 Critical | 23 High | 30 Medium | 1 Low**

---

## Top Impact Fixes

1. **ThemedButton shape + color (affects every CTA in app):**  
   Swift: `Rectangle()` (0px radius), primary bg = `textPrimary` (ink).  
   TS: `rounded-2xl` (16px radius), primary bg = `accentRose` (mauve).  
   Fix: Add `variant="inverted"` mapping to `bg-cardBg` (no border); change `primary` to `bg-invertedButtonBg`; remove `rounded-2xl` from base class and use `rounded-none` (or project-wide default matches Swift `Rectangle()`).

2. **RadarMatching component is a skeleton (affects Share tab hero):**  
   Swift renders 3 static concentric rings + radial glow sphere + center orb + peer avatars at polar positions.  
   TS renders only animated pulse rings + a static emoji.  
   Fix: Add static ring layer (85%/60%/35% diameter, 1pt radarRing stroke), center glow (`Colors.radarGlow`), center orb (`Colors.featureAccent`), and accept a `peers` prop for avatar positioning.

3. **Animal image not rendered in PersonDetail / MeTab / FocusedCardView:**  
   Swift uses `ImageProvider.animalImage(for:)` at 88pt (PersonDetail), 56pt (MeTab avatar), 72pt (FocusedCardView).  
   TS shows text initials or empty space.  
   Fix: wire `animalImageSource(animal)` (already used in AvatarSelectionGridStep) into all three locations.

