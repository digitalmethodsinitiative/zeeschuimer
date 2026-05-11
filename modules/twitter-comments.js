zeeschuimer.register_module(
    'X/Twitter (comments)',
    'x.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        const root_tweet_id_match = source_platform_url.match(/\/status\/(\d+)/);
        const root_tweet_id = root_tweet_id_match ? root_tweet_id_match[1] : null;
        const looks_like_tweet_request = source_url.indexOf('TweetDetail') >= 0
            || source_url.indexOf('tweetdetail') >= 0
            || source_url.indexOf('/graphql/') >= 0
            || source_url.indexOf('/i/api/') >= 0;

        if (!["x.com"].includes(domain)) {
            return [];
        }

        // X frequently changes the exact GraphQL operation name used to load
        // replies. When the user is on a /status/... page, be permissive about
        // which request may contain the thread payload.
        if (!root_tweet_id && !looks_like_tweet_request) {
            return [];
        }

        let data;
        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        let comments = [];
        let seen = new Set();

        const normalise_tweet = function (tweet) {
            if (!tweet || tweet['__typename'] === 'TweetUnavailable') {
                return null;
            }

            if ('tweet' in tweet) {
                tweet = tweet['tweet'];
            }

            if (!tweet['legacy']) {
                return null;
            }

            const tweet_id = tweet['legacy']['id_str'] || tweet['rest_id'];
            if (!tweet_id) {
                return null;
            }

            tweet['id'] = tweet_id;
            return tweet;
        };

        const normalise_user = function (tweet) {
            const user = tweet['core'] && tweet['core']['user_results'] && tweet['core']['user_results']['result'];
            if (user) {
                const core = user['core'] || {};
                const legacy = user['legacy'] || {};
                const avatar = user['avatar'] || {};

                return {
                    id: user['rest_id'] || user['id'],
                    unique_id: core['screen_name'],
                    nickname: core['name'],
                    signature: legacy['description'],
                    avatar_thumb: avatar['image_url'] || legacy['profile_image_url_https'],
                    verified: !!(user['verification'] && user['verification']['verified']),
                    verified_type: user['verification'] ? user['verification']['verified_type'] : undefined,
                    follower_count: legacy['followers_count'],
                    following_count: legacy['friends_count']
                };
            }

            const fallback_user = tweet['user'] || null;
            if (!fallback_user) {
                return null;
            }

            return {
                id: fallback_user['id_str'] || fallback_user['id'],
                unique_id: fallback_user['screen_name'],
                nickname: fallback_user['name'],
                signature: fallback_user['description'],
                avatar_thumb: fallback_user['profile_image_url_https'],
                verified: !!fallback_user['verified'],
                follower_count: fallback_user['followers_count'],
                following_count: fallback_user['friends_count']
            };
        };

        const is_comment = function (tweet) {
            const legacy = tweet['legacy'];
            const tweet_id = String(tweet['id']);
            const conversation_id = legacy['conversation_id_str'] ? String(legacy['conversation_id_str']) : null;
            const reply_to_id = legacy['in_reply_to_status_id_str'] ? String(legacy['in_reply_to_status_id_str']) : null;

            if (root_tweet_id) {
                return tweet_id !== root_tweet_id
                    && (conversation_id === root_tweet_id || reply_to_id === root_tweet_id);
            }

            return !!reply_to_id;
        };

        const add_tweet = function (tweet) {
            tweet = normalise_tweet(tweet);
            if (!tweet || !is_comment(tweet)) {
                return;
            }

            const tweet_id = String(tweet['id']);
            if (seen.has(tweet_id)) {
                return;
            }
            seen.add(tweet_id);

            const parent_id = tweet['legacy']['in_reply_to_status_id_str'] || null;
            const post_id = root_tweet_id || tweet['legacy']['conversation_id_str'] || parent_id;
            const author = normalise_user(tweet);

            // Keep the original Twitter/X payload, but expose TikTok-like fields
            // for downstream analysis pipelines that need text, author and post id.
            tweet['comment_id'] = tweet_id;
            tweet['text'] = tweet['legacy']['full_text'] || tweet['legacy']['text'] || '';
            tweet['user'] = author;
            tweet['post_id'] = post_id;
            tweet['post_url'] = post_id ? 'https://x.com/i/web/status/' + post_id : null;
            tweet['parent_comment_id'] = parent_id && parent_id !== post_id ? parent_id : null;
            tweet['thread_id'] = tweet['legacy']['conversation_id_str'] || post_id;
            tweet['_zs_comment_parent_id'] = parent_id || post_id;
            tweet['_zs_comment_thread_id'] = post_id;
            tweet['_zs_comment_post_id'] = post_id;
            comments.push(tweet);
        };

        const add_from_item_content = function (item_content) {
            if (!item_content || !item_content['tweet_results']) {
                return;
            }

            add_tweet(item_content['tweet_results']['result']);
        };

        const traverse = function (obj) {
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
                        if (!entry['content']) {
                            continue;
                        }

                        if ('itemContent' in entry['content']) {
                            add_from_item_content(entry['content']['itemContent']);
                        } else if (entry['content']['content'] && entry['content']['content']['itemContent']) {
                            add_from_item_content(entry['content']['content']['itemContent']);
                        } else if ('__typename' in entry['content'] && entry['content']['__typename'] === 'TimelineTimelineModule') {
                            for (const item of entry['content']['items']) {
                                const item_content = item['item'] && item['item']['itemContent'];
                                if (!item_content || !['Tweet', 'TimelineTweet'].includes(item_content['__typename'])) {
                                    continue;
                                }

                                add_from_item_content(item_content);
                            }
                        } else if (entry['entryId'] && data['globalObjects'] && data['globalObjects']['tweets']) {
                            let tweet_id = null;
                            if (entry['entryId'].indexOf('tweet-') === 0) {
                                tweet_id = entry['entryId'].split('-')[1];
                            } else if (entry['entryId'].indexOf('sq-I-t-') === 0) {
                                tweet_id = entry['entryId'].split('-')[3];
                            }

                            if (tweet_id && data['globalObjects']['tweets'][tweet_id]) {
                                add_tweet({
                                    id: tweet_id,
                                    legacy: data['globalObjects']['tweets'][tweet_id],
                                    user: data['globalObjects']['users']
                                        ? data['globalObjects']['users'][data['globalObjects']['tweets'][tweet_id]['user_id_str']]
                                        : null
                                });
                            }
                        }
                    }
                } else if (typeof (child) === "object") {
                    traverse(child);
                }
            }
        };

        traverse(data);
        return comments;
    },
    'twitter-comments'
);
