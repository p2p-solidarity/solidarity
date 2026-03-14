#!/usr/bin/env python3
"""
Fetches CSCA certificates from Self (OpenPassport) skiPem.ts
and converts them to a concatenated PEM file for NFCPassportReader.

Source: https://github.com/selfxyz/self (MIT license)
Output: airmeishi/Resources/masterList.pem

Usage:
    python3 scripts/generate_masterlist.py
"""

import base64
import re
import textwrap
import urllib.request
from pathlib import Path

SKI_PEM_URL = (
    "https://raw.githubusercontent.com/selfxyz/self/main/"
    "common/src/constants/skiPem.ts"
)

OUTPUT_PATH = Path(__file__).parent.parent / "airmeishi" / "Resources" / "masterList.pem"


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


def main():
    ts_content = fetch_ski_pem_ts()
    certs = extract_certificates(ts_content)

    if not certs:
        raise SystemExit("No certificates found in skiPem.ts")

    pem_blocks = []
    skipped = 0
    for ski, b64 in certs:
        try:
            pem = base64_to_pem(b64)
            pem_blocks.append(pem)
        except Exception as e:
            print(f"  Skipping {ski}: {e}")
            skipped += 1

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text("\n".join(pem_blocks) + "\n", encoding="utf-8")

    print(f"\nWrote {len(pem_blocks)} certificates to {OUTPUT_PATH}")
    if skipped:
        print(f"  Skipped {skipped} invalid entries")
    print(f"  File size: {OUTPUT_PATH.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
