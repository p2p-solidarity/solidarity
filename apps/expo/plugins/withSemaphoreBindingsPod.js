/**
 * Expo config plugin — injects the sibling `SemaphoreBindings` pod into
 * the Solidarity target's Podfile after every `expo prebuild`.
 *
 * SemaphoreBindings isn't autolinked by `use_native_modules!` because
 * it's not a React Native package — it's a static-library xcframework
 * wrapper (uniffi-generated `mopro.swift` + `libsemaphore_bindings.a`)
 * sitting next to the Semaphore Nitro pod, kept in its own Swift
 * module so its uniffi internals (RustBuffer, FfiConverter, Group,
 * Identity…) don't leak into HybridSemaphoreSpec's Swift→C++ interop
 * header (which Nitrogen autogenerates with strict type visibility).
 *
 * Twin of `withMoproBindingsPod.js` — same pattern.
 */
const fs = require('node:fs');
const path = require('node:path');

const { withDangerousMod } = require('@expo/config-plugins');

const POD_LINE =
  "  pod 'SemaphoreBindings', :path => '../../../nitro-modules/attest/semaphore/mopro'";

const withSemaphoreBindingsPod = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.projectRoot, 'ios', 'Podfile');
      if (!fs.existsSync(podfilePath)) {
        console.warn(`[withSemaphoreBindingsPod] missing ${podfilePath}`);
        return cfg;
      }
      const original = fs.readFileSync(podfilePath, 'utf8');
      if (original.includes("pod 'SemaphoreBindings'")) {
        return cfg;
      }
      const anchor = "target 'Solidarity' do\n  use_expo_modules!";
      if (!original.includes(anchor)) {
        console.warn(`[withSemaphoreBindingsPod] anchor not found in Podfile`);
        return cfg;
      }
      const patched = original.replace(
        anchor,
        `${anchor}\n\n  # Sibling pod to Attest — see plugins/withSemaphoreBindingsPod.js\n${POD_LINE}`
      );
      fs.writeFileSync(podfilePath, patched);
      console.log(
        `[withSemaphoreBindingsPod] injected SemaphoreBindings pod into Podfile`
      );
      return cfg;
    },
  ]);

module.exports = withSemaphoreBindingsPod;
