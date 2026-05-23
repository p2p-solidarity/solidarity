/**
 * Twitter / X archive importer — mirrors Swift TwitterArchiveImporter.
 *
 * Twitter's "Download your data" archive ships as a folder with JS files
 * that begin with `window.YTD.<kind>.part0 = [` followed by JSON. We strip
 * the JS prefix to get pure JSON, then map into a plain `TwitterArchive`
 * shape.
 *
 * Memory budget: a popular user's tweets.js can be 50 MB+. We don't try to
 * be clever here — the caller is expected to chunk reads if memory is an
 * issue. Mirrors the Swift StreamParser pattern (left for native callers
 * with FileHandle access).
 */

export interface TwitterAccount {
  readonly username: string;
  readonly displayName: string;
  readonly accountId: string;
  readonly createdAt: string;
}

export interface TwitterTweet {
  readonly id: string;
  readonly fullText: string;
  readonly createdAt: string;
  readonly favoriteCount: number;
  readonly retweetCount: number;
}

export interface TwitterArchive {
  readonly account: TwitterAccount;
  readonly tweets: readonly TwitterTweet[];
}

function stripJsPrefix(input: string): string {
  // `window.YTD.<kind>.partN = ` (kind: tweets, account, follower, …)
  const match = input.match(/window\.YTD\.[^=]+= /u);
  return match ? input.slice(match[0].length) : input;
}

interface RawAccount {
  readonly account: {
    readonly username: string;
    readonly accountDisplayName: string;
    readonly accountId: string;
    readonly createdAt: string;
  };
}

interface RawTweet {
  readonly tweet: {
    readonly id_str: string;
    readonly full_text: string;
    readonly created_at: string;
    readonly favorite_count: string;
    readonly retweet_count: string;
  };
}

function parseAccount(text: string): TwitterAccount {
  const arr = JSON.parse(stripJsPrefix(text)) as readonly RawAccount[];
  const first = arr[0];
  if (!first) throw new Error('account.js has no entries');
  return {
    username: first.account.username,
    displayName: first.account.accountDisplayName,
    accountId: first.account.accountId,
    createdAt: first.account.createdAt,
  };
}

function parseTweets(text: string): readonly TwitterTweet[] {
  const arr = JSON.parse(stripJsPrefix(text)) as readonly RawTweet[];
  return arr.map((r) => ({
    id: r.tweet.id_str,
    fullText: r.tweet.full_text,
    createdAt: r.tweet.created_at,
    favoriteCount: Number(r.tweet.favorite_count),
    retweetCount: Number(r.tweet.retweet_count),
  }));
}

export function parseTwitterArchive(files: {
  readonly accountJs: string;
  readonly tweetsJs: string;
}): TwitterArchive {
  return {
    account: parseAccount(files.accountJs),
    tweets: parseTweets(files.tweetsJs),
  };
}
