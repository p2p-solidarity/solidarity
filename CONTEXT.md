# Solidarity Identity and Backup

This context distinguishes the identities and secrets that make a Solidarity profile usable and recoverable. The terms are intentionally narrow so that “key” never ambiguously refers to several unrelated secrets.

## Language

**Recovery Phrase**:
The human-writable phrase that deterministically identifies a Root Identity and enables recovery on another device.
_Avoid_: Private key, backup password, seed key

**Root Identity**:
The portable identity determined by a Recovery Phrase and shared by the app and web experiences. It is distinct from the app's currently active Signing Identity.
_Avoid_: Master key, device identity, signing key

**Signing Identity**:
The identity currently used by the app to sign credentials, presentations, and existing product flows. It may be portable on some platforms, but it is not the Root Identity.
_Avoid_: Root key, recovery key, encryption key

**Device Storage Key**:
A device-local secret that protects persisted data on that device. It is not an identity and is not a cross-device recovery mechanism.
_Avoid_: Root key, cloud backup key, identity key

**Portable Backup Key**:
A recoverable secret determined by the Recovery Phrase and used exclusively to protect Backup Archives across devices.
_Avoid_: Device Storage Key, master key, synced AES key

**Backup Archive**:
An encrypted snapshot of user data intended for later restore. Its presence in cloud storage does not by itself prove that another device can decrypt it.
_Avoid_: Key backup, identity backup
