/**
 * Expo config plugin — injects the sibling `MoproBindings` pod into the
 * Solidarity target's Podfile after every `expo prebuild`.
 *
 * MoproBindings isn't autolinked by `use_native_modules!` because it's
 * not a React Native package — it's a static-library xcframework wrapper
 * sitting next to PassportZK, kept in a separate Swift module so its
 * uniffi types (RustBuffer, NoirProofResult, FfiConverter…) don't leak
 * into the Hybrid spec's Swift→C++ interop header.
 */
const fs = require('node:fs');
const path = require('node:path');

const { withDangerousMod } = require('@expo/config-plugins');

const POD_LINE =
  "  pod 'MoproBindings', :path => '../../../nitro-modules/attest/mopro'";

const withMoproBindingsPod = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.projectRoot, 'ios', 'Podfile');
      if (!fs.existsSync(podfilePath)) {
        console.warn(`[withMoproBindingsPod] missing ${podfilePath}`);
        return cfg;
      }
      const original = fs.readFileSync(podfilePath, 'utf8');
      if (original.includes("pod 'MoproBindings'")) {
        return cfg;
      }
      const anchor = "target 'Solidarity' do\n  use_expo_modules!";
      if (!original.includes(anchor)) {
        console.warn(`[withMoproBindingsPod] anchor not found in Podfile`);
        return cfg;
      }
      const patched = original.replace(
        anchor,
        `${anchor}\n\n  # Sibling pod to Attest — see plugins/withMoproBindingsPod.js\n${POD_LINE}`
      );
      fs.writeFileSync(podfilePath, patched);
      console.log(`[withMoproBindingsPod] injected MoproBindings pod into Podfile`);
      return cfg;
    },
  ]);

module.exports = withMoproBindingsPod;
