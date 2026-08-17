---
status: accepted
---

# Derive the Portable Backup Key from the Recovery Phrase

Backup Archives use a purpose-separated Portable Backup Key derived from the Recovery Phrase, while the Device Storage Key remains device-local. We rejected synchronizing another random AES key because phrase derivation supports both iCloud recovery and Android/manual recovery without creating a fourth key-sync race. Changing the Recovery Phrase changes the Portable Backup Key, so a verified new Backup Archive is required before the old recovery route is retired.
