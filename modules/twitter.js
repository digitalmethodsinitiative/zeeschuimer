zeeschuimer.register_module(
    'Twitter',
    'twitter.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (
            !["twitter.com"].includes(domain)
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

        // we want to process tweets under multiple conditions so factor that out into a simple function
        // so we can call it when we need it, rather than duplicating the code
        let process = function (tweet, promoted = false, related = false) {
            if(!tweet || tweet['__typename'] === 'TweetUnavailable') {
                // this sometimes happens
                // no other data in the object, so just skip
                return;
            }

            if('tweet' in tweet) {
                // sometimes this is nested once more, for some reason
                tweet = tweet['tweet'];
            }
            tweet['id'] = tweet['legacy']['id_str'];
            tweet['promoted'] = promoted;
            tweet['related'] = related;
            tweets.push(tweet);
        }

        // find 'entries' in the API response
        // Twitter JSON objects are RPC-like objects that are interpreted
        // One of the 'instructions' is to add entries to the timeline, this is what we are interested in because what
        // is added to the timeline are the tweets!
        // So find those instructions in the object, and reconstruct the tweets from there
        let traverse = function (obj) {
            for (let property in obj) {
                let child = obj[property];
                if(!child) {
                    continue;
                }
                if(
                    (
                        (child.hasOwnProperty('type') && child['type'] === 'TimelineAddEntries')
                        || (!child.hasOwnProperty('type') && Object.keys(child).length === 1)
                    )
                    && child.hasOwnProperty('entries')
                ) {
                    for (let entry in child['entries']) {
                        entry = child['entries'][entry];
                        if('itemContent' in entry['content'] && entry['content']['itemContent']['itemType'] !== 'TimelineTimelineCursor') {
                            process(entry['content']['itemContent']['tweet_results']['result'],
                                ('promotedMetadata' in entry['content']['itemContent']),
                                (entry['entryId'].indexOf('relatedtweets') >= 0));

                        } else if ('items' in entry['content']) {
                            for (let item in entry['content']['items']) {
                                let entry_id = entry['content']['items'][item]['entryId'];
								item = entry['content']['items'][item]['item'];
								if('itemContent' in item && 'tweet_results' in item['itemContent']) {
				                    process(item['itemContent']['tweet_results']['result'],
				                    ('promotedMetadata' in item['itemContent']),
				                    (entry_id.indexOf('relatedtweets') >= 0));
								}
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
                                type: 'adaptive',
                                promoted: false,
                                related: false
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
);
