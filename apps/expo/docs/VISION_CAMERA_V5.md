# `react-native-vision-camera` v5 verification (2026-05-24)

## What the user hit

```
PluginError: Cannot find module '.../react-native-vision-camera/lib/VisionCamera'
  imported from '.../react-native-vision-camera/lib/CameraDevices.js'
No "app.plugin.{js,cjs,mjs,ts,cts,mts}" file was found in "react-native-vision-camera",
so the package's main entry was loaded instead.
```

## Confirmed by inspecting the published 5.0.10 tarball

```bash
npm pack --dry-run --json react-native-vision-camera@5.0.10 | jq '.[0].files'
```

| Thing | Status in v5.0.10 |
|---|---|
| `lib/VisionCamera.js` (the file the error claims missing) | **shipped** |
| `lib/CameraDevices.js` (which requires `./VisionCamera`) | shipped |
| `app.plugin.js` / `.cjs` / `.mjs` / `.ts` | **MISSING** |

So the file is there. The bug is:

1. Vision-camera v5 doesn't ship an Expo config plugin (`app.plugin.js`).
2. Expo therefore loads the package's `main` entry as the plugin.
3. Inside Bun's `--linker=symlinked` layout (the default), the relative
   `require('./VisionCamera')` from `lib/CameraDevices.js` resolves
   through the `.bun/react-native-vision-camera@5.0.10+<hash>/...`
   path, and the Node CJS resolver can't follow the deeper relative
   imports the package does when loaded as a plugin entry.

## Verdict

**v5 is not usable as an Expo config plugin until Margelo ships an
`app.plugin.js`.** This is independent of our project; any Expo app on
bun (and likely npm/yarn too) hits the same wall.

## Workaround we ship today

Pin `^4.7.3` in `apps/expo/package.json`:

- v4 has `app.plugin.js` at the package root → no transitive imports.
- v4's `useCameraDevice` + `useCodeScanner` API is identical to the
  bits we use in `apps/expo/src/scan/QrScanner.tsx`, so the call sites
  don't change.
- Frame processors still run on a Nitro-backed worklet thread.

## When to revisit

Watch [margelo/react-native-vision-camera#3xxx](https://github.com/mrousavy/react-native-vision-camera/issues)
for an `app.plugin.js` PR in a 5.x patch. Once that lands, bump:

```diff
- "react-native-vision-camera": "^4.7.3",
+ "react-native-vision-camera": "^5.x.y",
```

…re-run `bunx expo prebuild --clean --platform ios`, verify the
generated `ios/Podfile` includes `VisionCamera` and that scan still
works (the v5 Nitro APIs are a superset of v4).
