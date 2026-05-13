//
//  ZKLogger.swift
//  solidarity
//
//  Lightweight unified logging for Semaphore-related flows.
//

import Foundation
import os

enum ZKLog {
  private static let logger = Logger(subsystem: AppBranding.currentLoggerSubsystem, category: "Semaphore")

  /// Caller-supplied messages may contain commitment prefixes, scopes, or
  /// other identifiers that should not leak verbatim from a release build.
  /// We mark the payload as `.private` for the unified logger (so it is
  /// redacted in non-debug log streams) and additionally drop the stdout
  /// `print(...)` mirror unless we are in a DEBUG build.
  static func info(_ message: String) {
    logger.info("\(message, privacy: .private)")
    #if DEBUG
    print("[Semaphore] \(message)")
    #endif
  }

  static func error(_ message: String) {
    logger.error("\(message, privacy: .private)")
    #if DEBUG
    print("[Semaphore][Error] \(message)")
    #endif
  }

  /// Operational status messages with no identifier content. Safe to leave
  /// public so we keep release-build observability for things like
  /// "Semaphore prover unavailable, falling back".
  static func status(_ message: String) {
    logger.info("\(message, privacy: .public)")
    #if DEBUG
    print("[Semaphore] \(message)")
    #endif
  }
}
