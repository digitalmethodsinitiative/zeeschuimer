export const MODULE_NAME = 'X/Twitter';
export const DOMAIN = 'x.com';
export const MODULE_ID = 'twitter.com';

/**
 * API endpoints that carry posts.
 *
 * Matched as substrings of the request URL. For GraphQL those look like
 * `/i/api/graphql/<queryId>/<OperationName>?variables=...`, so the operation
 * name is what we key on. The query ID appears to change on every deploy.
 *
 * X renames and splits these as it reworks the UI. 
 * 2026: the single profile timeline was split into one operation per tab and
 * the Posts tab moved to `UserOriginalsTimeline`.
 */
const POST_BEARING_ENDPOINTS = [
    'adaptive.json',             // legacy REST timeline
    'HomeTimeline',              // home, "For you" tab
    'HomeLatestTimeline',        // home, "Following" tab
    'ListLatestTweetsTimeline',  // list timeline
    'SearchTimeline',            // search results (all products: top/latest/media)
    'TweetDetail',               // a single post and its conversation
    'UserTweets',                // also matches UserTweetsAndReplies (the "All" tab)
    'UserOriginalsTimeline',     // profile, "Posts" tab
    'UserRepliesTimeline',       // profile, "Replies" tab
    'UserRepostsTimeline',       // profile, "Reposts" tab
    'UserPhotoTimeline',         // profile, "Media"/"Photos" tab
    'UserVideoTimeline',         // profile, "Media"/"Videos" tab
    'ExplorePage',               // explore landing page, which does render posts
    'Likes',                     // profile, "Likes" tab (own likes only; other
                                 // users' likes are no longer viewable)
];

export function capture(response, source_platform_url, source_url) {
    // source_platform_url is the tab's URL
    let domain = (source_platform_url || '').split("/")[2];
    if (!domain) {
        return [];
    }
    domain = domain.toLowerCase().replace(/^www\./, '');

    if (
        !["x.com"].includes(domain)
        || !POST_BEARING_ENDPOINTS.some(endpoint => source_url.indexOf(endpoint) >= 0)
    ) {
        return [];
    }

    let data;
    let tweets = [];
    try {
        data = JSON.parse(response);
    } catch (SyntaxError) {
        return [];
    }

    // find 'entries' in the API response
    // Twitter JSON objects are RPC-like objects that are interpreted
    // One of the 'instructions' is to add entries to the timeline, this is what we are interested in because what
    // is added to the timeline are the tweets!
    // So find those instructions in the object, and reconstruct the tweets from there
    let traverse = function (obj) {
        for (let property in obj) {
            let child = obj[property];
            if (!child) {
                continue;
            }
            // Timeline instructions deliver posts in two shapes: most carry an
            // `entries` array, but a pinned post arrives as its own
            // TimelinePinEntry instruction holding a single `entry`. 
            // Normalise both here.
            let entries = null;
            if (
                (
                    (child.hasOwnProperty('type') && child['type'] === 'TimelineAddEntries')
                    || (!child.hasOwnProperty('type') && Object.keys(child).length === 1)
                )
                && child.hasOwnProperty('entries')
            ) {
                entries = child['entries'];
            } else if (child['type'] === 'TimelinePinEntry' && child['entry']) {
                entries = [child['entry']];
            }

            if (entries) {
                for (let entry of entries) {
                    if ('itemContent' in entry['content']) {
                        // tweets are sometimes embedded directly in this object
                        if (entry['content']['itemContent']['itemType'].indexOf('Cursor') >= 0) {
                            continue;
                        }
                        // Skip items without tweet_results (like TimelineLabel e.g., with "Probable spam")
                        if (!entry['content']['itemContent']['tweet_results']) {
                            continue;
                        }
                        let tweet = entry['content']['itemContent']['tweet_results']['result']
                        if (!tweet || tweet['__typename'] === 'TweetUnavailable') {
                            // this sometimes happens
                            // no other data in the object, so just skip
                            continue;
                        }

                        if ('tweet' in tweet) {
                            // sometimes this is nested once more, for some reason
                            tweet = tweet['tweet'];
                        }
                        tweet['id'] = tweet['legacy']['id_str'];
                        // distinguish tweets that were included because they were "promoted" from
                        // those that are actually part of the user/home timeline or search result.
                        // assume a tweet was promoted if itemContent has promotedMetadata
                        tweet['promoted'] = ('promotedMetadata' in entry['content']['itemContent']);
                        tweets.push(tweet);

                    } else if ('__typename' in entry['content'] && entry['content']['__typename'] === 'TimelineTimelineModule') {
                        // conversation threads, e.g. the replies under a single post
                        for (const item of (entry['content']['items'] ?? [])) {
                            const item_content = item?.['item']?.['itemContent'];
                            if (!item_content || !['Tweet', 'TimelineTweet'].includes(item_content['__typename'])) {
                                continue;
                            }

                            // X returns an empty `tweet_results: {}` for replies that
                            // have been deleted or are otherwise unavailable.
                            let reply_tweet = item_content['tweet_results']?.['result'];
                            if (!reply_tweet || reply_tweet['__typename'] === 'TweetUnavailable') {
                                continue;
                            }
                            if ('tweet' in reply_tweet) {
                                // sometimes nested once more, as above
                                reply_tweet = reply_tweet['tweet'];
                            }
                            if (!reply_tweet['rest_id']) {
                                continue;
                            }

                            // Keep the id a string. Post ids passed 2^53 long ago, so
                            // parseInt silently rounds them
                            // (e.g. 2090457220026626468 -> 2090457220026626600)
                            // old deduplication key and the permalink built may be corrupt
                            tweets.push({...reply_tweet, id: reply_tweet['rest_id']});
                        }
                    } else {
                        // in other cases this object only contains a reference to the full tweet, which is in turn
                        // stored elsewhere in the parent object
                        let entry_id = entry['entryId'];
                        let tweet_id;
                        if (entry_id.indexOf('tweet-') === 0) {
                            // ordinary tweets
                            tweet_id = entry_id.split('-')[1];
                        } else if (entry_id.indexOf('sq-I-t-') === 0) {
                            // search results
                            tweet_id = entry_id.split('-')[3];
                        } else {
                            // not in a format we understand
                            continue;
                        }

                        // 'legacy' is a weird key, but Twitter uses it in its other data format to store the actual
                        // tweet data, so let's use it here as well to make processing later a bit easier
                        // id stays a string for the same precision reason as above
                        const legacy_tweet = data['globalObjects']?.['tweets']?.[tweet_id];
                        if (!legacy_tweet) {
                            // referenced but not actually included in the response
                            continue;
                        }
                        let tweet = {
                            id: tweet_id,
                            legacy: legacy_tweet,
                            type: 'adaptive'
                        }

                        // the user is also stored as a reference - so add the user data to the tweet
                        tweet['user'] = data['globalObjects']?.['users']?.[legacy_tweet['user_id_str']]

                        tweets.push(tweet);
                    }
                }

            } else if (typeof (child) === "object") {
                traverse(child);
            }
        }
    }

    traverse(data);
    return tweets;
}

// === auto-generated by 4cat map_item sync — BLOCK REPLACED AUTOMATICALLY ===
// (regenerated from datasources/twitter-import/search_twitter.py)
function map_item_modern(tweet) {
    // Resolve author information
    const userResult = (tweet.core && tweet.core.user_results && tweet.core.user_results.result) || {};
    const author = map_user(userResult);
    const authorScreenName = author.screen_name || _screen_name_from_media(py_get(tweet, "legacy", {}));
    const authorFullname = author.fullname;
    const authorAvatarUrl = author.avatar_url;
    const authorBannerUrl = author.banner_url;
    const authorVerified = author.verified;
    const authorFollowers = author.followers;
    const authorFollowing = author.following;
    const authorBio = author.bio;
    const authorLocation = author.location;

    const tweetLink = authorScreenName
        ? `https://x.com/${authorScreenName}/status/${py_get(tweet, "id")}`
        : `https://x.com/i/web/status/${py_get(tweet, "rest_id")}`;

    const createdAtStr = py_get(py_get(tweet, "legacy", {}), "created_at");
    const createdDate = new Date(createdAtStr);
    const unixTimestamp = Math.floor(createdDate.getTime() / 1000);
    const timestamp = formatUtcTimestamp(unixTimestamp);
    let withheld = false;

    let body = get_full_text(tweet);

    const retweetObj = py_get(py_get(tweet, "legacy", {}), "retweeted_status_result");
    let retweetedUser = "";
    if (retweetObj) {
        let rtResult = retweetObj.result;
        if (rtResult && rtResult.tweet) {
            rtResult = rtResult.tweet;
        }
        const rtUserResult = (rtResult && rtResult.core && rtResult.core.user_results && rtResult.core.user_results.result) || {};
        retweetedUser = map_user(rtUserResult).screen_name || _screen_name_from_media(py_get(rtResult, "legacy", {}));
        if (py_get(rtResult, "legacy", {}) && py_get(py_get(rtResult, "legacy", {}), "withheld_scope")) {
            withheld = true;
            body = get_full_text(rtResult);
        } else {
            body = "RT @" + retweetedUser + ": " + get_full_text(rtResult);
        }
    }

    let quoteTweet = py_get(tweet, "quoted_status_result");
    if (quoteTweet && quoteTweet.result && quoteTweet.result.tweet) {
        quoteTweet.result = quoteTweet.result.tweet;
    }
    const quoteWithheld = !!(quoteTweet && quoteTweet.result && quoteTweet.result.tombstone);

    let quoteAuthor = "";
    let quoteBody = "";
    let quoteImages = [];
    let quoteVideos = [];
    if (quoteTweet && !quoteWithheld) {
        const quoteResult = quoteTweet.result;
        const quoteUserResult = (quoteResult && quoteResult.core && quoteResult.core.user_results && quoteResult.core.user_results.result) || {};
        quoteAuthor = map_user(quoteUserResult).screen_name || _screen_name_from_media(py_get(quoteResult, "legacy", {}));
        quoteBody = get_full_text(quoteResult);
        const media = get_media(quoteResult);
        quoteImages = media[0];
        quoteVideos = media[1];
    }

    let quoteTweetId = py_get(py_get(tweet, "legacy", {}), "quoted_status_id_str", "");
    if (!quoteTweetId && quoteTweet && quoteTweet.result) {
        quoteTweetId = py_get(quoteTweet.result, "rest_id", "");
    }
    const isQuoteTweet = Boolean(quoteTweetId || quoteTweet || py_get(py_get(tweet, "legacy", {}), "is_quote_status"));
    if (!quoteAuthor) {
        const permalink = py_get(py_get(py_get(tweet, "legacy", {}), "quoted_status_permalink", {}), "expanded", "");
        quoteAuthor = _screen_name_from_url(permalink);
    }

    const mediaResult = get_media(tweet);
    const images = mediaResult[0];
    const videos = mediaResult[1];
    const entities = get_entities(tweet);

    return {
        "collected_from_url": normalize_url_encoding(py_get(py_get(tweet, "__import_meta", {}), "source_platform_url", "")),
        "id": py_get(tweet, "rest_id"),
        "thread_id": py_get(py_get(tweet, "legacy", {}), "conversation_id_str"),
        "timestamp": timestamp,
        "unix_timestamp": unixTimestamp,
        "link": tweetLink,
        "body": body,
        "author": authorScreenName,
        "author_fullname": authorFullname,
        "author_id": py_get(py_get(tweet, "legacy", {}), "user_id_str"),
        "author_avatar_url": authorAvatarUrl,
        "author_banner_url": authorBannerUrl,
        "author_followers": authorFollowers,
        "author_following": authorFollowing,
        "author_bio": authorBio,
        "author_location": authorLocation,
        "verified": authorVerified,
        "source": strip_tags(py_get(tweet, "source", "")),
        "language_guess": py_get(py_get(tweet, "legacy", {}), "lang"),
        "possibly_sensitive": (py_get(tweet, "possibly_sensitive", false) || py_get(py_get(tweet, "legacy", {}), "possibly_sensitive", false)) ? "yes" : "no",
        "retweet_count": py_get(py_get(tweet, "legacy", {}), "retweet_count"),
        "reply_count": py_get(py_get(tweet, "legacy", {}), "reply_count"),
        "like_count": py_get(py_get(tweet, "legacy", {}), "favorite_count"),
        "quote_count": py_get(py_get(tweet, "legacy", {}), "quote_count"),
        "impression_count": py_get(py_get(tweet, "views", {}), "count", ""),
        "is_retweet": retweetObj ? "yes" : "no",
        "retweeted_user": retweetedUser,
        "is_quote_tweet": isQuoteTweet ? "yes" : "no",
        "quote_tweet_id": quoteTweetId,
        "quote_author": quoteAuthor,
        "quote_body": quoteBody,
        "quote_images": quoteImages.join(","),
        "quote_videos": quoteVideos.join(","),
        "is_quote_withheld": quoteWithheld ? "yes" : "no",
        "is_reply": String(py_get(py_get(tweet, "legacy", {}), "conversation_id_str")) !== String(py_get(tweet, "rest_id")) ? "yes" : "no",
        "replied_author": py_get(py_get(tweet, "legacy", {}), "in_reply_to_screen_name", ""),
        "is_withheld": withheld ? "yes" : "no",
        "hashtags": (entities.hashtags || []).map(h => h.text).join(","),
        "urls": (entities.urls || []).map(u => u.expanded_url || u.display_url).join(","),
        "images": images.join(","),
        "videos": videos.join(","),
        "mentions": (entities.user_mentions || []).map(m => m.screen_name).join(","),
        "long_lat": py_get(py_get(tweet, "legacy", {}), "place") ? get_centroid(py_get(py_get(py_get(tweet, "legacy", {}), "place", {}), "bounding_box", {}).coordinates) : "",
        "place_name": py_get(py_get(py_get(tweet, "legacy", {}), "place", {}), "full_name", "")
    };
}

function map_item_legacy(tweet) {
    const createdAtStr = py_get(py_get(tweet, "legacy", {}), "created_at");
    const createdDate = new Date(createdAtStr);
    const unixTimestamp = Math.floor(createdDate.getTime() / 1000);
    const timestamp = formatUtcTimestamp(unixTimestamp);
    const tweetId = py_get(py_get(tweet, "legacy", {}), "id_str");
    let withheld = false;

    const retweetObj = py_get(py_get(tweet, "legacy", {}), "retweeted_status_result");
    if (retweetObj) {
        const rtLegacy = py_get(retweetObj, "result", {});
        if (py_get(py_get(rtLegacy, "legacy", {}), "withheld_status")) {
            withheld = true;
            py_get(tweet, "legacy").full_text = py_get(rtLegacy, "legacy", {}).full_text;
        } else {
            const rtUserScreen = py_get(py_get(py_get(rtLegacy, "core", {}), "user_results", {}), "result", {}).legacy.screen_name;
            const tText = "RT @" + rtUserScreen + " " + py_get(rtLegacy, "legacy", {}).full_text;
            py_get(tweet, "legacy").full_text = tText;
        }
    }

    let quoteTweet = py_get(tweet, "quoted_status_result");
    if (quoteTweet && quoteTweet.result && quoteTweet.result.tweet) {
        quoteTweet.result = quoteTweet.result.tweet;
    }

    let quoteTweetId = py_get(py_get(tweet, "legacy", {}), "quoted_status_id_str", "");
    if (!quoteTweetId && quoteTweet && quoteTweet.result) {
        quoteTweetId = py_get(quoteTweet.result, "rest_id", "");
    }
    const isQuoteTweet = Boolean(quoteTweetId || quoteTweet || py_get(py_get(tweet, "legacy", {}), "is_quote_status"));
    const retweetUser = retweetObj
        ? py_get(py_get(py_get(py_get(retweetObj, "result", {}), "core", {}), "user_results", {}), "result", {})
        : {};
    let quoteAuthor = "";
    if (quoteTweet) {
        const quoteUser = py_get(py_get(py_get(py_get(quoteTweet, "result", {}), "core", {}), "user_results", {}), "result", {});
        quoteAuthor = py_get(py_get(quoteUser, "legacy", {}), "screen_name", "");
    }
    if (!quoteAuthor) {
        const permalink = py_get(py_get(py_get(tweet, "legacy", {}), "quoted_status_permalink", {}), "expanded", "");
        quoteAuthor = _screen_name_from_url(permalink);
    }

    return {
        "collected_from_url": normalize_url_encoding(py_get(py_get(tweet, "__import_meta", {}), "source_platform_url", "")),
        "id": tweetId,
        "thread_id": py_get(py_get(tweet, "legacy", {}), "conversation_id_str"),
        "timestamp": timestamp,
        "unix_timestamp": unixTimestamp,
        "link": `https://x.com/${py_get(tweet, "user", {}).screen_name}/status/${tweetId}`,
        "body": py_get(py_get(tweet, "legacy", {}), "full_text"),
        "author": py_get(tweet, "user", {}).screen_name,
        "author_fullname": py_get(tweet, "user", {}).name,
        "author_id": py_get(tweet, "user", {}).id_str,
        "author_avatar_url": "",
        "author_banner_url": "",
        "author_followers": py_get(py_get(tweet, "user", {}), "followers_count", ""),
        "author_following": py_get(py_get(tweet, "user", {}), "friends_count", ""),
        "author_bio": py_get(py_get(tweet, "user", {}), "description", ""),
        "author_location": py_get(py_get(tweet, "user", {}), "location", ""),
        "verified": "",
        "source": strip_tags(py_get(py_get(tweet, "legacy", {}), "source", "")),
        "language_guess": py_get(py_get(tweet, "legacy", {}), "lang"),
        "possibly_sensitive": py_get(py_get(tweet, "legacy", {}), "possibly_sensitive") ? "yes" : "no",
        "retweet_count": py_get(py_get(tweet, "legacy", {}), "retweet_count"),
        "reply_count": py_get(py_get(tweet, "legacy", {}), "reply_count"),
        "like_count": py_get(py_get(tweet, "legacy", {}), "favorite_count"),
        "quote_count": py_get(py_get(tweet, "legacy", {}), "quote_count"),
        "impression_count": py_get(py_get(tweet, "ext_views", {}), "count", ""),
        "is_retweet": retweetObj ? "yes" : "no",
        "retweeted_user": retweetObj ? py_get(py_get(retweetUser, "legacy", {}), "screen_name", "") : "",
        "is_quote_tweet": isQuoteTweet ? "yes" : "no",
        "quote_tweet_id": quoteTweetId,
        "quote_author": quoteAuthor,
        "quote_body": "",
        "quote_images": "",
        "quote_videos": "",
        "is_quote_withheld": "",
        "is_reply": String(py_get(py_get(tweet, "legacy", {}), "conversation_id_str")) !== tweetId ? "yes" : "no",
        "replied_author": py_get(py_get(tweet, "legacy", {}), "in_reply_to_screen_name", ""),
        "is_withheld": withheld ? "yes" : "no",
        "hashtags": (py_get(py_get(py_get(tweet, "legacy", {}), "entities", {}), "hashtags", [])).map(h => h.text).join(","),
        "urls": (py_get(py_get(py_get(tweet, "legacy", {}), "entities", {}), "urls", [])).map(u => u.expanded_url || u.display_url).join(","),
        "images": (py_get(py_get(py_get(tweet, "legacy", {}), "extended_entities", {}), "media", []).filter(m => m.type === "photo").map(m => m.media_url_https)).join(","),
        "videos": (py_get(py_get(py_get(tweet, "legacy", {}), "extended_entities", {}), "media", []).filter(m => m.type === "video").map(m => m.video_info.variants[0].url)).join(","),
        "mentions": (py_get(py_get(py_get(tweet, "legacy", {}), "entities", {}), "user_mentions", [])).map(m => m.screen_name).join(","),
        "long_lat": py_get(py_get(tweet, "legacy", {}), "place") ? get_centroid(py_get(py_get(py_get(tweet, "legacy", {}), "place", {}), "bounding_box", {}).coordinates) : "",
        "place_name": py_get(py_get(py_get(tweet, "legacy", {}), "place", {}), "full_name", "")
    };
}

function map_user(userResult) {
    if (typeof userResult !== "object" || userResult === null) {
        userResult = {};
    }
    const core = userResult.core || {};
    const legacy = userResult.legacy || {};
    const avatar = userResult.avatar || {};
    const banner = userResult.banner || {};
    const counts = userResult.relationship_counts || {};
    const profileBio = userResult.profile_bio || {};
    const location = userResult.location || {};

    function first(...values) {
        for (const v of values) {
            if (v !== undefined && v !== null) {
                return v;
            }
        }
        return "";
    }

    return {
        screen_name: core.screen_name || legacy.screen_name || "",
        fullname: core.name || legacy.name || "",
        avatar_url: avatar.image_url || legacy.profile_image_url_https || "",
        banner_url: banner.image_url || legacy.profile_banner_url || "",
        verified: py_get(userResult, "is_blue_verified", ""),
        followers: first(counts.followers, legacy.followers_count),
        following: first(counts.following, legacy.friends_count),
        bio: first(profileBio.description, legacy.description),
        location: first(location.location, legacy.location)
    };
}

function get_note_result(tweet) {
    const note = py_get(tweet, "note_tweet", {});
    return py_get(py_get(note, "note_tweet_results", {}), "result", {});
}

function get_full_text(tweet) {
    const text = py_get(py_get(tweet, "legacy", {}), "full_text", "");
    const noteText = py_get(get_note_result(tweet), "text", "");
    return noteText.length > text.length ? noteText : text;
}

function get_entities(tweet) {
    const entities = py_get(py_get(tweet, "legacy", {}), "entities", {});
    const note = get_note_result(tweet);
    const noteEntities = note.entity_set;
    if (!noteEntities) {
        return entities;
    }
    const legacyFullText = py_get(py_get(tweet, "legacy", {}), "full_text", "");
    const noteText = note.text || "";
    if (noteText.length <= legacyFullText.length) {
        return entities;
    }
    const combined = Object.assign({}, noteEntities);
    if (entities.media) {
        combined.media = entities.media;
    }
    return combined;
}

function get_media(tweet) {
    const images = [];
    const videos = [];
    const legacy = py_get(tweet, "legacy", {});
    const extended = py_get(legacy, "extended_entities", {});
    const entities = py_get(legacy, "entities", {});
    const mediaItems = [];
    if (Array.isArray(extended.media)) {
        mediaItems.push(...extended.media);
    }
    if (Array.isArray(entities.media)) {
        mediaItems.push(...entities.media);
    }
    for (const media of mediaItems) {
        if (!media.media_url_https) continue;
        images.push(media.media_url_https);
        if (media.type !== "video" && media.type !== "animated_gif") continue;
        const variants = (media.video_info && media.video_info.variants) || [];
        const videoVariants = variants.filter(v => (v.content_type || "").startsWith("video/"));
        if (videoVariants.length) {
            videoVariants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            videos.push(videoVariants[0].url);
        }
    }
    // deduplicate while preserving order
    const uniqImages = [...new Set(images)];
    const uniqVideos = [...new Set(videos)];
    return [uniqImages, uniqVideos];
}

function _screen_name_from_url(url) {
    if (typeof url !== "string") return "";
    const m = url.match(/^https?:\/\/(?:x|twitter)\.com\/([^/]+)\/status\//);
    return m ? m[1] : "";
}

function _screen_name_from_media(legacyObj) {
    if (typeof legacyObj !== "object" || legacyObj === null) return "";
    for (const container of ["extended_entities", "entities"]) {
        const mediaArray = py_get(legacyObj, container, {}).media || [];
        for (const m of mediaArray) {
            const url = typeof m === "object" ? py_get(m, "expanded_url", "") : "";
            const screen = _screen_name_from_url(url);
            if (screen) return screen;
        }
    }
    return "";
}

function get_centroid(box) {
    try {
        const ring = box[0];
        if (!Array.isArray(ring) || ring.length < 2 || !ring[0] || !ring[1]) {
            return "";
        }
        const lon = String(Number(((ring[0][0] + ring[1][0]) / 2).toFixed(6)));
        const lat = String(Number(((ring[0][1] + ring[1][1]) / 2).toFixed(6)));
        return `${lon},${lat}`;
    } catch (e) {
        return "";
    }
}

export function map_item(item) {
    if (py_get(item, "rest_id")) {
        return new MappedItem(map_item_modern(item));
    } else if (py_get(item, "type") === "adaptive") {
        return new MappedItem(map_item_legacy(item));
    } else {
        throw new MapItemException("Unsupported item shape");
    }
}
// === end auto-generated ===
