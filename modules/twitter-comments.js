zeeschuimer.register_module(
    'X/Twitter (comments)',
    'x.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["x.com"].includes(domain) || source_url.indexOf('TweetDetail') < 0) {
            return [];
        }

        let data;
        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        const root_tweet_id_match = source_platform_url.match(/\/status\/(\d+)/);
        const root_tweet_id = root_tweet_id_match ? root_tweet_id_match[1] : null;
        let comments = [];

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
            if (!user) {
                return null;
            }

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
                            const item_content = entry['content']['itemContent'];
                            if (!item_content['tweet_results']) {
                                continue;
                            }

                            add_tweet(item_content['tweet_results']['result']);
                        } else if ('__typename' in entry['content'] && entry['content']['__typename'] === 'TimelineTimelineModule') {
                            for (const item of entry['content']['items']) {
                                const item_content = item['item'] && item['item']['itemContent'];
                                if (
                                    !item_content
                                    || !['Tweet', 'TimelineTweet'].includes(item_content['__typename'])
                                    || !item_content['tweet_results']
                                ) {
                                    continue;
                                }

                                add_tweet(item_content['tweet_results']['result']);
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
