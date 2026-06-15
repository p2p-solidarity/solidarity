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

## `passportRevocationSnapshot.v3.json`

Generated from real DSC revocation sources: ICAO PKD `dsccrl` LDIF files
or PEM/DER CRLs. This file is not hand-authored and should not be replaced
with an empty placeholder. If no revocation source is available, OpenAC v3
passport proofs must remain unavailable instead of using an empty SMT.

Refresh source:

```sh
python3 scripts/generate_masterlist.py \
  --revocation-source /path/to/icaopkd-001-dsccrl-*.ldif
```
