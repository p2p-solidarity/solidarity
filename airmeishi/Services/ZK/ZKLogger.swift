//
//  ZKLogger.swift
//  airmeishi
//
//  Lightweight unified logging for Semaphore-related flows.
//

import Foundation
import os

enum ZKLog {
    private static let logger = Logger(subsystem: "com.kidneyweakx.airmeishi", category: "Semaphore")

    static func info(_ message: String) {
        logger.info("\(message, privacy: .public)")
        print("[Semaphore] \(message)")
    }

    static func error(_ message: String) {
        logger.error("\(message, privacy: .public)")
        print("[Semaphore][Error] \(message)")
    }
}
