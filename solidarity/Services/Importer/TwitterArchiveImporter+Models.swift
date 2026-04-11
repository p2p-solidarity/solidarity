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
