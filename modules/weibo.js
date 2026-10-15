export const MODULE_NAME = 'Weibo';
export const DOMAIN = 'weibo.com';
export const TOOLTIP = 'Weibo shortens long posts in feeds and lists. Open a post\'s own page to collect its full ' +
    'text. With "Skip duplicates" or "Update existing" selected, the full post then replaces the shortened one; with ' +
    '"Keep duplicates", both are kept.';

/**
 * Collect Weibo posts from weibo.com
 *
 * The desktop site loads everything as JSON from its own API; the page HTML
 * is an empty shell. Posts have the same format wherever they appear: the hot
 * feed and hot lists (/ajax/feed/hottimeline), a post's own page
 * (/ajax/statuses/show), the video tab of a profile
 * (/ajax/profile/getWaterFallContent) and super-topic pages
 * (/ajax_proxy/chaohua/page). A repost carries the post it reposts in
 * `retweeted_status`, which stays part of the repost.
 *
 * @param {string} response  Content of the captured response
 * @param {string} source_platform_url  URL of the page the user is on
 * @param {string} source_url  URL of the captured response
 * @returns {Array}  Weibo posts
 */
export function capture(response, source_platform_url, source_url) {
    const domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
    if (!domain.endsWith('weibo.com')) {
        return [];
    }

    if (!response) {
        return [];
    }

    let data;
    try {
        data = JSON.parse(response);
    } catch (e) {
        return [];
    }

    // traverse_data skips the object it is given; on a post's own page, that
    // object is the post
    return traverse_data([data], function (item) {
        if (is_post(item)) {
            return item;
        }
    });
}

/**
 * Decide whether a newly captured copy of a post replaces the stored one
 *
 * A complete copy replaces a shortened one, and a shortened copy never
 * replaces a complete one. For any other pair this returns null, which
 * Zeeschuimer handles as it would for a module without this function; false
 * would also stop "Update existing" from refreshing a stored post's counts.
 *
 * @param {Object} incoming_item  Post as just captured
 * @param {Object} existing_item  Stored record, with the post in `data`
 * @returns {boolean|null}
 */
export function overwrite_partial(incoming_item, existing_item) {
    if (!existing_item || !existing_item.data) {
        return null;
    }

    const existing_is_short = has_shortened_text(existing_item.data);
    const incoming_is_short = has_shortened_text(incoming_item);

    if (existing_is_short && !incoming_is_short) {
        return true;
    }

    if (!existing_is_short && incoming_is_short) {
        return false;
    }

    return null;
}

/**
 * Whether an object is a Weibo post
 *
 * Posts have a short ID used in their URL (`mblogid`), an author and a
 * creation date. Comments, users and trending search terms do not have all
 * three.
 *
 * @param {*} item
 * @returns {boolean}
 */
function is_post(item) {
    return typeof item === 'object'
        && typeof item.mblogid === 'string'
        && typeof item.user === 'object' && item.user !== null
        && typeof item.created_at === 'string';
}

/**
 * Whether a post's text, or that of the post it reposts, is cut short
 *
 * Feeds and lists send only the start of a long post and set `isLongText`.
 * A post's own page sends the full text as well, in `longText`.
 *
 * @param {Object} post
 * @returns {boolean}
 */
function has_shortened_text(post) {
    return is_shortened(post) || (!!post.retweeted_status && is_shortened(post.retweeted_status));
}

function is_shortened(post) {
    return post.isLongText === true && !post.longText;
}

/**
 * Map a Weibo post to a flat item
 *
 * There is no Weibo data source in 4CAT yet; this is the mapping to port to
 * it, and until then it is what Zeeschuimer's own CSV export uses.
 *
 * @param {Object} post  Post as captured, with `__import_meta`
 * @returns {MappedItem}
 */
export function map_item(post) {
    if (!is_post(post)) {
        const source = post.__import_meta?.source_url ?? "";
        throw new MapItemException(`Not a Weibo post (source: ${source || 'unknown'})`);
    }

    const user = post.user;
    const reposted = post.retweeted_status ?? null;
    const unix_timestamp = weibo_unix_timestamp(post.created_at);

    return new MappedItem({
        collected_from_url: normalize_url_encoding(post.__import_meta?.source_platform_url ?? ""),
        id: post.idstr,
        thread_id: post.idstr,
        url: `https://weibo.com/${user.idstr}/${post.mblogid}`,
        body: post_text(post),
        body_is_shortened: is_shortened(post) ? "yes" : "no",
        timestamp: unix_timestamp !== null ? formatUtcTimestamp(unix_timestamp) : new MissingMappedField(""),
        unix_timestamp: unix_timestamp ?? new MissingMappedField(""),
        author: user.screen_name,
        author_id: user.idstr,
        author_avatar_url: user.avatar_hd ?? user.profile_image_url ?? "",
        author_verified: user.verified ? "yes" : "no",
        author_followers: value_or_missing(user, 'followers_count', ""),
        likes: post.attitudes_count,
        comments: post.comments_count,
        reposts: post.reposts_count,
        hashtags: hashtags(post).join(","),
        image_urls: image_urls(post).join(","),
        video_url: video_url(post),
        location: post.region_name ? post.region_name.replace(/^发布于\s*/, '') : new MissingMappedField(""),
        posted_with: post.source ? strip_tags(post.source) : "",
        is_promoted: post.isAd ? "yes" : "no",
        is_repost: reposted ? "yes" : "no",
        reposted_id: reposted ? reposted.idstr : "",
        reposted_url: reposted && reposted.user ? `https://weibo.com/${reposted.user.idstr}/${reposted.mblogid}` : "",
        reposted_author: reposted && reposted.user ? reposted.user.screen_name : "",
        reposted_body: reposted ? post_text(reposted) : "",
        reposted_body_is_shortened: reposted && is_shortened(reposted) ? "yes" : "no",
    });
}

/**
 * A post's text, in full when it was captured in full
 *
 * `text_raw` is plain text, `text` the same with HTML links. Super-topic
 * pages send only `text`.
 *
 * @param {Object} post
 * @returns {string}
 */
function post_text(post) {
    if (post.longText && post.longText.content) {
        return post.longText.content;
    }

    if (typeof post.text_raw === 'string') {
        return post.text_raw;
    }

    return strip_tags(post.text ?? "");
}

/**
 * Hashtags in a post, without the # on either side
 *
 * Weibo hashtags are enclosed in #, as in #广交会#. `topic_struct` lists
 * them when present.
 *
 * @param {Object} post
 * @returns {string[]}
 */
function hashtags(post) {
    if (Array.isArray(post.topic_struct) && post.topic_struct.length > 0) {
        return post.topic_struct.map(topic => topic.topic_title).filter(Boolean);
    }

    return [...post_text(post).matchAll(/#([^#\n]+)#/g)].map(match => match[1]);
}

/**
 * Full-size image URLs, in the order the post shows them
 *
 * Images are in `pic_infos`, keyed by the IDs in `pic_ids`; posts that mix
 * images and videos have them in `mix_media_info` instead.
 *
 * @param {Object} post
 * @returns {string[]}
 */
function image_urls(post) {
    const pictures = [];
    for (const pic_id of post.pic_ids ?? []) {
        if (post.pic_infos && post.pic_infos[pic_id]) {
            pictures.push(post.pic_infos[pic_id]);
        }
    }

    for (const media of post.mix_media_info?.items ?? []) {
        if (media.type === 'pic' && media.data) {
            pictures.push(media.data);
        }
    }

    const urls = pictures
        .map(picture => picture.largest?.url ?? picture.original?.url ?? picture.large?.url)
        .filter(Boolean);
    return [...new Set(urls)];
}

/**
 * URL of a post's video, if it has one
 *
 * @param {Object} post
 * @returns {string}
 */
function video_url(post) {
    const pages = [post.page_info];
    for (const media of post.mix_media_info?.items ?? []) {
        if (media.type === 'video') {
            pages.push(media.data);
        }
    }

    for (const page of pages) {
        const media_info = page?.object_type === 'video' ? page.media_info : null;
        if (media_info) {
            const url = media_info.mp4_720p_mp4 || media_info.mp4_hd_url || media_info.stream_url_hd
                || media_info.stream_url;
            if (url) {
                return url;
            }
        }
    }

    return "";
}

/**
 * Convert a Weibo date to a UNIX timestamp
 *
 * Weibo dates look like "Thu Oct 15 10:22:13 +0800 2026".
 *
 * @param {string} created_at
 * @returns {number|null}  Seconds since the epoch, or null if not a Weibo date
 */
function weibo_unix_timestamp(created_at) {
    const parts = /^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/.exec(created_at ?? "");
    if (!parts) {
        return null;
    }

    const [, month, day, hours, minutes, seconds, sign, offset_hours, offset_minutes, year] = parts;
    const month_index = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month);
    if (month_index < 0) {
        return null;
    }

    const as_if_utc = Date.UTC(+year, month_index, +day, +hours, +minutes, +seconds) / 1000;
    const offset = (sign === '-' ? -1 : 1) * (+offset_hours * 3600 + +offset_minutes * 60);
    return as_if_utc - offset;
}
