/**
 * Expo config plugin — wires up the entitlements + Info.plist keys for
 * iOS NFC tag reading.
 *
 * What `expo prebuild` already gives us (from app.json):
 *   - NSCameraUsageDescription
 *   - NFCReaderUsageDescription
 *   - com.apple.developer.nfc.readersession.formats = ["TAG"]
 *
 * What this plugin adds on top:
 *   - Idempotent guarantee that NFC formats=["TAG"] is present in
 *     entitlements (in case app.json drift removes it).
 *   - Default NFCReaderUsageDescription if missing from Info.plist.
 *
 * iso7816.select-identifiers (ICAO ePassport AIDs) is INTENTIONALLY NOT
 * added here. Apple's signing service rejects this sub-entitlement on
 * the Xcode-managed App ID even with "NFC Tag Reading" enabled, breaking
 * automatic signing. Android handles passport NFC reading; iOS uses
 * MRZ-only on the camera. If iOS ePassport NFC is needed later, the AIDs
 * must be re-introduced here AND the App ID re-created (or escalated to
 * Apple Developer Support) so the iso7816 entitlement is honoured.
 */
const { withInfoPlist, withEntitlementsPlist } = require('@expo/config-plugins');

const NFC_FORMATS = ['TAG'];

function uniq(arr) {
  return Array.from(new Set(arr));
}

const withNfcReader = (config) => {
  config = withEntitlementsPlist(config, (cfg) => {
    const formatsKey = 'com.apple.developer.nfc.readersession.formats';
    const prevFormats = Array.isArray(cfg.modResults[formatsKey])
      ? cfg.modResults[formatsKey]
      : [];
    cfg.modResults[formatsKey] = uniq([...prevFormats, ...NFC_FORMATS]);

    // Strip iso7816 if it exists from a previous prebuild — see header.
    delete cfg.modResults['com.apple.developer.nfc.readersession.iso7816.select-identifiers'];
    return cfg;
  });

  config = withInfoPlist(config, (cfg) => {
    if (!cfg.modResults['NFCReaderUsageDescription']) {
      cfg.modResults['NFCReaderUsageDescription'] =
        "Solidarity reads your passport's NFC chip to verify identity.";
    }
    delete cfg.modResults['com.apple.developer.nfc.readersession.iso7816.select-identifiers'];
    return cfg;
  });

  return config;
};

module.exports = withNfcReader;
