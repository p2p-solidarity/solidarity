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
            id: accountObj["accountId"] as? String ?? "",
            username: accountObj["username"] as? String ?? "",
            displayName: accountObj["accountDisplayName"] as? String ?? "",
            email: accountObj["email"] as? String ?? "",
            createdAt: parseTwitterDate(accountObj["createdAt"] as? String) ?? Date()
        )

        // Try to load profile info
        if FileManager.default.fileExists(atPath: profileURL.path),
           let profileData = try? await readTwitterJS(from: profileURL),
           let profileArray = try? JSONSerialization.jsonObject(with: profileData) as? [[String: Any]],
           let profileObj = profileArray.first?["profile"] as? [String: Any] {

            if let description = profileObj["description"] as? [String: Any] {
                account.bio = description["bio"] as? String
            }
            if let avatar = profileObj["avatarMediaUrl"] as? String {
                account.avatarURL = URL(string: avatar)
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

        var tweets: [Tweet] = []
        let total = tweetsArray.count

        for (index, wrapper) in tweetsArray.enumerated() {
            if let tweetData = wrapper["tweet"] as? [String: Any] {
                if let tweet = parseTweet(from: tweetData) {
                    tweets.append(tweet)
                }
            }

            if index % 100 == 0 {
                progress?(Double(index) / Double(total))
            }
        }

        return tweets.sorted { $0.createdAt > $1.createdAt }
    }

    func importLikes(from url: URL) async throws -> [Like] {
        let data = try await readTwitterJS(from: url)

        guard let likesArray = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw TwitterImportError.invalidDataFormat
        }

        return likesArray.compactMap { wrapper -> Like? in
            guard let likeData = wrapper["like"] as? [String: Any] else { return nil }
            return Like(
                tweetId: likeData["tweetId"] as? String ?? "",
                fullText: likeData["fullText"] as? String,
                expandedUrl: likeData["expandedUrl"] as? String
            )
        }
    }

    func importConnections(from url: URL) async throws -> [Connection] {
        let data = try await readTwitterJS(from: url)

        guard let connectionsArray = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw TwitterImportError.invalidDataFormat
        }

        return connectionsArray.compactMap { wrapper -> Connection? in
            // Handle both "follower" and "following" formats
            let connectionData = wrapper["follower"] as? [String: Any] ??
                                 wrapper["following"] as? [String: Any]
            guard let data = connectionData else { return nil }

            return Connection(
                accountId: data["accountId"] as? String ?? "",
                userLink: data["userLink"] as? String
            )
        }
    }

    func importDirectMessages(from url: URL) async throws -> [DirectMessageConversation] {
        let data = try await readTwitterJS(from: url)

        guard let dmArray = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw TwitterImportError.invalidDataFormat
        }

        return dmArray.compactMap { wrapper -> DirectMessageConversation? in
            guard let convData = wrapper["dmConversation"] as? [String: Any],
                  let messagesData = convData["messages"] as? [[String: Any]] else {
                return nil
            }

            let messages = messagesData.compactMap { parseDirectMessage(from: $0) }

            return DirectMessageConversation(
                conversationId: convData["conversationId"] as? String ?? UUID().uuidString,
                messages: messages
            )
        }
    }

    func parseTweet(from data: [String: Any]) -> Tweet? {
        guard let id = data["id"] as? String ?? data["id_str"] as? String else {
            return nil
        }

        let fullText = data["full_text"] as? String ?? data["text"] as? String ?? ""
        let createdAt = parseTwitterDate(data["created_at"] as? String) ?? Date()

        // Parse entities
        var hashtags: [String] = []
        var mentions: [String] = []
        var urls: [String] = []
        var mediaURLs: [URL] = []

        if let entities = data["entities"] as? [String: Any] {
            if let hashtagsData = entities["hashtags"] as? [[String: Any]] {
                hashtags = hashtagsData.compactMap { $0["text"] as? String }
            }
            if let mentionsData = entities["user_mentions"] as? [[String: Any]] {
                mentions = mentionsData.compactMap { $0["screen_name"] as? String }
            }
            if let urlsData = entities["urls"] as? [[String: Any]] {
                urls = urlsData.compactMap { $0["expanded_url"] as? String }
            }
            if let mediaData = entities["media"] as? [[String: Any]] {
                mediaURLs = mediaData.compactMap {
                    guard let urlString = $0["media_url_https"] as? String else { return nil }
                    return URL(string: urlString)
                }
            }
        }

        // Extended entities for media
        if let extendedEntities = data["extended_entities"] as? [String: Any],
           let mediaData = extendedEntities["media"] as? [[String: Any]] {
            let extendedMedia = mediaData.compactMap { entry -> URL? in
                guard let urlString = entry["media_url_https"] as? String else { return nil }
                return URL(string: urlString)
            }
            mediaURLs.append(contentsOf: extendedMedia)
        }

        return Tweet(
            id: id,
            fullText: fullText,
            createdAt: createdAt,
            favoriteCount: data["favorite_count"] as? Int ?? 0,
            retweetCount: data["retweet_count"] as? Int ?? 0,
            inReplyToStatusId: data["in_reply_to_status_id_str"] as? String,
            inReplyToUserId: data["in_reply_to_user_id_str"] as? String,
            hashtags: hashtags,
            mentions: mentions,
            urls: urls,
            mediaURLs: mediaURLs,
            retweetedStatusId: (data["retweeted_status"] as? [String: Any])?["id_str"] as? String,
            source: extractSource(from: data["source"] as? String)
        )
    }

    func parseDirectMessage(from data: [String: Any]) -> DirectMessage? {
        guard let messageData = data["messageCreate"] as? [String: Any],
              let id = messageData["id"] as? String else {
            return nil
        }

        return DirectMessage(
            id: id,
            senderId: messageData["senderId"] as? String ?? "",
            recipientId: (messageData["recipient"] as? [String: Any])?["recipientId"] as? String ?? "",
            text: messageData["text"] as? String ?? "",
            createdAt: parseTwitterDate(messageData["createdAt"] as? String) ?? Date()
        )
    }

    /// Read Twitter JS file format (window.YTD.xxx.part0 = [...])
    func readTwitterJS(from url: URL) async throws -> Data {
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
