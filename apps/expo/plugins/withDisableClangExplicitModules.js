/**
 * Expo config plugin — inject a Podfile post_install snippet that
 * (1) disables Clang/Swift Explicit Modules across the Pods workspace, and
 * (2) downgrades `-Wmodule-import-in-extern-c` from error to silent for
 *     every pod target and the main app.
 *
 * Why: OpenSSL-Universal 3.3.x (pulled via NFCPassportReader 2.3.0,
 * required by nitro-modules/nfc-passport) ships headers that import C++
 * sub-modules inside `extern "C" { … }`. Xcode 26's Clang strict mode
 * promotes that to a hard error when building the implicit OpenSSL
 * module, breaking the archive with:
 *
 *   error: import of C++ module 'std_stdint_h' appears within
 *          extern "C" language linkage specification
 *   <unknown>:0: error: could not build Objective-C module 'OpenSSL'
 *
 * Disabling explicit modules alone was insufficient — the diagnostic
 * fires during *implicit* module build too. The `-Wno-error=...` flag
 * downgrades the diagnostic so the OpenSSL module compiles cleanly until
 * upstream ships clean headers or we drop NFCPassportReader on iOS.
 *
 * Pattern mirrors withRustXcframeworkSearchPath — dangerous-mod so the
 * injection survives `expo prebuild --clean`.
 */
const fs = require('node:fs');
const path = require('node:path');

const { withDangerousMod } = require('@expo/config-plugins');

const MARKER_BEGIN = '# [withDisableClangExplicitModules] BEGIN';
const MARKER_END = '# [withDisableClangExplicitModules] END';

const SNIPPET = `
    ${MARKER_BEGIN}
    suppress_cc = ['-Wno-error=module-import-in-extern-c', '-Wno-module-import-in-extern-c']
    suppress_swift = ['-Wno-error=module-import-in-extern-c', '-Wno-module-import-in-extern-c']
    installer.pods_project.targets.each do |t|
      t.build_configurations.each do |c|
        c.build_settings['CLANG_ENABLE_MODULES'] = 'YES'
        c.build_settings['_EXPERIMENTAL_CLANG_EXPLICIT_MODULES'] = 'NO'
        c.build_settings['CLANG_ENABLE_EXPLICIT_MODULES'] = 'NO'
        c.build_settings['SWIFT_ENABLE_EXPLICIT_MODULES'] = 'NO'
        %w[OTHER_CFLAGS OTHER_CPLUSPLUSFLAGS].each do |k|
          cur = c.build_settings[k]
          arr = cur.is_a?(Array) ? cur.dup : (cur.is_a?(String) ? cur.split(' ') : ['$(inherited)'])
          suppress_cc.each { |f| arr << f unless arr.include?(f) }
          c.build_settings[k] = arr
        end
        cur = c.build_settings['OTHER_SWIFT_FLAGS']
        arr = cur.is_a?(Array) ? cur.dup : (cur.is_a?(String) ? cur.split(' ') : ['$(inherited)'])
        suppress_swift.each do |f|
          next if arr.include?(f)
          arr << '-Xcc'
          arr << f
        end
        c.build_settings['OTHER_SWIFT_FLAGS'] = arr
      end
    end
    # Append to each aggregate xcconfig so the main app picks the flags up.
    # Editing in place (not via a new assignment) so existing $(inherited)
    # values are preserved.
    installer.aggregate_targets.each do |agg|
      agg.user_build_configurations.each_key do |cfg_name|
        xc = agg.xcconfig_path(cfg_name)
        next unless File.exist?(xc)
        body = File.read(xc)
        body = body.gsub(/^EXCLUDED_ARCHS\\[sdk=iphonesimulator\\*\\] = arm64\\s*\\n?/, '')
        appends = []
        appends << "_EXPERIMENTAL_CLANG_EXPLICIT_MODULES = NO" unless body.include?('_EXPERIMENTAL_CLANG_EXPLICIT_MODULES')
        appends << "CLANG_ENABLE_EXPLICIT_MODULES = NO"        unless body.include?('CLANG_ENABLE_EXPLICIT_MODULES')
        appends << "SWIFT_ENABLE_EXPLICIT_MODULES = NO"        unless body.include?('SWIFT_ENABLE_EXPLICIT_MODULES =')
        # Splice flags into the *existing* OTHER_* lines so we don't shadow
        # the upstream pod-managed values with a new assignment.
        body = body.gsub(/^OTHER_CFLAGS = (.+)$/) { |line| line.include?('module-import-in-extern-c') ? line : "OTHER_CFLAGS = #{$1} -Wno-error=module-import-in-extern-c -Wno-module-import-in-extern-c" }
        body = body.gsub(/^OTHER_CPLUSPLUSFLAGS = (.+)$/) { |line| line.include?('module-import-in-extern-c') ? line : "OTHER_CPLUSPLUSFLAGS = #{$1} -Wno-error=module-import-in-extern-c -Wno-module-import-in-extern-c" }
        body = body.gsub(/^OTHER_SWIFT_FLAGS = (.+)$/) { |line| line.include?('module-import-in-extern-c') ? line : "OTHER_SWIFT_FLAGS = #{$1} -Xcc -Wno-error=module-import-in-extern-c -Xcc -Wno-module-import-in-extern-c" }
        body = "#{body.chomp}\n#{appends.join("\\n")}\n" unless appends.empty?
        File.write(xc, body)
      end
    end
    ${MARKER_END}
`;

const withDisableClangExplicitModules = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) {
        console.warn(`[withDisableClangExplicitModules] no Podfile at ${podfilePath}`);
        return cfg;
      }
      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (contents.includes(MARKER_BEGIN)) return cfg;

      const patched = contents.replace(
        /(react_native_post_install\([\s\S]*?\n\s*\)\n)/,
        `$1${SNIPPET}`,
      );
      if (patched === contents) {
        console.warn('[withDisableClangExplicitModules] anchor not found, skipping');
        return cfg;
      }
      fs.writeFileSync(podfilePath, patched);
      console.log('[withDisableClangExplicitModules] patched Podfile');
      return cfg;
    },
  ]);

module.exports = withDisableClangExplicitModules;
