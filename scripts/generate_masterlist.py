#!/usr/bin/env python3
"""
Fetches CSCA certificates from Self (OpenPassport) skiPem.ts and converts
them to a concatenated PEM file for NFCPassportReader.

Also requires real DSC revocation sources and writes a deterministic
OpenAC v3 revocation snapshot. Supported revocation inputs:
  * ICAO PKD dsccrl LDIF files (`icaopkd-001-dsccrl-*.ldif`)
  * PEM/DER encoded X.509 CRLs

Source: https://github.com/selfxyz/self (MIT license)
Outputs:
  * solidarity/Resources/masterList.pem
  * solidarity/Resources/passportRevocationSnapshot.v3.json
  * nitro-modules/nfc-passport/android/src/main/assets/passportRevocationSnapshot.v3.json

Usage:
    python3 scripts/generate_masterlist.py \
      --revocation-source /path/to/icaopkd-001-dsccrl-*.ldif
"""

import base64
import argparse
import hashlib
import json
import re
import textwrap
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from cryptography import x509

SKI_PEM_URL = (
    "https://raw.githubusercontent.com/selfxyz/self/main/"
    "common/src/constants/skiPem.ts"
)

OUTPUT_PATH = Path(__file__).parent.parent / "solidarity" / "Resources" / "masterList.pem"
REVOCATION_SNAPSHOT_PATH = (
    Path(__file__).parent.parent
    / "solidarity"
    / "Resources"
    / "passportRevocationSnapshot.v3.json"
)
ANDROID_REVOCATION_SNAPSHOT_PATH = (
    Path(__file__).parent.parent
    / "nitro-modules"
    / "nfc-passport"
    / "android"
    / "src"
    / "main"
    / "assets"
    / "passportRevocationSnapshot.v3.json"
)

LDIF_CRL_ATTRIBUTES = (
    "certificateRevocationList;binary",
    "certificateRevocationList",
    "authorityRevocationList;binary",
    "authorityRevocationList",
)


def fetch_ski_pem_ts() -> str:
    print(f"Fetching skiPem.ts from {SKI_PEM_URL} ...")
    req = urllib.request.Request(SKI_PEM_URL)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read().decode("utf-8")
    print(f"  Downloaded {len(data):,} bytes")
    return data


def extract_certificates(ts_content: str) -> list[tuple[str, str]]:
    """Extract (ski, base64_der) pairs from the TypeScript source."""
    # Pattern: "hex_ski": `base64_data`
    pattern = re.compile(r'"([0-9a-fA-F]+)":\s*`([^`]+)`')
    certs = pattern.findall(ts_content)
    print(f"  Found {len(certs)} certificates")
    return certs


def base64_to_pem(b64_der: str) -> str:
    """Wrap raw base64 DER data into PEM format with 64-char line wrapping."""
    # Strip any whitespace in the base64
    clean = b64_der.strip().replace("\n", "").replace("\r", "").replace(" ", "")
    # Validate it's actually valid base64
    base64.b64decode(clean)
    # Wrap to 64-char lines
    wrapped = "\n".join(textwrap.wrap(clean, 64))
    return f"-----BEGIN CERTIFICATE-----\n{wrapped}\n-----END CERTIFICATE-----"


def collect_revocation_sources(source_refs: list[str]) -> tuple[list[dict], list[dict]]:
    if not source_refs:
        raise ValueError(
            "At least one revocation source is required. "
            "Pass ICAO PKD dsccrl LDIF or PEM/DER CRL files with --revocation-source."
        )

    sources: list[dict] = []
    entries: list[dict] = []
    for source_ref in source_refs:
        raw = read_source(source_ref)
        source_hash = sha256_hex(raw)
        source_id = source_hash[:16]
        source_format = detect_revocation_source_format(source_ref, raw)
        crls = parse_revocation_crls(raw, source_format)
        if not crls:
            raise ValueError(f"Revocation source {source_ref} did not contain any CRL objects")

        source_entries: list[dict] = []
        issuer_summaries: list[dict] = []
        for crl_index, crl in enumerate(crls):
            crl_entries, issuer_summary = extract_crl_entries(
                crl,
                source_id=source_id,
                crl_index=crl_index,
            )
            source_entries.extend(crl_entries)
            issuer_summaries.append(issuer_summary)

        sources.append({
            "id": source_id,
            "uri": source_ref,
            "format": source_format,
            "sha256": source_hash,
            "crlCount": len(crls),
            "revokedCertificateCount": len(source_entries),
            "issuers": issuer_summaries,
        })
        entries.extend(source_entries)

    return sort_sources(sources), sort_entries(entries)


def build_revocation_snapshot(
    sources: list[dict],
    entries: list[dict],
    csca_metadata: dict | None = None,
    generated_at: str | None = None,
) -> dict:
    if not sources:
        raise ValueError("Cannot build revocation snapshot without revocation sources")

    sorted_sources = sort_sources(sources)
    sorted_entries = sort_entries(entries)
    source_set_hash = sha256_json(sorted_sources)
    generated = generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00",
        "Z",
    )

    snapshot = {
        "schema": "gg.solidarity.passport.revocation.v1",
        "generatedAt": generated,
        "sourceCount": len(sorted_sources),
        "revokedCertificateCount": len(sorted_entries),
        "sourceSetSha256": source_set_hash,
        "sources": sorted_sources,
        "entries": sorted_entries,
    }
    if csca_metadata is not None:
        # The OpenAC v3 witness builder reads cscaMetadata to bind the DSC's
        # issuing CSCA into the in-circuit Merkle leaf; without it the build
        # fails closed with "missing-csca-metadata".
        snapshot["cscaMetadata"] = csca_metadata
    return snapshot


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def read_source(source_ref: str) -> bytes:
    parsed = urlparse(source_ref)
    if parsed.scheme in {"http", "https"}:
        print(f"Fetching revocation source {source_ref} ...")
        req = urllib.request.Request(source_ref)
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    return Path(source_ref).read_bytes()


def detect_revocation_source_format(source_ref: str, raw: bytes) -> str:
    suffix = Path(urlparse(source_ref).path).suffix.lower()
    if suffix in {".ldif", ".ldi"}:
        return "ldif"
    if raw.lstrip().startswith(b"dn:") or b"certificateRevocationList" in raw[:4096]:
        return "ldif"
    return "crl"


def parse_revocation_crls(raw: bytes, source_format: str) -> list[x509.CertificateRevocationList]:
    if source_format == "ldif":
        return [
            parse_crl_der(der)
            for der in extract_ldif_binary_values(raw, LDIF_CRL_ATTRIBUTES)
        ]
    return [parse_crl_bytes(raw)]


def parse_crl_bytes(raw: bytes) -> x509.CertificateRevocationList:
    stripped = raw.lstrip()
    if stripped.startswith(b"-----BEGIN"):
        return x509.load_pem_x509_crl(raw)
    return parse_crl_der(raw)


def parse_crl_der(raw: bytes) -> x509.CertificateRevocationList:
    return x509.load_der_x509_crl(raw)


def extract_ldif_binary_values(raw: bytes, attributes: tuple[str, ...]) -> list[bytes]:
    text = raw.decode("utf-8", errors="replace")
    lines = text.splitlines()
    unfolded: list[str] = []
    for line in lines:
        if line.startswith(" ") and unfolded:
            unfolded[-1] += line[1:]
        else:
            unfolded.append(line)

    wanted = {attr.lower() for attr in attributes}
    out: list[bytes] = []
    for line in unfolded:
        if "::" not in line:
            continue
        attr, encoded = line.split("::", 1)
        if attr.strip().lower() not in wanted:
            continue
        clean = "".join(encoded.strip().split())
        if clean:
            out.append(base64.b64decode(clean, validate=True))
    return out


def extract_crl_entries(
    crl: x509.CertificateRevocationList,
    source_id: str,
    crl_index: int,
) -> tuple[list[dict], dict]:
    issuer_name = crl.issuer.rfc4514_string()
    issuer_name_hash = sha256_hex(issuer_name.encode("utf-8"))
    # SHA-256 over the issuer Name's canonical DER bytes. This is the key the
    # OpenAC v3 Rust witness builder matches against the DSC's issuer Name DER
    # digest (sod.rs ParsedDsc.issuer_name_der_sha256) so the revocation SMT is
    # built from exactly the CRL of the DSC's own issuer, even when the issuer
    # string forms differ across encoders.
    issuer_name_der_hash = sha256_hex(crl.issuer.public_bytes())
    authority_key_id = crl_authority_key_id(crl)
    this_update = crl_datetime_iso(crl, "last_update_utc", "last_update")
    next_update = crl_datetime_iso(crl, "next_update_utc", "next_update")

    entries: list[dict] = []
    for revoked in crl:
        serial_hex = serial_to_hex(revoked.serial_number)
        entry = {
            "issuerName": issuer_name,
            "issuerNameSha256": issuer_name_hash,
            "issuerNameDerSha256Hex": issuer_name_der_hash,
            "authorityKeyIdentifierHex": authority_key_id,
            "serialHex": serial_hex,
            "serial20Hex": serial_to_20_hex(revoked.serial_number),
            "revokedAt": revoked_datetime_iso(revoked),
            "sourceId": source_id,
            "crlIndex": crl_index,
        }
        entries.append(entry)

    issuer_summary = {
        "issuerName": issuer_name,
        "issuerNameSha256": issuer_name_hash,
        "issuerNameDerSha256Hex": issuer_name_der_hash,
        "authorityKeyIdentifierHex": authority_key_id,
        "thisUpdate": this_update,
        "nextUpdate": next_update,
        "revokedCertificateCount": len(entries),
    }
    return entries, issuer_summary


CSCA_METADATA_SCHEMA = "gg.solidarity.passport.csca-metadata.v1"
# dsc_chain circuit CSCA_MERKLE_DEPTH = 8 → 256-leaf tree. The OpenAC v3
# witness builder constructs a single-leaf attestation tree per proof, so the
# index only selects the Merkle path shape (it is not a position in a global
# 256-entry tree). Assigning index = order % 256 keeps it deterministic.
CSCA_MERKLE_LEAVES = 256


def build_csca_metadata(certs: list[tuple[str, "x509.Certificate"]]) -> dict:
    """Per-CSCA identity the OpenAC v3 witness builder matches a DSC against.

    Each entry carries the canonical-DER digests the builder uses to bind the
    in-circuit CSCA Merkle leaf to the real Master List cert:
      * subjectKeyIdentifierHex   ← DSC AuthorityKeyIdentifier match
      * subjectNameDerSha256Hex   ← DSC issuer Name DER digest match
      * tbsSha256Hex              ← bound into compute_csca_leaf_v2 provenance
      * index                     ← depth-8 Merkle path selector
    """
    cscas: list[dict] = []
    seen_ski: set[str] = set()
    for order, (dict_ski, cert) in enumerate(certs):
        ski = csca_subject_key_id(cert) or dict_ski.upper()
        # De-dup by SKI so repeated Master List entries collapse to one leaf.
        if ski in seen_ski:
            continue
        seen_ski.add(ski)
        cscas.append({
            "index": len(cscas) % CSCA_MERKLE_LEAVES,
            "tbsSha256Hex": sha256_hex(cert.tbs_certificate_bytes),
            "subjectKeyIdentifierHex": ski,
            "subjectNameDerSha256Hex": sha256_hex(cert.subject.public_bytes()),
        })
    return {
        "schema": CSCA_METADATA_SCHEMA,
        "cscaCount": len(cscas),
        "merkleDepth": 8,
        "cscas": cscas,
    }


def csca_subject_key_id(cert: x509.Certificate) -> str | None:
    # Some Master List CSCAs carry malformed extensions (e.g. a non-DER
    # BasicConstraints) that raise on `.extensions` access; the dict SKI from
    # skiPem.ts is the reliable fallback in that case.
    try:
        ext = cert.extensions.get_extension_for_class(x509.SubjectKeyIdentifier)
    except (x509.ExtensionNotFound, ValueError):
        return None
    return ext.value.digest.hex().upper()


def crl_authority_key_id(crl: x509.CertificateRevocationList) -> str | None:
    try:
        ext = crl.extensions.get_extension_for_class(x509.AuthorityKeyIdentifier)
    except x509.ExtensionNotFound:
        return None
    key_id = ext.value.key_identifier
    return key_id.hex().upper() if key_id else None


def crl_datetime_iso(crl: x509.CertificateRevocationList, utc_attr: str, legacy_attr: str) -> str | None:
    value = getattr(crl, utc_attr, None) or getattr(crl, legacy_attr, None)
    return datetime_iso(value)


def revoked_datetime_iso(revoked: x509.RevokedCertificate) -> str | None:
    value = getattr(revoked, "revocation_date_utc", None) or getattr(revoked, "revocation_date", None)
    return datetime_iso(value)


def datetime_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def serial_to_hex(serial: int) -> str:
    if serial < 0:
        raise ValueError("Certificate serial must be non-negative")
    hex_value = f"{serial:X}"
    if len(hex_value) % 2:
        hex_value = "0" + hex_value
    return hex_value


def serial_to_20_hex(serial: int) -> str:
    raw = serial.to_bytes(max(1, (serial.bit_length() + 7) // 8), "big")
    if len(raw) > 20:
        raise ValueError(f"Certificate serial exceeds 20 bytes: {serial_to_hex(serial)}")
    return (b"\x00" * (20 - len(raw)) + raw).hex().upper()


def sort_sources(sources: list[dict]) -> list[dict]:
    return sorted(sources, key=lambda s: (s["id"], s["uri"]))


def sort_entries(entries: list[dict]) -> list[dict]:
    return sorted(entries, key=lambda e: (e["issuerNameSha256"], e["serial20Hex"], e["sourceId"], e["crlIndex"]))


def sha256_hex(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_json(payload: object) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256_hex(encoded)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate passport CSCA masterList.pem plus a required DSC/CRL "
            "revocation snapshot from ICAO PKD LDIF or PEM/DER CRL sources."
        )
    )
    parser.add_argument(
        "--revocation-source",
        action="append",
        default=[],
        help=(
            "Path or HTTPS URL for an ICAO PKD dsccrl LDIF file or PEM/DER CRL. "
            "Pass multiple times for multiple sources."
        ),
    )
    parser.add_argument(
        "--masterlist-out",
        type=Path,
        default=OUTPUT_PATH,
        help=f"Output path for concatenated CSCA PEM bundle (default: {OUTPUT_PATH})",
    )
    parser.add_argument(
        "--revocation-snapshot-out",
        type=Path,
        default=REVOCATION_SNAPSHOT_PATH,
        help=f"Output path for revocation snapshot JSON (default: {REVOCATION_SNAPSHOT_PATH})",
    )
    parser.add_argument(
        "--android-revocation-snapshot-out",
        type=Path,
        default=ANDROID_REVOCATION_SNAPSHOT_PATH,
        help=(
            "Optional Android asset mirror for the revocation snapshot "
            f"(default: {ANDROID_REVOCATION_SNAPSHOT_PATH})"
        ),
    )
    return parser.parse_args()


def main():
    args = parse_args()
    if not args.revocation_source:
        raise SystemExit(
            "Refusing to generate passport trust resources without a revocation source.\n"
            "Pass --revocation-source /path/to/icaopkd-001-dsccrl-*.ldif or a PEM/DER CRL.\n"
            "Official ICAO PKD dsccrl LDIF files are the preferred source."
        )

    ts_content = fetch_ski_pem_ts()
    certs = extract_certificates(ts_content)

    if not certs:
        raise SystemExit("No certificates found in skiPem.ts")

    pem_blocks = []
    parsed_cscas: list[tuple[str, x509.Certificate]] = []
    skipped = 0
    for ski, b64 in certs:
        try:
            pem = base64_to_pem(b64)
            pem_blocks.append(pem)
        except Exception as e:
            print(f"  Skipping {ski}: {e}")
            skipped += 1
            continue
        try:
            parsed_cscas.append((ski, x509.load_pem_x509_certificate(pem.encode("utf-8"))))
        except Exception as e:
            # PEM is well-formed enough for NFCPassportReader passive auth but
            # not parseable here — it just won't appear in cscaMetadata.
            print(f"  CSCA metadata skip {ski}: {e}")

    args.masterlist_out.parent.mkdir(parents=True, exist_ok=True)
    args.masterlist_out.write_text("\n".join(pem_blocks) + "\n", encoding="utf-8")

    print(f"\nWrote {len(pem_blocks)} certificates to {args.masterlist_out}")
    if skipped:
        print(f"  Skipped {skipped} invalid entries")
    print(f"  File size: {args.masterlist_out.stat().st_size:,} bytes")

    csca_metadata = build_csca_metadata(parsed_cscas)

    sources, entries = collect_revocation_sources(args.revocation_source)
    snapshot = build_revocation_snapshot(sources, entries, csca_metadata=csca_metadata)
    write_json(args.revocation_snapshot_out, snapshot)
    if args.android_revocation_snapshot_out:
        write_json(args.android_revocation_snapshot_out, snapshot)

    print(f"\nWrote revocation snapshot to {args.revocation_snapshot_out}")
    if args.android_revocation_snapshot_out:
        print(f"  Mirrored Android asset to {args.android_revocation_snapshot_out}")
    print(f"  Sources: {snapshot['sourceCount']}")
    print(f"  Revoked DSC serials: {snapshot['revokedCertificateCount']}")
    print(f"  CSCA metadata entries: {csca_metadata['cscaCount']}")
    print(f"  Source set SHA-256: {snapshot['sourceSetSha256']}")


if __name__ == "__main__":
    main()
