//
//  StreamParser.swift
//  airmeishi
//
//  Stream-based JSON parser for large files (Google Takeout, Twitter Archive)
//

import Foundation

final class StreamParser {
    static let shared = StreamParser()

    private let bufferSize = 1024 * 1024  // 1MB buffer

    private init() {}

    // MARK: - Public API

    /// Stream-parse NDJSON (Newline-Delimited JSON)
    func streamParseNDJSON<T: Decodable>(
        from url: URL,
        elementType: T.Type,
        progress: ((Double) -> Void)? = nil
    ) -> AsyncThrowingStream<T, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    let fileSize = try fileSize(of: url)
                    var processedBytes: Int64 = 0

                    guard let inputStream = InputStream(url: url) else {
                        continuation.finish(throwing: StreamParserError.cannotOpenFile)
                        return
                    }

                    inputStream.open()
                    defer { inputStream.close() }

                    var lineBuffer = ""
                    var buffer = [UInt8](repeating: 0, count: bufferSize)

                    while inputStream.hasBytesAvailable {
                        let bytesRead = inputStream.read(&buffer, maxLength: bufferSize)

                        guard bytesRead > 0 else { break }

                        processedBytes += Int64(bytesRead)

                        let chunk = Data(buffer.prefix(bytesRead))
                        if let chunkString = String(data: chunk, encoding: .utf8) {
                            lineBuffer += chunkString

                            while let newlineIndex = lineBuffer.firstIndex(of: "\n") {
                                let line = String(lineBuffer[..<newlineIndex])
                                lineBuffer = String(lineBuffer[lineBuffer.index(after: newlineIndex)...])

                                if !line.isEmpty, line != "\r" {
                                    if let lineData = line.data(using: .utf8) {
                                        do {
                                            let element = try JSONDecoder().decode(T.self, from: lineData)
                                            continuation.yield(element)
                                        } catch {
                                            // Log but continue
                                            print("Failed to parse line: \(error)")
                                        }
                                    }
                                }
                            }
                        }

                        progress?(Double(processedBytes) / Double(fileSize))
                    }

                    // Process remaining buffer
                    if !lineBuffer.isEmpty {
                        if let lineData = lineBuffer.trimmingCharacters(in: .newlines).data(using: .utf8),
                           !lineBuffer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            do {
                                let element = try JSONDecoder().decode(T.self, from: lineData)
                                continuation.yield(element)
                            } catch {
                                print("Failed to parse final line: \(error)")
                            }
                        }
                    }

                    continuation.finish()

                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    /// Parse JSON array with progress tracking
    func parseJSONArray<T: Decodable>(
        from url: URL,
        elementType: T.Type,
        progress: ((Double) -> Void)? = nil
    ) async throws -> [T] {
        let fileSize = try fileSize(of: url)
        var processedBytes: Int64 = 0

        guard let inputStream = InputStream(url: url) else {
            throw StreamParserError.cannotOpenFile
        }

        inputStream.open()
        defer { inputStream.close() }

        var buffer = [UInt8](repeating: 0, count: bufferSize)
        var result: [T] = []
        var depth = 0
        var inString = false
        var escapeNext = false
        var arrayStartFound = false
        var currentElement = ""
        var elementDepth = 0

        while inputStream.hasBytesAvailable {
            let bytesRead = inputStream.read(&buffer, maxLength: bufferSize)

            guard bytesRead > 0 else { break }

            processedBytes += Int64(bytesRead)

            for i in 0..<bytesRead {
                let char = UnicodeScalar(buffer[i])

                if escapeNext {
                    escapeNext = false
                    currentElement.append(Character(char))
                    continue
                }

                if char == "\\" && inString {
                    escapeNext = true
                    currentElement.append(Character(char))
                    continue
                }

                if char == "\"" {
                    inString.toggle()
                    currentElement.append(Character(char))
                    continue
                }

                if !inString {
                    if char == "[" || char == "{" {
                        depth += 1
                        if !arrayStartFound && char == "[" {
                            arrayStartFound = true
                        } else if arrayStartFound {
                            if elementDepth == 0 {
                                elementDepth = depth
                            }
                            currentElement.append(Character(char))
                        }
                        continue
                    }

                    if char == "]" || char == "}" {
                        depth -= 1
                        if arrayStartFound && depth == elementDepth - 1 {
                            currentElement.append(Character(char))

                            if let data = currentElement.data(using: .utf8),
                               let element = try? JSONDecoder().decode(T.self, from: data) {
                                result.append(element)
                            }

                            currentElement = ""
                            elementDepth = 0
                        }
                        continue
                    }

                    if char == "," && depth == elementDepth {
                        continue
                    }

                    if arrayStartFound && depth >= elementDepth && elementDepth > 0 {
                        currentElement.append(Character(char))
                    }
                } else {
                    currentElement.append(Character(char))
                }
            }

            progress?(Double(processedBytes) / Double(fileSize))
        }

        return result
    }

    /// Estimate number of items in a file (for progress)
    func estimateItemCount(in url: URL) async throws -> Int {
        let data = try Data(contentsOf: url)
        guard let content = String(data: data, encoding: .utf8) else {
            throw StreamParserError.cannotParse
        }

        let newlines = content.filter { $0 == "\n" }.count
        return max(newlines, 1)
    }

    // MARK: - Private Methods

    private func fileSize(of url: URL) throws -> Int64 {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        return attributes[.size] as? Int64 ?? 0
    }
}

// MARK: - Errors

enum StreamParserError: LocalizedError {
    case cannotOpenFile
    case cannotParse
    case invalidFormat
    case outOfMemory

    var errorDescription: String? {
        switch self {
        case .cannotOpenFile: return "Cannot open file for reading"
        case .cannotParse: return "Cannot parse file content"
        case .invalidFormat: return "Invalid file format"
        case .outOfMemory: return "Not enough memory to process file"
        }
    }
}

// MARK: - Twitter Tweet Model

struct ParsedTwitterTweet: Identifiable, Codable {
    let id: String
    let text: String
    let createdAt: Date
    let mediaUrls: [URL]
    let replyCount: Int
    let retweetCount: Int
    let likeCount: Int
    let url: URL?
    let hashtags: [String]
    let mentions: [String]
    let inReplyToStatusId: String?

    enum CodingKeys: String, CodingKey {
        case id
        case text = "tweet"
        case createdAt = "timestamp_ms"
        case mediaUrls = "media"
        case replyCount = "reply_count"
        case retweetCount = "retweet_count"
        case likeCount = "like_count"
        case url = "url"
        case hashtags = "hashtags"
        case mentions = "user_mentions"
        case inReplyToStatusId = "in_reply_to_status_id"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""

        if let timestampMs = try container.decodeIfPresent(String.self, forKey: .createdAt),
           let ms = Double(timestampMs) {
            createdAt = Date(timeIntervalSince1970: ms / 1000)
        } else {
            createdAt = Date()
        }

        mediaUrls = []
        replyCount = try container.decodeIfPresent(Int.self, forKey: .replyCount) ?? 0
        retweetCount = try container.decodeIfPresent(Int.self, forKey: .retweetCount) ?? 0
        likeCount = try container.decodeIfPresent(Int.self, forKey: .likeCount) ?? 0

        url = nil
        hashtags = []
        mentions = []
        inReplyToStatusId = nil
    }
}

// MARK: - Google Location Record

struct ParsedGoogleLocation: Identifiable, Codable {
    let id: UUID
    let latitude: Double
    let longitude: Double
    let accuracy: Int?
    let timestamp: Date
    let velocity: Double?
    let heading: Double?
    let altitude: Double?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = UUID()

        let latE7 = try container.decode(Int.self, forKey: .latitude)
        let lngE7 = try container.decode(Int.self, forKey: .longitude)
        latitude = Double(latE7) / 1e7
        longitude = Double(lngE7) / 1e7

        accuracy = try container.decodeIfPresent(Int.self, forKey: .accuracy)

        if let timestampMs = try container.decodeIfPresent(Int64.self, forKey: .timestamp) {
            timestamp = Date(timeIntervalSince1970: Double(timestampMs) / 1000)
        } else {
            timestamp = Date()
        }

        velocity = try container.decodeIfPresent(Double.self, forKey: .velocity)
        heading = try container.decodeIfPresent(Double.self, forKey: .heading)
        altitude = try container.decodeIfPresent(Double.self, forKey: .altitude)
    }

    enum CodingKeys: String, CodingKey {
        case latitude = "latitudeE7"
        case longitude = "longitudeE7"
        case accuracy
        case timestamp = "timestampMs"
        case velocity
        case heading
        case altitude
    }
}
