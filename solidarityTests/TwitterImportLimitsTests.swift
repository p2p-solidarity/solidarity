//
//  TwitterImportLimitsTests.swift
//  solidarityTests
//
//  Verifies the byte/record caps applied to Twitter archive imports.
//

import Foundation
import Testing
@testable import solidarity

struct TwitterImportLimitsTests {

    @Test func rejectsOversizedJsFile() async throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("twitter_import_caps_\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let oversize = TwitterImportLimits.maxFileSizeBytes + 1
        let url = tempDir.appendingPathComponent("tweets.js")
        let prefix = "window.YTD.tweets.part0 = ".data(using: .utf8)!
        var payload = Data()
        payload.append(prefix)
        payload.append(Data(repeating: UInt8(ascii: "x"), count: Int(oversize) - prefix.count))
        try payload.write(to: url)

        do {
            _ = try await TwitterArchiveImporter.shared.importTweets(from: url, progress: nil)
            Issue.record("expected fileTooLarge error, got success")
        } catch let error as TwitterImportError {
            switch error {
            case .fileTooLarge(let name, let sizeBytes, let limitBytes):
                #expect(name == "tweets.js")
                #expect(sizeBytes >= TwitterImportLimits.maxFileSizeBytes)
                #expect(limitBytes == TwitterImportLimits.maxFileSizeBytes)
            default:
                Issue.record("unexpected importer error: \(error)")
            }
        }
    }

    @Test func cappedFieldTruncatesAtUtf8Boundary() throws {
        // 5 KB of "a" (each one byte) should be capped to 4 KB.
        let raw = String(repeating: "a", count: 5 * 1024)
        let capped = TwitterArchiveImporter.shared.cappedField(
            raw,
            maxBytes: TwitterImportLimits.maxShortFieldBytes
        )
        #expect(capped.utf8.count <= TwitterImportLimits.maxShortFieldBytes)
        #expect(capped.utf8.count == TwitterImportLimits.maxShortFieldBytes)
    }

    @Test func cappedFieldHandlesMultiByteCleanly() throws {
        // Build a string of 3-byte UTF-8 chars and ask for a budget that lands
        // mid-codepoint; output must still be valid UTF-8 (i.e. no partial
        // sequences) and never exceed the budget.
        let chunk = "漢" // 3 bytes in UTF-8
        let raw = String(repeating: chunk, count: 4096)
        let budget = 10 // intentionally not a multiple of 3
        let capped = TwitterArchiveImporter.shared.cappedField(raw, maxBytes: budget)
        #expect(capped.utf8.count <= budget)
        // Round-trip via Data to confirm it's valid UTF-8.
        let data = capped.data(using: .utf8)
        #expect(data != nil)
    }
}
