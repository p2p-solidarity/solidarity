#!/usr/bin/env node
/**
 * Regenerates `apps/expo/pear/worklet/dist/index.bundle.js` — the
 * `bare-pack` bundle `Worklet.start('/app.bundle', bundle)` loads. See
 * `pear/worklet/index.js`'s header for the RN<->worklet wire protocol.
 *
 * Usage:
 *   bun run pear:pack        # from apps/expo
 *   node scripts/pack-pear-worklet.mjs
 *
 * Follows docs.pears.com's mobile bundling guide exactly (pear-docs
 * `guide/making-a-bare-mobile-app.md` §"Bundling the Pear-end"):
 *
 *   npx bare-pack --host ios-arm64 --host ios-arm64-simulator \
 *     --host ios-x64-simulator --host android-arm64 --host android-x64 \
 *     --linked --out <bundle> <entry>
 *
 * `--linked` resolves hyperswarm's native addons (sodium-native for
 * crypto, udx-native for UDP — Hermes has neither) to `linked:`
 * specifiers instead of embedding prebuilt binaries in the bundle text.
 * At *app* build time, react-native-bare-kit's own `ios/link.mjs` /
 * `android/link.mjs` (both call `bare-link`) walk a package.json's
 * `dependencies` and statically link any matching `addon: true` package's
 * prebuilt `.xcframework` (iOS) / `.so` (Android) into the app — that's
 * what makes `linked:sodium-native.<ver>.framework/...` resolvable at
 * runtime.
 *
 * MONOREPO GOTCHA (why hyperswarm is ALSO a *root* package.json
 * dependency, not just apps/expo's): `ios/link.mjs` computes its walk
 * root as `path.join(__filename, '..', '..', '..', '..')` — four
 * directories up from `node_modules/react-native-bare-kit/ios/link.mjs`.
 * Bun hoists `node_modules` to the workspace root, so that path lands on
 * the ROOT package.json, not `apps/expo/package.json`. A dependency only
 * declared in `apps/expo/package.json` is invisible to that walk and
 * silently link nothing (no error — `bare-link` just yields zero
 * resources). Confirmed by direct invocation during A3.2 spike-testing:
 * `bare-link(<repo-root>, ...)` found nothing until hyperswarm was added
 * to the root `dependencies`, matching root's existing (pre-A3.2)
 * duplication of `react`/`react-native`/`expo` for presumably the same
 * class of reason.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const entry = path.join(appRoot, 'pear', 'worklet', 'index.js');
const outDir = path.join(appRoot, 'pear', 'worklet', 'dist');
const out = path.join(outDir, 'index.bundle.js');

// `.bundle.js` -> bare-pack infers format `bundle.cjs` (a CommonJS wrapper
// around the raw bundle). We pick this over `.bundle.mjs` deliberately:
// Metro's default `sourceExts` (via `@expo/metro-config`) explicitly adds
// `cjs` but NOT `mjs`, so a `.js`/`.cjs`-extensioned bundle resolves and
// transforms with zero Metro config changes; `lane.ts` does a plain
// `import bundle from '../../pear/worklet/dist/index.bundle.js'`.
const HOSTS = [
  'ios-arm64',
  'ios-arm64-simulator',
  'ios-x64-simulator',
  'android-arm64',
  'android-x64',
];

if (!existsSync(entry)) {
  console.error(`pack-pear-worklet: entry not found at ${entry}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const args = ['bare-pack'];
for (const host of HOSTS) args.push('--host', host);
args.push('--linked', '--out', out, entry);

console.log(`pack-pear-worklet: npx ${args.join(' ')}`);
try {
  execFileSync('npx', args, { cwd: appRoot, stdio: 'inherit' });
} catch (error) {
  console.error('pack-pear-worklet: bare-pack failed —', error instanceof Error ? error.message : error);
  process.exit(1);
}

console.log(`pack-pear-worklet: wrote ${path.relative(appRoot, out)}`);
