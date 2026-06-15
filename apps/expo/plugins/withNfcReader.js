/**
 * Expo config plugin — wires up the Podfile, entitlements, and Info.plist
 * keys for iOS ePassport NFC reading.
 *
 * What `expo prebuild` already gives us (from app.json):
 *   - NSCameraUsageDescription
 *   - NFCReaderUsageDescription
 *   - com.apple.developer.nfc.readersession.formats = ["TAG"]
 *
 * What this plugin adds on top:
 *   - NFCPassportReader 2.3.0 from GitHub (CocoaPods trunk is no longer the
 *     source of truth for newer NFCPassportReader releases).
 *   - Idempotent guarantee that NFC formats=["TAG"] is present in
 *     entitlements (in case app.json drift removes it).
 *   - Default NFCReaderUsageDescription if missing from Info.plist.
 *   - ICAO ePassport AID in Info.plist, matching the legacy Swift app and
 *     NFCPassportReader examples.
 *
 * Important: iso7816.select-identifiers is intentionally NOT added to
 * entitlements. Apple's signing service rejects that sub-entitlement on the
 * Xcode-managed App ID even with "NFC Tag Reading" enabled. CoreNFC /
 * NFCPassportReader examples place the ePassport AID in Info.plist, which
 * avoids changing the signed entitlements payload.
 */
const fs = require('node:fs');
const path = require('node:path');

const {
  withDangerousMod,
  withInfoPlist,
  withEntitlementsPlist,
} = require('@expo/config-plugins');

const NFC_FORMATS = ['TAG'];
const EPASSPORT_AIDS = ['A0000002471001'];
const NFC_PASSPORT_READER_POD =
  "  pod 'NFCPassportReader', :git => 'https://github.com/AndyQ/NFCPassportReader.git', :tag => '2.3.0'";

function uniq(arr) {
  return Array.from(new Set(arr));
}

const withNfcReader = (config) => {
  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.projectRoot, 'ios', 'Podfile');
      if (!fs.existsSync(podfilePath)) {
        console.warn(`[withNfcReader] missing ${podfilePath}`);
        return cfg;
      }

      const original = fs.readFileSync(podfilePath, 'utf8');
      if (original.includes("pod 'NFCPassportReader'")) {
        return cfg;
      }

      const anchor = "target 'Solidarity' do\n  use_expo_modules!";
      if (!original.includes(anchor)) {
        console.warn(`[withNfcReader] anchor not found in Podfile`);
        return cfg;
      }

      const patched = original.replace(
        anchor,
        `${anchor}\n\n  # iOS ePassport NFC reader — see plugins/withNfcReader.js\n${NFC_PASSPORT_READER_POD}`,
      );
      fs.writeFileSync(podfilePath, patched);
      console.log('[withNfcReader] injected NFCPassportReader pod into Podfile');
      return cfg;
    },
  ]);

  config = withEntitlementsPlist(config, (cfg) => {
    const formatsKey = 'com.apple.developer.nfc.readersession.formats';
    const prevFormats = Array.isArray(cfg.modResults[formatsKey])
      ? cfg.modResults[formatsKey]
      : [];
    cfg.modResults[formatsKey] = uniq([...prevFormats, ...NFC_FORMATS]);

    // Strip entitlement-level iso7816 if it exists from a previous prebuild.
    // The AID belongs in Info.plist for this app so automatic signing keeps
    // working with the Xcode-managed App ID.
    delete cfg.modResults['com.apple.developer.nfc.readersession.iso7816.select-identifiers'];
    return cfg;
  });

  config = withInfoPlist(config, (cfg) => {
    if (!cfg.modResults['NFCReaderUsageDescription']) {
      cfg.modResults['NFCReaderUsageDescription'] =
        "Solidarity reads your passport's NFC chip to verify identity.";
    }
    const aidsKey = 'com.apple.developer.nfc.readersession.iso7816.select-identifiers';
    const prevAids = Array.isArray(cfg.modResults[aidsKey])
      ? cfg.modResults[aidsKey]
      : [];
    cfg.modResults[aidsKey] = uniq([...prevAids, ...EPASSPORT_AIDS]);
    return cfg;
  });

  return config;
};

module.exports = withNfcReader;
