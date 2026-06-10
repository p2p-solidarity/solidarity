#!/usr/bin/env python3
import base64
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_masterlist


def build_test_crl(serials: list[int]) -> x509.CertificateRevocationList:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "GB"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Test CSCA"),
        x509.NameAttribute(NameOID.COMMON_NAME, "Country Signing Authority"),
    ])
    now = datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc)
    builder = (
        x509.CertificateRevocationListBuilder()
        .issuer_name(issuer)
        .last_update(now)
        .next_update(now + timedelta(days=7))
        .add_extension(
            x509.AuthorityKeyIdentifier(
                key_identifier=bytes.fromhex("499e4730278520c57cfc118024e14c1562a249d6"),
                authority_cert_issuer=None,
                authority_cert_serial_number=None,
            ),
            critical=False,
        )
    )
    for serial in serials:
        revoked = (
            x509.RevokedCertificateBuilder()
            .serial_number(serial)
            .revocation_date(now - timedelta(days=1))
            .build()
        )
        builder = builder.add_revoked_certificate(revoked)
    return builder.sign(private_key=key, algorithm=hashes.SHA256())


class RevocationSourceTests(unittest.TestCase):
    def test_requires_at_least_one_revocation_source(self) -> None:
        with self.assertRaisesRegex(ValueError, "revocation source"):
            generate_masterlist.collect_revocation_sources([])

    def test_parses_pem_crl_and_builds_deterministic_snapshot(self) -> None:
        crl = build_test_crl([0x492F0116])
        with tempfile.TemporaryDirectory() as tmp:
            crl_path = Path(tmp) / "GBR.crl"
            crl_path.write_bytes(crl.public_bytes(serialization.Encoding.PEM))

            sources, entries = generate_masterlist.collect_revocation_sources([str(crl_path)])
            snapshot = generate_masterlist.build_revocation_snapshot(
                sources,
                entries,
                generated_at="2026-06-10T12:00:00Z",
            )

        self.assertEqual(snapshot["schema"], "gg.solidarity.passport.revocation.v1")
        self.assertEqual(snapshot["sourceCount"], 1)
        self.assertEqual(snapshot["revokedCertificateCount"], 1)
        self.assertEqual(snapshot["entries"][0]["serialHex"], "492F0116")
        self.assertEqual(
            snapshot["entries"][0]["serial20Hex"],
            "00000000000000000000000000000000492F0116",
        )
        self.assertRegex(snapshot["sourceSetSha256"], r"^[0-9a-f]{64}$")

    def test_parses_pkd_ldif_crl_entries(self) -> None:
        crl = build_test_crl([0x01, 0xABCDEF])
        der = crl.public_bytes(serialization.Encoding.DER)
        b64 = base64.b64encode(der).decode("ascii")
        folded = b64[:76] + "\n " + b64[76:]

        with tempfile.TemporaryDirectory() as tmp:
            ldif_path = Path(tmp) / "icaopkd-001-dsccrl-test.ldif"
            ldif_path.write_text(
                "dn: cn=test\n"
                f"certificateRevocationList;binary:: {folded}\n",
                encoding="utf-8",
            )

            sources, entries = generate_masterlist.collect_revocation_sources([str(ldif_path)])

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0]["format"], "ldif")
        self.assertEqual([entry["serialHex"] for entry in entries], ["01", "ABCDEF"])

    def test_revocation_entry_carries_issuer_name_der_digest(self) -> None:
        # The OpenAC v3 witness builder matches a DSC's issuer Name DER digest
        # against this field, so it must be a 64-hex SHA-256.
        crl = build_test_crl([0x492F0116])
        with tempfile.TemporaryDirectory() as tmp:
            crl_path = Path(tmp) / "GBR.crl"
            crl_path.write_bytes(crl.public_bytes(serialization.Encoding.PEM))
            _, entries = generate_masterlist.collect_revocation_sources([str(crl_path)])
        self.assertRegex(entries[0]["issuerNameDerSha256Hex"], r"^[0-9a-f]{64}$")


class CscaMetadataTests(unittest.TestCase):
    def _build_csca(self, common_name: str, ski: bytes) -> x509.Certificate:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "GB"),
            x509.NameAttribute(NameOID.COMMON_NAME, common_name),
        ])
        now = datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc)
        return (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(key.public_key())
            .serial_number(1)
            .not_valid_before(now)
            .not_valid_after(now + timedelta(days=3650))
            .add_extension(x509.SubjectKeyIdentifier(ski), critical=False)
            .sign(key, hashes.SHA256())
        )

    def test_metadata_binds_index_ski_tbs_and_subject_name(self) -> None:
        a = self._build_csca("CSCA A", b"\xa1" * 20)
        b = self._build_csca("CSCA B", b"\xb2" * 20)
        meta = generate_masterlist.build_csca_metadata([("a1" * 20, a), ("b2" * 20, b)])

        self.assertEqual(meta["schema"], "gg.solidarity.passport.csca-metadata.v1")
        self.assertEqual(meta["cscaCount"], 2)
        self.assertEqual(meta["merkleDepth"], 8)
        first = meta["cscas"][0]
        self.assertEqual(first["index"], 0)
        self.assertTrue(0 <= meta["cscas"][1]["index"] < 256)
        self.assertEqual(first["subjectKeyIdentifierHex"], "A1" * 20)
        self.assertRegex(first["tbsSha256Hex"], r"^[0-9a-f]{64}$")
        self.assertRegex(first["subjectNameDerSha256Hex"], r"^[0-9a-f]{64}$")

    def test_metadata_dedupes_repeated_ski(self) -> None:
        a = self._build_csca("CSCA A", b"\xa1" * 20)
        dup = self._build_csca("CSCA A again", b"\xa1" * 20)
        meta = generate_masterlist.build_csca_metadata([("a1" * 20, a), ("a1" * 20, dup)])
        self.assertEqual(meta["cscaCount"], 1)


if __name__ == "__main__":
    unittest.main()
