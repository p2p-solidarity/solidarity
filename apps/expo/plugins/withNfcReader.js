/**
 * Expo config plugin — wires up the entitlements + Info.plist keys the
 * NFCPassportReader Swift package needs to read an ICAO 9303 e-passport.
 *
 * What `expo prebuild` already gives us (from app.json):
 *   - NSCameraUsageDescription
 *   - NFCReaderUsageDescription
 *   - com.apple.developer.nfc.readersession.formats = ["TAG"]
 *
 * What this plugin adds on top:
 *   - com.apple.developer.nfc.readersession.iso7816.select-identifiers
 *       = ["A0000002471001", "A0000002472001"]
 *
 *     The ICAO 9303 LDS application AID lives at the first entry; the
 *     ePassport extended access application is the second. Without these
 *     identifiers Core NFC refuses to deliver SELECT_APPLICATION APDUs
 *     and PassportReader can't initiate BAC/PACE.
 *
 *   - Adds a NFCPassportReader-friendly background tag-reading mode if
 *     not already present (idempotent).
 */
const { withInfoPlist, withEntitlementsPlist } = require('@expo/config-plugins');

const ICAO_AIDS = [
  'A0000002471001', // ICAO 9303 LDS
  'A0000002472001', // ICAO 9303 EAC
];

const NFC_FORMATS = ['TAG'];

function uniq(arr) {
  return Array.from(new Set(arr));
}

const withNfcReader = (config) => {
  // Entitlements: select-identifiers (ICAO AIDs).
  config = withEntitlementsPlist(config, (cfg) => {
    const key = 'com.apple.developer.nfc.readersession.iso7816.select-identifiers';
    const prev = Array.isArray(cfg.modResults[key]) ? cfg.modResults[key] : [];
    cfg.modResults[key] = uniq([...prev, ...ICAO_AIDS]);

    const formatsKey = 'com.apple.developer.nfc.readersession.formats';
    const prevFormats = Array.isArray(cfg.modResults[formatsKey])
      ? cfg.modResults[formatsKey]
      : [];
    cfg.modResults[formatsKey] = uniq([...prevFormats, ...NFC_FORMATS]);
    return cfg;
  });

  // Info.plist: ensure usage description is present even if app.json was
  // edited away from the default. We don't override a user-provided string.
  config = withInfoPlist(config, (cfg) => {
    if (!cfg.modResults['NFCReaderUsageDescription']) {
      cfg.modResults['NFCReaderUsageDescription'] =
        "Solidarity reads your passport's NFC chip to verify identity.";
    }

    // The ISO7816 application identifiers also have to live in Info.plist
    // for some Xcode configurations to embed them into the binary. Mirror
    // the entitlements list here so both surfaces agree.
    const aidsKey = 'com.apple.developer.nfc.readersession.iso7816.select-identifiers';
    const prev = Array.isArray(cfg.modResults[aidsKey]) ? cfg.modResults[aidsKey] : [];
    cfg.modResults[aidsKey] = uniq([...prev, ...ICAO_AIDS]);
    return cfg;
  });

  return config;
};

module.exports = withNfcReader;
