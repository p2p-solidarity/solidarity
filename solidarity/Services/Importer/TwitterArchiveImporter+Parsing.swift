//
//  TwitterArchiveImporter+Parsing.swift
//  solidarity
//
//  Twitter archive file reading and data parsing utilities
//

import Foundation

// MARK: - Parsing Methods

extension TwitterArchiveImporter {
    func importAccountInfo(from dataURL: URL) async throws -> TwitterAccount {
        let accountURL = dataURL.appendingPathComponent("account.js")
        let profileURL = dataURL.appendingPathComponent("profile.js")

        guard FileManager.default.fileExists(atPath: accountURL.path) else {
            throw TwitterImportError.missingFile("account.js")
        }

        let accountData = try await readTwitterJS(from: accountURL)

        guard let accountArray = try JSONSerialization.jsonObject(with: accountData) as? [[String: Any]],
              let accountObj = accountArray.first?["account"] as? [String: Any] else {
            throw TwitterImportError.invalidDataFormat
        }

        var account = TwitterAccount(
            id: cappedField(accountObj["accountId"] as? String, maxBytes: TwitterImportLimits.maxShortFieldBytes),
            username: cappedField(accountObj["username"] as? String, maxBytes: TwitterImportLimits.maxShortFieldBytes),
            displayName: cappedField(accountObj["accountDisplayName"] as? String, maxBytes: TwitterImportLimits.maxShortFieldBytes),
            email: cappedField(accountObj["email"] as? String, maxBytes: TwitterImportLimits.maxShortFieldBytes),
            createdAt: parseTwitterDate(accountObj["createdAt"] as? String) ?? Date()
        )

        // Try to load profile info
        if FileManager.default.fileExists(atPath: profileURL.path),
           let profileData = try? await readTwitterJS(from: profileURL),
           let profileArray = try? JSONSerialization.jsonObject(with: profileData) as? [[String: Any]],
           let profileObj = profileArray.first?["profile"] as? [String: Any] {

            if let description = profileObj["description"] as? [String: Any] {
                account.bio = cappedField(description["bio"] as? String, maxBytes: TwitterImportLimits.maxLongFieldBytes)
            }
            if let avatar = profileObj["avatarMediaUrl"] as? String {
                let cappedAvatar = cappedField(avatar, maxBytes: TwitterImportLimits.maxShortFieldBytes)
                account.avatarURL = URL(string: cappedAvatar)
            }
        }

        return account
    }

    func importTweets(
        from url: URL,
        progress: ((Double) -> Void)?
    ) async throws -> [Tweet] {
        let data = try await readTwitterJS(from: url)

        guard let tweetsArray = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw TwitterImportError.invalidDataFormat
        }

        let bounded = tweetsArray.prefix(TwitterImportLimits.maxRecordsPerArray)
        var tweets: [Tweet] = []
        tweets.reserveCapacity(bounded.count)
        let total = bounded.count

        for (index, wrapper) in bounded.enumerated() {
            if let tweetData = wrapper["tweet"] as? [String: Any] {
                if let tweet = parseTweet(from: tweetData) {
                    tweets.append(tweet)
                }
            }

            if index % 100 == 0 {
                progress?(Double(index) / Double(max(total, 1)))
            }
        }

        return tweets.sorted { $0.createdAt > $1.createdAt }
    }

    func importLikes(from url: URL) async throws -> [Like] {
        let data = try await readTwitterJS(from: url)

        guard let likesArray = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw TwitterImportError.invalidDataFormat
        }

        return likesArray.prefix(TwitterImportLimits.maxRecordsPerArray).compactMap { wrapper -> Like? in
            guard let likeData = wrapper["like"] as? [String: Any] else { return nil }
            return Like(
                tweetId: cappedField(likeData["tweetId"] as? String, maxBytes: TwitterImportLimits.maxShortFieldBytes),
                fullText: cappedField(likeData["fullText"] as? String, maxBytes: TwitterImportLimits.maxLongFieldBytes),
                expandedUrl: cappedField(likeData["expandedUrl"] as? String, maxBytes: TwitterImportLimits.maxShortFieldBytes)
            )
        }
    }

    func importConnections(from url: URL) async throws -> [Connection] {
        let data = try await readTwitterJS(from: url)

        guard let connectionsArray = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw TwitterImportError.invalidDataFormat
        }

        return connectionsArray.prefix(TwitterImportLimits.maxRecordsPerArray).compactMap { wrapper -> Connection? in
            // Handle both "follower" and "following" formats
            let connectionData = wrapper["follower"] as? [String: Any] ??
                                 wrapper["following"] as? [String: Any]
            guard let data = connectionData else { return nil }

            return Connection(
                accountId: cappedField(data["accountId"] as? String, maxBytes: TwitterImportLimits.maxShortFieldBytes),
                userLink: cappedField(data["userLink"] as? String, maxBytes: TwitterImportLimits.maxShortFieldBytes)
            )
        }
    }

    func importDirectMessages(from url: URL) async throws -> [DirectMessageConversation] {
        let data = try await readTwitterJS(from: url)

        guard let dmArray = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw TwitterImportError.invalidDataFormat
        }

        return dmArray.prefix(TwitterImportLimits.maxRecordsPerArray).compactMap { wrapper -> DirectMessageConversation? in
            guard let convData = wrapper["dmConversation"] as? [String: Any],
                  let messagesData = convData["messages"] as? [[String: Any]] else {
                return nil
            }

            let messages = messagesData
                .prefix(TwitterImportLimits.maxRecordsPerArray)
                .compactMap { parseDirectMessage(from: $0) }

            return DirectMessageConversation(
                conversationId: cappedField(
                    convData["conversationId"] as? String,
                    maxBytes: TwitterImportLimits.maxShortFieldBytes
                ).isEmpty ? UUID().uuidString : cappedField(
                    convData["conversationId"] as? String,
                    maxBytes: TwitterImportLimits.maxShortFieldBytes
                ),
                messages: messages
            )
        }
    }

    func parseTweet(from data: [String: Any]) -> Tweet? {
        guard let rawId = data["id"] as? String ?? data["id_str"] as? String else {
            return nil
        }
        let id = cappedField(rawId, maxBytes: TwitterImportLimits.maxShortFieldBytes)

        let fullText = cappedField(
            data["full_text"] as? String ?? data["text"] as? String,
            maxBytes: TwitterImportLimits.maxLongFieldBytes
        )
        let createdAt = parseTwitterDate(data["created_at"] as? String) ?? Date()

        // Parse entities (each entity array bounded to keep one tampered tweet
        // from blowing memory).
        var hashtags: [String] = []
        var mentions: [String] = []
        var urls: [String] = []
        var mediaURLs: [URL] = []

        if let entities = data["entities"] as? [String: Any] {
            if let hashtagsData = entities["hashtags"] as? [[String: Any]] {
                hashtags = hashtagsData.prefix(TwitterImportLimits.maxRecordsPerArray).compactMap {
                    let raw = $0["text"] as? String
                    return raw.map { cappedField($0, maxBytes: TwitterImportLimits.maxShortFieldBytes) }
                }
            }
            if let mentionsData = entities["user_mentions"] as? [[String: Any]] {
                mentions = mentionsData.prefix(TwitterImportLimits.maxRecordsPerArray).compactMap {
                    let raw = $0["screen_name"] as? String
                    return raw.map { cappedField($0, maxBytes: TwitterImportLimits.maxShortFieldBytes) }
                }
            }
            if let urlsData = entities["urls"] as? [[String: Any]] {
                urls = urlsData.prefix(TwitterImportLimits.maxRecordsPerArray).compactMap {
                    let raw = $0["expanded_url"] as? String
                    return raw.map { cappedField($0, maxBytes: TwitterImportLimits.maxShortFieldBytes) }
                }
            }
            if let mediaData = entities["media"] as? [[String: Any]] {
                mediaURLs = mediaData.prefix(TwitterImportLimits.maxRecordsPerArray).compactMap {
                    guard let urlString = $0["media_url_https"] as? String else { return nil }
                    return URL(string: cappedField(urlString, maxBytes: TwitterImportLimits.maxShortFieldBytes))
                }
            }
        }

        // Extended entities for media
        if let extendedEntities = data["extended_entities"] as? [String: Any],
           let mediaData = extendedEntities["media"] as? [[String: Any]] {
            let extendedMedia = mediaData.prefix(TwitterImportLimits.maxRecordsPerArray).compactMap { entry -> URL? in
                guard let urlString = entry["media_url_https"] as? String else { return nil }
                return URL(string: cappedField(urlString, maxBytes: TwitterImportLimits.maxShortFieldBytes))
            }
            mediaURLs.append(contentsOf: extendedMedia)
        }

        return Tweet(
            id: id,
            fullText: fullText,
            createdAt: createdAt,
            favoriteCount: data["favorite_count"] as? Int ?? 0,
            retweetCount: data["retweet_count"] as? Int ?? 0,
            inReplyToStatusId: (data["in_reply_to_status_id_str"] as? String).map {
                cappedField($0, maxBytes: TwitterImportLimits.maxShortFieldBytes)
            },
            inReplyToUserId: (data["in_reply_to_user_id_str"] as? String).map {
                cappedField($0, maxBytes: TwitterImportLimits.maxShortFieldBytes)
            },
            hashtags: hashtags,
            mentions: mentions,
            urls: urls,
            mediaURLs: mediaURLs,
            retweetedStatusId: ((data["retweeted_status"] as? [String: Any])?["id_str"] as? String).map {
                cappedField($0, maxBytes: TwitterImportLimits.maxShortFieldBytes)
            },
            source: extractSource(from: data["source"] as? String)
        )
    }

    func parseDirectMessage(from data: [String: Any]) -> DirectMessage? {
        guard let messageData = data["messageCreate"] as? [String: Any],
              let rawId = messageData["id"] as? String else {
            return nil
        }

        return DirectMessage(
            id: cappedField(rawId, maxBytes: TwitterImportLimits.maxShortFieldBytes),
            senderId: cappedField(messageData["senderId"] as? String, maxBytes: TwitterImportLimits.maxShortFieldBytes),
            recipientId: cappedField(
                (messageData["recipient"] as? [String: Any])?["recipientId"] as? String,
                maxBytes: TwitterImportLimits.maxShortFieldBytes
            ),
            text: cappedField(messageData["text"] as? String, maxBytes: TwitterImportLimits.maxLongFieldBytes),
            createdAt: parseTwitterDate(messageData["createdAt"] as? String) ?? Date()
        )
    }

    /// Read Twitter JS file format (window.YTD.xxx.part0 = [...])
    /// Rejects the file if its on-disk size exceeds `TwitterImportLimits.maxFileSizeBytes`
    /// before reading anything into memory, and bumps a per-importer running total
    /// that is also capped by `TwitterImportLimits.maxTotalSizeBytes`.
    func readTwitterJS(from url: URL) async throws -> Data {
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        let fileSize = (attrs[.size] as? NSNumber)?.int64Value ?? 0
        if fileSize > TwitterImportLimits.maxFileSizeBytes {
            throw TwitterImportError.fileTooLarge(
                name: url.lastPathComponent,
                sizeBytes: fileSize,
                limitBytes: TwitterImportLimits.maxFileSizeBytes
            )
        }
        try noteBytesAccepted(fileSize)

        var content = try String(contentsOf: url, encoding: .utf8)

        // Remove the JavaScript variable assignment prefix
        // Format: window.YTD.tweets.part0 = [...]
        if let equalsIndex = content.firstIndex(of: "=") {
            let startIndex = content.index(after: equalsIndex)
            content = String(content[startIndex...]).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        guard let data = content.data(using: .utf8) else {
            throw TwitterImportError.invalidDataFormat
        }

        return data
    }

    /// Truncates a string to the configured field byte budget. Twitter's takeout
    /// usually fits well below these limits; this guards against tampered files.
    func cappedField(_ raw: String?, maxBytes: Int) -> String {
        guard let raw, !raw.isEmpty else { return "" }
        let utf8 = Array(raw.utf8)
        if utf8.count <= maxBytes { return raw }
        // Drop any partial UTF-8 sequence at the boundary so we don't produce
        // invalid Strings.
        var cutoff = maxBytes
        while cutoff > 0, (utf8[cutoff] & 0xC0) == 0x80 { cutoff -= 1 }
        return String(decoding: utf8.prefix(cutoff), as: UTF8.self)
    }

    func parseTwitterDate(_ dateString: String?) -> Date? {
        guard let dateString = dateString else { return nil }

        // Twitter date format: "Wed Oct 10 20:19:24 +0000 2018"
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "E MMM dd HH:mm:ss Z yyyy"

        return formatter.date(from: dateString)
    }

    func extractSource(from htmlSource: String?) -> String {
        guard let source = htmlSource else { return "Unknown" }

        // Extract text from HTML like: <a href="...">Twitter for iPhone</a>
        if let match = source.range(of: ">([^<]+)<", options: .regularExpression),
           source.distance(from: source.startIndex, to: match.lowerBound) > 0 {
            var text = String(source[match])
            text.removeFirst() // Remove >
            text.removeLast()  // Remove <
            return text
        }

        return source
    }
}
