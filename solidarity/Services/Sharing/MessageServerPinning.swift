//
//  MessageServerPinning.swift
//  solidarity
//
//  Single source of truth for the SPKI pin set used by `PinnedSessionDelegate`
//  on the `MessageService` backend. Future commits drop in the real
//  base64(sha256(SubjectPublicKeyInfo)) values without code changes.
//

import Foundation

enum MessageServerPinning {
  /// Returns the set of acceptable SPKI pins (base64 sha256 of SubjectPublicKeyInfo)
  /// for `host`. The current build ships an empty set, which means the
  /// `PinnedSessionDelegate` rejects all backend requests in release builds.
  /// `#if DEBUG` builds fall back to system trust evaluation so development
  /// stays unblocked while we obtain the real pin.
  ///
  /// To enable production traffic: replace the empty array below with the
  /// base64-encoded sha256 of the leaf certificate's SubjectPublicKeyInfo.
  /// Optionally include a backup pin to support certificate rotation.
  static func pinnedSPKIHashes(for host: String) -> Set<String> {
    switch host {
    case MessageService.pinnedHost:
      // TODO(security): populate with real base64(sha256(SPKI)) values for
      //                 the messaging backend before shipping a release build.
      return []
    default:
      return []
    }
  }

  /// True when the build allows the delegate to fall back to system trust
  /// evaluation while no real pin is configured. Production builds must NOT
  /// reach the network when the pin set is empty.
  static var allowsUnpinnedFallback: Bool {
    #if DEBUG
      return true
    #else
      return false
    #endif
  }
}
