export const MODULE_NAME = 'X/Twitter';
export const DOMAIN = 'x.com';
export const MODULE_ID = 'twitter.com';

export function capture(response, source_platform_url, source_url) {
    let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

    if (
        !["x.com"].includes(domain)
        || (
            // these are known API endpoints used to fetch tweets for the interface
            source_url.indexOf('adaptive.json') < 0
            && source_url.indexOf('HomeLatestTimeline') < 0
            && source_url.indexOf('HomeTimeline') < 0
            && source_url.indexOf('ListLatestTweetsTimeline') < 0
            && source_url.indexOf('UserTweets') < 0
            && source_url.indexOf('Likes') < 0
            && source_url.indexOf('SearchTimeline') < 0
            && source_url.indexOf('TweetDetail') < 0
            // this one is not enabled because it is always loaded when viewing a user profile
            // even when not viewing the media tab
            // && source_url.indexOf('UserMedia') < 0
        )
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
            if (
                (
                    (child.hasOwnProperty('type') && child['type'] === 'TimelineAddEntries')
                    || (!child.hasOwnProperty('type') && Object.keys(child).length === 1)
                )
                && child.hasOwnProperty('entries')
            ) {

                for (let entry in child['entries']) {
                    entry = child['entries'][entry];
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
                        // this is for replies to a tweet when viewing a single tweet
                        for (const reply_tweet of entry['content']['items'].filter(item => {
                            return ['Tweet', 'TimelineTweet'].includes(item['item']['itemContent']['__typename']);
                        }).map(item => {
                            return item['item']['itemContent']['tweet_results']['result']
                        })) {
                            tweets.push({...reply_tweet, id: parseInt(reply_tweet['rest_id'])});
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
                        let tweet = {
                            id: parseInt(tweet_id),
                            legacy: data['globalObjects']['tweets'][tweet_id],
                            type: 'adaptive'
                        }

                        // the user is also stored as a reference - so add the user data to the tweet
                        tweet['user'] = data['globalObjects']['users'][tweet['legacy']['user_id_str']]

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
export function map_item(item) {
    if (item['rest_id']) {
        return new MappedItem(map_item_modern(item));
    } else if (item['type'] === 'adaptive') {
        return new MappedItem(map_item_legacy(item));
    } else {
        throw new MapItemException('Unrecognized item shape');
    }
}

function map_item_modern(tweet) {
    // Determine where user data lives
    const hasCore = tweet['core']?.['user_results']?.['result']?.['core'] ?? false;
    const userKey = hasCore ? 'core' : 'legacy';

    // Inline user object may be missing
    const hasUserInline = !!tweet['core']?.['user_results']?.['result'];
    let authorScreenName = '';
    let authorFullname = '';
    let authorAvatarUrl = '';
    let authorBannerUrl = '';
    let authorVerified = '';
    if (hasUserInline) {
        const userResult = tweet['core']['user_results']['result'];
        authorScreenName = userResult[userKey]?.['screen_name'] ?? '';
        authorFullname = userResult[userKey]?.['name'] ?? '';
        authorAvatarUrl = userResult['avatar']?.['image_url'] ?? userResult['legacy']?.['profile_image_url_https'] ?? '';
        authorBannerUrl = userResult['legacy']?.['profile_banner_url'] ?? '';
        authorVerified = userResult?.['is_blue_verified'] ?? '';
    } else {
        authorScreenName = _screen_name_from_media(tweet['legacy'] ?? {});
        authorFullname = '';
        authorAvatarUrl = '';
        authorBannerUrl = '';
        authorVerified = '';
    }

    const tweetLink = authorScreenName
        ? `https://x.com/${authorScreenName}/status/${tweet['id']}`
        : `https://x.com/i/web/status/${tweet['rest_id']}`;

    const createdAt = new Date(tweet['legacy']['created_at']);
    const unixTimestamp = Math.floor(createdAt.getTime() / 1000);
    const timestamp = formatUtcTimestamp(unixTimestamp);

    let withheld = false;
    const retweetObj = tweet['legacy']['retweeted_status_result'];
    let retweetedUser = '';
    if (retweetObj) {
        // Ensure full RT is present
        if (retweetObj['result']?.['tweet']) {
            retweetObj['result'] = retweetObj['result']['tweet'];
        }
        const rtResult = retweetObj['result'];
        const rtUserResult = rtResult?.['core']?.['user_results']?.['result'] ?? {};
        if (Object.keys(rtUserResult).length) {
            retweetedUser = rtUserResult[userKey]?.['screen_name']
                ?? rtUserResult['legacy']?.['screen_name']
                ?? '';
        }
        if (!retweetedUser) {
            retweetedUser = _screen_name_from_media(rtResult['legacy'] ?? {});
        }
        if (rtResult?.['legacy']?.['withheld_scope']) {
            withheld = true;
            tweet['legacy']['full_text'] = rtResult['legacy']['full_text'];
        } else {
            const rtText = `RT @${retweetedUser}: ${rtResult['legacy']['full_text']}`;
            tweet['legacy']['full_text'] = rtText;
        }
    }

    let quoteTweet = tweet['quoted_status_result'];
    if (quoteTweet && quoteTweet['result'] && quoteTweet['result']['tweet']) {
        quoteTweet['result'] = quoteTweet['result']['tweet'];
    }
    const quoteWithheld = !!(quoteTweet && quoteTweet['result'] && quoteTweet['result']['tombstone']);
    let quoteAuthor = '';
    if (quoteTweet && !quoteWithheld) {
        const quoteResult = quoteTweet['result'];
        if (quoteResult?.['core']) {
            quoteAuthor = quoteResult['core']['user_results']['result'][userKey]?.['screen_name'] ?? '';
        } else {
            quoteAuthor = _screen_name_from_media(quoteResult['legacy'] ?? {});
        }
    }

    // Media extraction
    const imagesSet = new Set();
    const videosSet = new Set();
    const extendedMedia = tweet['legacy']?.['extended_entities']?.['media'] ?? [];
    for (const media of extendedMedia) {
        if (media['type'] === 'photo') {
            imagesSet.add(media['media_url_https']);
        } else if (media['type'] === 'video') {
            imagesSet.add(media['media_url_https']);
            const variants = media['video_info']?.['variants']?.filter(v => (v['content_type'] ?? '').startsWith('video/')) ?? [];
            if (variants.length) {
                variants.sort((a, b) => (b['bitrate'] ?? 0) - (a['bitrate'] ?? 0));
                videosSet.add(variants[0]['url']);
            }
        }
    }
    const entityMedia = tweet['legacy']?.['entities']?.['media'] ?? [];
    for (const media of entityMedia) {
        if (media['type'] === 'photo') {
            imagesSet.add(media['media_url_https']);
        }
    }

    return {
        collected_from_url: normalize_url_encoding(tweet['__import_meta']?.['source_platform_url'] ?? ''),
        id: tweet['rest_id'],
        thread_id: tweet['legacy']['conversation_id_str'],
        timestamp: timestamp,
        unix_timestamp: unixTimestamp,
        link: tweetLink,
        body: tweet['legacy']['full_text'],
        author: authorScreenName,
        author_fullname: authorFullname,
        author_id: tweet['legacy']['user_id_str'],
        author_avatar_url: authorAvatarUrl,
        author_banner_url: authorBannerUrl,
        verified: authorVerified,
        source: strip_tags(tweet['source']),
        language_guess: tweet['legacy']?.['lang'] ?? null,
        possibly_sensitive: (tweet['possibly_sensitive'] || tweet['legacy']?.['possibly_sensitive']) ? 'yes' : 'no',
        retweet_count: tweet['legacy']['retweet_count'],
        reply_count: tweet['legacy']['reply_count'],
        like_count: tweet['legacy']['favorite_count'],
        quote_count: tweet['legacy']['quote_count'],
        impression_count: tweet['views']?.['count'] ?? '',
        is_retweet: retweetObj ? 'yes' : 'no',
        retweeted_user: retweetedUser,
        is_quote_tweet: quoteTweet ? 'yes' : 'no',
        quote_tweet_id: quoteTweet?.['result']?.['rest_id'] ?? '',
        quote_author: quoteAuthor,
        quote_body: (quoteTweet && !quoteWithheld) ? (quoteTweet['result']['legacy']?.['full_text'] ?? '') : '',
        quote_images: (quoteTweet && !quoteWithheld) ?
            (quoteTweet['result']['legacy']?.['entities']?.['media'] ?? [])
                .filter(m => m['type'] === 'photo')
                .map(m => m['media_url_https'])
                .join(',')
            : '',
        quote_videos: (quoteTweet && !quoteWithheld) ?
            (quoteTweet['result']['legacy']?.['entities']?.['media'] ?? [])
                .filter(m => m['type'] === 'video')
                .map(m => m['media_url_https'])
                .join(',')
            : '',
        is_quote_withheld: quoteWithheld ? 'yes' : 'no',
        is_reply: String(tweet['legacy']['conversation_id_str']) !== String(tweet['rest_id']) ? 'yes' : 'no',
        replied_author: tweet['legacy']?.['in_reply_to_screen_name'] ?? '',
        is_withheld: withheld ? 'yes' : 'no',
        hashtags: (tweet['legacy']['entities']?.['hashtags'] ?? []).map(h => h['text']).join(','),
        urls: (tweet['legacy']['entities']?.['urls'] ?? []).map(u => u['expanded_url'] ?? u['display_url']).join(','),
        images: Array.from(imagesSet).join(','),
        videos: Array.from(videosSet).join(','),
        mentions: (tweet['legacy']['entities']?.['user_mentions'] ?? []).map(m => m['screen_name']).join(','),
        long_lat: tweet['legacy']?.['place'] ? get_centroid(tweet['legacy']['place']['bounding_box']['coordinates']) : '',
        place_name: tweet['legacy']?.['place']?.['full_name'] ?? ''
    };
}

function map_item_legacy(tweet) {
    const createdAt = new Date(tweet['legacy']['created_at']);
    const unixTimestamp = Math.floor(createdAt.getTime() / 1000);
    const timestamp = formatUtcTimestamp(unixTimestamp);
    const tweetId = tweet['legacy']['id_str'];
    let withheld = false;
    const retweetObj = tweet['legacy']['retweeted_status_result'];
    if (retweetObj) {
        if (retweetObj['result']?.['legacy']?.['withheld_status']) {
            withheld = true;
            tweet['legacy']['full_text'] = retweetObj['result']['legacy']['full_text'];
        } else {
            const rtUser = retweetObj['result']['core']['user_results']['result']['legacy']['screen_name'];
            const rtText = `RT @${rtUser} ${retweetObj['result']['legacy']['full_text']}`;
            tweet['legacy']['full_text'] = rtText;
        }
    }
    let quoteTweet = tweet['quoted_status_result'];
    if (quoteTweet && quoteTweet['result'] && quoteTweet['result']['tweet']) {
        quoteTweet['result'] = quoteTweet['result']['tweet'];
    }
    return {
        collected_from_url: normalize_url_encoding(tweet['__import_meta']?.['source_platform_url'] ?? ''),
        id: tweetId,
        thread_id: tweet['legacy']['conversation_id_str'],
        timestamp: timestamp,
        unix_timestamp: unixTimestamp,
        link: `https://x.com/${tweet['user']['screen_name']}/status/${tweetId}`,
        body: tweet['legacy']['full_text'],
        author: tweet['user']['screen_name'],
        author_fullname: tweet['user']['name'],
        author_id: tweet['user']['id_str'],
        author_avatar_url: '',
        author_banner_url: '',
        verified: '',
        source: strip_tags(tweet['legacy']['source']),
        language_guess: tweet['legacy']?.['lang'] ?? null,
        possibly_sensitive: tweet['legacy']?.['possibly_sensitive'] ? 'yes' : 'no',
        retweet_count: tweet['legacy']['retweet_count'],
        reply_count: tweet['legacy']['reply_count'],
        like_count: tweet['legacy']['favorite_count'],
        quote_count: tweet['legacy']['quote_count'],
        impression_count: tweet['ext_views']?.['count'] ?? '',
        is_retweet: retweetObj ? 'yes' : 'no',
        retweeted_user: retweetObj ? (retweetObj['result']['core']['user_results']['result']['legacy']?.['screen_name'] ?? '') : '',
        is_quote_tweet: quoteTweet ? 'yes' : 'no',
        quote_tweet_id: '',
        quote_author: quoteTweet ? (quoteTweet['result']['core']['user_results']['result']['legacy']?.['screen_name'] ?? '') : '',
        quote_body: '',
        quote_images: '',
        quote_videos: '',
        is_quote_withheld: '',
        is_reply: String(tweet['legacy']['conversation_id_str']) !== tweetId ? 'yes' : 'no',
        replied_author: tweet['legacy']?.['in_reply_to_screen_name'] ?? '',
        is_withheld: withheld ? 'yes' : 'no',
        hashtags: (tweet['legacy']['entities']?.['hashtags'] ?? []).map(h => h['text']).join(','),
        urls: (tweet['legacy']['entities']?.['urls'] ?? []).map(u => u['expanded_url'] ?? u['display_url']).join(','),
        images: (tweet['legacy']?.['extended_entities']?.['media'] ?? [])
            .filter(m => m['type'] === 'photo')
            .map(m => m['media_url_https'])
            .join(','),
        videos: (tweet['legacy']?.['extended_entities']?.['media'] ?? [])
            .filter(m => m['type'] === 'video')
            .map(m => m['video_info']?.['variants']?.[0]?.['url'] ?? '')
            .join(','),
        mentions: (tweet['legacy']['entities']?.['user_mentions'] ?? []).map(m => m['screen_name']).join(','),
        long_lat: tweet['legacy']?.['place'] ? get_centroid(tweet['legacy']['place']['bounding_box']['coordinates']) : '',
        place_name: tweet['legacy']?.['place']?.['full_name'] ?? ''
    };
}

function _screen_name_from_media(legacyObj) {
    if (!legacyObj || typeof legacyObj !== 'object') return '';
    const containers = ['extended_entities', 'entities'];
    for (const container of containers) {
        const mediaArray = legacyObj[container]?.['media'] ?? [];
        for (const m of mediaArray) {
            const url = typeof m === 'object' ? (m['expanded_url'] ?? '') : '';
            const match = url.match(/^https?:\/\/(?:x|twitter)\.com\/([^/]+)\/status\//);
            if (match) return match[1];
        }
    }
    return '';
}

function get_centroid(box) {
    try {
        const ring = box[0];
        if (!ring || ring.length < 2 || !ring[0] || !ring[1]) return '';
        const lon = ((ring[0][0] + ring[1][0]) / 2).toFixed(6);
        const lat = ((ring[0][1] + ring[1][1]) / 2).toFixed(6);
        return `${lon},${lat}`;
    } catch (e) {
        return '';
    }
}
// === end auto-generated ===
