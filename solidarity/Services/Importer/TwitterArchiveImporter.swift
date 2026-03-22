//
//  TwitterArchiveImporter.swift
//  airmeishi
//
//  Imports Twitter/X archive data using stream parsing
//  Handles the actual Twitter takeout format
//

import Foundation

// MARK: - Twitter Archive Importer

final class TwitterArchiveImporter {
    static let shared = TwitterArchiveImporter()

    private let streamParser = StreamParser.shared

    private init() {}

    // MARK: - Public API

    /// Import tweets from a Twitter archive directory
    func importArchive(
        from archiveURL: URL,
        progress: ((ImportProgress) -> Void)? = nil
    ) async throws -> TwitterArchiveResult {
        var result = TwitterArchiveResult()

        // Twitter archive structure:
        // data/
        //   tweets.js
        //   tweet-headers.js
        //   like.js
        //   follower.js
        //   following.js
        //   account.js
        //   profile.js
        //   direct-messages.js

        let dataURL = archiveURL.appendingPathComponent("data")

        // Check if this is a valid Twitter archive
        guard FileManager.default.fileExists(atPath: dataURL.path) else {
            throw TwitterImportError.invalidArchiveFormat
        }

        let totalSteps = 5
        var currentStep = 0

        // 1. Import account info
        progress?(ImportProgress(step: "Reading account info", progress: Double(currentStep) / Double(totalSteps)))
        if let accountInfo = try? await importAccountInfo(from: dataURL) {
            result.account = accountInfo
        }
        currentStep += 1

        // 2. Import tweets
        progress?(ImportProgress(step: "Importing tweets", progress: Double(currentStep) / Double(totalSteps)))
        let tweetsURL = dataURL.appendingPathComponent("tweets.js")
        if FileManager.default.fileExists(atPath: tweetsURL.path) {
            let tweets = try await importTweets(from: tweetsURL) { tweetProgress in
                let totalProgress = (Double(currentStep) + tweetProgress) / Double(totalSteps)
                progress?(ImportProgress(step: "Importing tweets", progress: totalProgress))
            }
            result.tweets = tweets
        }
        currentStep += 1

        // 3. Import likes
        progress?(ImportProgress(step: "Importing likes", progress: Double(currentStep) / Double(totalSteps)))
        let likesURL = dataURL.appendingPathComponent("like.js")
        if FileManager.default.fileExists(atPath: likesURL.path) {
            let likes = try await importLikes(from: likesURL)
            result.likes = likes
        }
        currentStep += 1

        // 4. Import followers/following
        progress?(ImportProgress(step: "Importing connections", progress: Double(currentStep) / Double(totalSteps)))
        let followerURL = dataURL.appendingPathComponent("follower.js")
        let followingURL = dataURL.appendingPathComponent("following.js")

        if FileManager.default.fileExists(atPath: followerURL.path) {
            result.followers = try await importConnections(from: followerURL)
        }
        if FileManager.default.fileExists(atPath: followingURL.path) {
            result.following = try await importConnections(from: followingURL)
        }
        currentStep += 1

        // 5. Import DMs (if present)
        progress?(ImportProgress(step: "Importing messages", progress: Double(currentStep) / Double(totalSteps)))
        let dmURL = dataURL.appendingPathComponent("direct-messages.js")
        if FileManager.default.fileExists(atPath: dmURL.path) {
            result.directMessages = try await importDirectMessages(from: dmURL)
        }
        currentStep += 1

        progress?(ImportProgress(step: "Complete", progress: 1.0))

        return result
    }

    /// Search imported tweets
    func searchTweets(_ tweets: [Tweet], query: String) -> [Tweet] {
        let lowercasedQuery = query.lowercased()
        return tweets.filter { tweet in
            tweet.fullText.lowercased().contains(lowercasedQuery) ||
            tweet.hashtags.contains { $0.lowercased().contains(lowercasedQuery) } ||
            tweet.mentions.contains { $0.lowercased().contains(lowercasedQuery) }
        }
    }

    /// Get tweet statistics
    func computeStatistics(for tweets: [Tweet]) -> TweetStatistics {
        var stats = TweetStatistics()

        stats.totalTweets = tweets.count
        stats.originalTweets = tweets.filter { !$0.isRetweet && !$0.isReply }.count
        stats.retweets = tweets.filter { $0.isRetweet }.count
        stats.replies = tweets.filter { $0.isReply }.count

        // Calculate engagement
        stats.totalLikes = tweets.reduce(0) { $0 + $1.favoriteCount }
        stats.totalRetweets = tweets.reduce(0) { $0 + $1.retweetCount }

        // Find most liked
        if let mostLiked = tweets.max(by: { $0.favoriteCount < $1.favoriteCount }) {
            stats.mostLikedTweet = mostLiked
        }

        // Hashtag frequency
        var hashtagCounts: [String: Int] = [:]
        for tweet in tweets {
            for hashtag in tweet.hashtags {
                hashtagCounts[hashtag.lowercased(), default: 0] += 1
            }
        }
        stats.topHashtags = hashtagCounts.sorted { $0.value > $1.value }
            .prefix(10)
            .map { ($0.key, $0.value) }

        // Monthly tweet counts
        var monthlyCounts: [String: Int] = [:]
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM"
        for tweet in tweets {
            let key = formatter.string(from: tweet.createdAt)
            monthlyCounts[key, default: 0] += 1
        }
        stats.tweetsByMonth = monthlyCounts.sorted { $0.key < $1.key }
            .map { ($0.key, $0.value) }

        return stats
    }

    // MARK: - Private Methods

    private func importAccountInfo(from dataURL: URL) async throws -> TwitterAccount {
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

    private func importLikes(from url: URL) async throws -> [Like] {
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

    private func importConnections(from url: URL) async throws -> [Connection] {
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

    private func importDirectMessages(from url: URL) async throws -> [DirectMessageConversation] {
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

    private func parseTweet(from data: [String: Any]) -> Tweet? {
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

    private func parseDirectMessage(from data: [String: Any]) -> DirectMessage? {
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
    private func readTwitterJS(from url: URL) async throws -> Data {
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

    private func parseTwitterDate(_ dateString: String?) -> Date? {
        guard let dateString = dateString else { return nil }

        // Twitter date format: "Wed Oct 10 20:19:24 +0000 2018"
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "E MMM dd HH:mm:ss Z yyyy"

        return formatter.date(from: dateString)
    }

    private func extractSource(from htmlSource: String?) -> String {
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

// MARK: - Data Models

struct TwitterArchiveResult {
    var account: TwitterAccount?
    var tweets: [Tweet] = []
    var likes: [Like] = []
    var followers: [Connection] = []
    var following: [Connection] = []
    var directMessages: [DirectMessageConversation] = []

    var summary: String {
        """
        Account: @\(account?.username ?? "Unknown")
        Tweets: \(tweets.count)
        Likes: \(likes.count)
        Followers: \(followers.count)
        Following: \(following.count)
        DM Conversations: \(directMessages.count)
        """
    }
}

struct TwitterAccount: Codable {
    let id: String
    let username: String
    let displayName: String
    let email: String
    let createdAt: Date
    var bio: String?
    var avatarURL: URL?
}

struct Tweet: Identifiable, Codable {
    let id: String
    let fullText: String
    let createdAt: Date
    let favoriteCount: Int
    let retweetCount: Int
    let inReplyToStatusId: String?
    let inReplyToUserId: String?
    let hashtags: [String]
    let mentions: [String]
    let urls: [String]
    let mediaURLs: [URL]
    let retweetedStatusId: String?
    let source: String

    var isReply: Bool { inReplyToStatusId != nil }
    var isRetweet: Bool { retweetedStatusId != nil }
    var hasMedia: Bool { !mediaURLs.isEmpty }

    var tweetURL: URL? {
        URL(string: "https://twitter.com/i/status/\(id)")
    }
}

struct Like: Identifiable, Codable {
    var id: String { tweetId }
    let tweetId: String
    let fullText: String?
    let expandedUrl: String?
}

struct Connection: Identifiable, Codable {
    var id: String { accountId }
    let accountId: String
    let userLink: String?
}

struct DirectMessageConversation: Identifiable, Codable {
    var id: String { conversationId }
    let conversationId: String
    let messages: [DirectMessage]
}

struct DirectMessage: Identifiable, Codable {
    let id: String
    let senderId: String
    let recipientId: String
    let text: String
    let createdAt: Date
}

struct ImportProgress {
    let step: String
    let progress: Double
}

struct TweetStatistics {
    var totalTweets: Int = 0
    var originalTweets: Int = 0
    var retweets: Int = 0
    var replies: Int = 0
    var totalLikes: Int = 0
    var totalRetweets: Int = 0
    var mostLikedTweet: Tweet?
    var topHashtags: [(String, Int)] = []
    var tweetsByMonth: [(String, Int)] = []
}

// MARK: - Errors

enum TwitterImportError: LocalizedError {
    case invalidArchiveFormat
    case missingFile(String)
    case invalidDataFormat
    case parsingFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidArchiveFormat:
            return "Invalid Twitter archive format. Please provide the unzipped archive folder."
        case .missingFile(let file):
            return "Required file '\(file)' not found in archive"
        case .invalidDataFormat:
            return "Could not parse Twitter data format"
        case .parsingFailed(let reason):
            return "Parsing failed: \(reason)"
        }
    }
}
