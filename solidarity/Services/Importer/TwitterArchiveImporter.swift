//
//  TwitterArchiveImporter.swift
//  solidarity
//
//  Imports Twitter/X archive data using stream parsing
//  Handles the actual Twitter takeout format
//

import Foundation

// MARK: - Twitter Archive Importer

final class TwitterArchiveImporter {
    static let shared = TwitterArchiveImporter()

    private let streamParser = StreamParser.shared

    /// Running total of bytes accepted from `*.js` files for the current
    /// import. Reset at the start of each `importArchive` call.
    private var bytesAcceptedThisImport: Int64 = 0

    private init() {}

    func noteBytesAccepted(_ bytes: Int64) throws {
        bytesAcceptedThisImport &+= max(0, bytes)
        if bytesAcceptedThisImport > TwitterImportLimits.maxTotalSizeBytes {
            throw TwitterImportError.archiveTooLarge(
                totalBytes: bytesAcceptedThisImport,
                limitBytes: TwitterImportLimits.maxTotalSizeBytes
            )
        }
    }

    // MARK: - Public API

    /// Import tweets from a Twitter archive directory
    func importArchive(
        from archiveURL: URL,
        progress: ((ImportProgress) -> Void)? = nil
    ) async throws -> TwitterArchiveResult {
        bytesAcceptedThisImport = 0
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

}
