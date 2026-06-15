/**
 * shortDid / shortCommitment — port of `shortDid(_:)` from
 * solidarity/Views/IDViews/IDViewHelpers.swift. Returns "prefix…suffix"
 * when the input is longer than 20 characters, otherwise returns it as-is.
 *
 * Two flavours so the call sites don't have to guess truncation lengths.
 */

export function shortDid(did: string): string {
  if (did.length <= 20) return did;
  return `${did.slice(0, 12)}...${did.slice(-6)}`;
}

export function shortCommitment(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}
