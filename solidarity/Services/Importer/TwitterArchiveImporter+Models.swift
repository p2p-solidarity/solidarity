//
//  TwitterArchiveImporter+Models.swift
//  solidarity
//
//  Data models and error types for Twitter archive import
//

import Foundation

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

// MARK: - Import Limits

/// Hard caps applied during Twitter archive import to prevent OOM / memory bombs.
/// Values picked for an iPhone with 4–6 GB RAM where we keep the entire decoded
/// archive in memory; if a future redesign streams to disk these can be raised.
enum TwitterImportLimits {
    /// Max accepted size for any single `*.js` file in the archive.
    static let maxFileSizeBytes: Int64 = 8 * 1024 * 1024
    /// Max accepted total bytes summed across all files we read.
    static let maxTotalSizeBytes: Int64 = 64 * 1024 * 1024
    /// Max accepted record count per array (tweets, likes, followers, …).
    static let maxRecordsPerArray = 100_000
    /// Max bytes kept for short string fields (username, display name, urls, …).
    static let maxShortFieldBytes = 4 * 1024
    /// Max bytes kept for long-form text (tweet/DM body).
    static let maxLongFieldBytes = 16 * 1024
}

// MARK: - Errors

enum TwitterImportError: LocalizedError {
    case invalidArchiveFormat
    case missingFile(String)
    case invalidDataFormat
    case parsingFailed(String)
    case fileTooLarge(name: String, sizeBytes: Int64, limitBytes: Int64)
    case archiveTooLarge(totalBytes: Int64, limitBytes: Int64)

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
        case .fileTooLarge(let name, let sizeBytes, let limitBytes):
            return "Archive file '\(name)' is \(sizeBytes) bytes, exceeds limit \(limitBytes)"
        case .archiveTooLarge(let totalBytes, let limitBytes):
            return "Archive total size \(totalBytes) bytes exceeds limit \(limitBytes)"
        }
    }
}
