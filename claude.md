# Solidarity

## Rules (must-read)
- Read before edit; reuse, no dup.
- No mock; `.sample`=Preview.
- `Color.Theme.*` + `Themed*ButtonStyle` only.
- Sec (NFC/ZK/sign): no force-unwrap/fatalError/PII logs. Return `Result`.
- Face ID: passport save, exchange, sign, present, delete, export.

## Build
iOS26/17. `-skipPackagePluginValidation`. `kidneyweakx.airmeishi`.

## Tokens
pageBg/cardBg/searchBg/divider/text{1,2,3}/accentRose. Themed{Primary,Inverted,Secondary,DottedOutline,Destructive}.

### 8. No fake data — ever

Anything that looks like real, computed, scene-specific, user-specific, or source-of-truth data **must come from a real source**. If the real source isn't available, the UI shows a real loading or error state — never a plausible-looking placeholder.

This rule exists because we shipped (and then ripped out) `fallbackAnalysisFromUrl()` — a function that hashed an image URL into "plausible" RGB averages so the tiles always rendered something. The tiles looked correct and were completely meaningless. We also hardcoded `K-On! S2 EP{ep}` and `修学院駅の夕暮れ — 唯と憂が電車を待つ印象的なシーン` into a generic pilgrimage tips screen, so every spot in every anime claimed to be K-On Episode 2. Both are the same bug: **content that pretends to know something it doesn't**.

Specifically forbidden:

- ❌ **Hash/seed/random → plausible-looking numbers** (`fallbackAnalysisFromUrl` style). If analysis fails, return `null` and render an error tile (`'無法分析'` / `'Image unavailable'`).
- ❌ **Hardcoded scene-specific strings** in screens that render for any scene (e.g. anime title, episode caption, station name, character dialogue) unless they come from the route params or a real data source. If you only have a fallback, make it generic ("原作場景", not "K-On! EP2").
- ❌ **Mock arrays committed to production code paths** (`const SAMPLE_SPOTS = [...]`). Mocks live in `__tests__/` or behind a dev flag, never on the render path.
- ❌ **Lorem ipsum / placeholder copy** shipped in production screens. Either pass the real string via props or render an empty state.
- ❌ **Fake counters, stats, ratings, distances, dates** computed from anything other than the actual data (`Math.random()`, `Date.now() % 5`, "popular" rankings with no source).
- ❌ **Screen-specific "data" hidden in JSX** (e.g. `Avoid weekends 14:00–16:00` written inline as if we know peak hours for this spot — we don't). Either drive it from real data or make it generic guidance.

The three real states for any data-driven component:

| State | What to render |
|-------|----------------|
| `loading` | Skeleton / "分析中…" / spinner — clearly transient |
| `ready` | The real computed value |
| `error` / `null` | "無法分析" / "Unavailable" — clearly *no data*, not a guess |

When in doubt, ask: "would a screenshot of this screen mislead the user about what we actually know?" If yes, it's fake data.

Generic guidance is fine (rule of thirds, "use eye-level for portraits", "avoid flash indoors") — that's photography knowledge, not pretending to be scene-specific data. The line is: **does it claim to know something specific about this scene/user/spot?** If yes, it must be real.

### 9. State ownership → keep render state small and local

React state is for values that must change rendered JSX. Do **not** put every interaction, sensor tick, gesture value, cache snapshot, and async phase into the screen root. Large screens with many independent `useState` / `useEffect` calls become hard to reason about and can re-render expensive children unnecessarily.

Use the narrowest owner for each kind of state:

| State kind | Default owner |
|------------|---------------|
| Gesture / animation / sensor ticks | Reanimated `SharedValue` or a ref-backed subscription, with throttled React mirrors only when text/chips must update |
| Imperative handles, in-flight flags not rendered, cancellation tokens | `useRef` |
| Derived values from props/state | `useMemo` or plain local constants, not mirrored `useState` |
| Persisted preferences / cross-screen data | Feature service/store hook with a small public API |
| Modal, selected tab, current filter | Local state in the smallest component that renders that control |
| Large async resource (`data/loading/error`) | One reducer or feature hook, not three unrelated setters spread through the screen |

For camera and map screens specifically:

- High-frequency values (`zoom`, `tilt`, heading, pan/drag, WebView marker updates) must stay off the React render path unless the UI needs a coarse display value.
- The route screen should orchestrate navigation and feature hooks; it should not own every HUD toggle, capture phase, settings sheet, spot switcher, and sensor state directly.
- If adding a new camera control requires another top-level `useState` in `compare/[spotId].tsx`, first ask whether it belongs in `useCameraSettings`, a camera HUD hook, a child component, a `SharedValue`, or a reducer.
- Avoid effects whose only job is to reconcile state that could have been derived. If reconciliation is necessary, keep it close to the state it fixes and guard against redundant setter calls.
- Before optimizing, profile or at least count render-triggering state changes. Fix the state with the largest render fan-out, not the state that is merely visually nearby.

### 10. Navigation feel → never `await` on the first-paint path

Skeletons are for **cold** loads only. If a skeleton flashes when the data is already local, that's a bug. Background: detail screens used `setLoading(true)` + `await CacheService.get()` on mount, so even 5-second-old cache hits showed a skeleton for ~200ms. Discord's "Supercharging Discord Mobile" is the reference.

**Budget**: tap → first frame must do <16ms of JS and show real chrome (header, poster, title), not a skeleton.

**Rules**:

1. **Sync cache on the render path.** `CacheService.getSync<T>(key)` returns the in-memory mirror or `null` — call it inside `useState(() => …)` so initial state is non-null on warm hits. `await CacheService.get()` belongs only in background revalidation. Render shape: `data ?? <Skeleton/>`, not `loading ? <Skeleton/> : data`.
2. **Route params carry chrome.** List → detail must pass `{ id, title, poster, format?, year? }` via `router.push({ pathname, params })`. The detail screen reads them from `useLocalSearchParams()` and paints the hero on frame 1, before any I/O resolves.
3. **`useFocusEffect` is a refresh trigger, not a load trigger.** Guard with `lastLoadedKey === currentKey` and skip; if you must revalidate, do it silently — never clear state and re-show a skeleton.
4. **Don't wrap I/O in `InteractionManager.runAfterInteractions`.** That defers the network call itself, so cache hits also wait for the push animation. Defer the *expensive child state setter* via `requestAnimationFrame`, never the fetch.
5. **Stale-while-revalidate via `getWithMeta(key, graceMs)`** — render stale, refresh silently. Only surface a "refreshing…" affordance after ~500ms.
6. **Prefetch on press-in or onViewableItemsChanged**, not on mount of the next screen. Kick off `AnimeRepository.getAnimeDetails(id)` + `Image.prefetch(poster)` from the list.
7. **Don't add `unmountOnBlur` / new top-level Context providers.** Tabs staying mounted is the feature, not the bug. New cross-screen state goes in a feature store with selector subscription.

**Checklist for any new/touched screen**:

- [ ] Cache hit → frame 1 shows real chrome, not skeleton
- [ ] Tab re-focus with snapshot → no visible reload
- [ ] Zero `await`s between mount and first paint
- [ ] `loading` initial value derives from sync cache miss, not `true`
- [ ] List that links here calls prefetch on press-in
