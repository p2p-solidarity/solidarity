# nitro-nfc-passport Android assets

## `masterList.pem`

Synced from `solidarity/Resources/masterList.pem` (the Swift host app).
Concatenated PEM bundle of ICAO CSCA (Country Signing Certificate
Authority) root certificates, used by `HybridNfcPassport.kt` to
passively authenticate the passport's Security Object (SOD) signature
chain.

The bytes are intentionally duplicated (not symlinked) so the Android
AAR self-contains the trust anchors and `AssetManager.open` resolves
under the standard `assets/` path. If you update one, update the other.

Refresh source: `scripts/generate_masterlist.py` in the Swift project
root (pulls OpenPassport's published CSCA snapshot).
