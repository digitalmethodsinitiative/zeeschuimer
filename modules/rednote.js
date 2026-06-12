export const MODULE_NAME = 'Xiaohongshu';
export const DOMAIN = 'xiaohongshu.com';

export function capture(response, source_platform_url, source_url) {
    let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
    if (!domain.endsWith('xiaohongshu.com')) {
        return [];
    }

    // empty request response? nothing to parse, return immediately
    if(!response) {
        return [];
    }

    // we may have multiple objects to read from to look for rednote posts; collect them
    let datas = [];
    try {
        // try to parse the request response as JSON; if it is JSON, add to the array
        datas.push(JSON.parse(response));
    } catch (e) {
        // if not, it's probably HTML, so look for JSON embedded in the HTML
        if(response.indexOf('<script>window.__INITIAL_STATE__')) {
            // this exists on most pages and contains e.g. the first 10 search results for a query
            const initial_state = [...response.matchAll(/<script>window.__INITIAL_STATE__=(.*)<\/script>/g)];
            if(initial_state && initial_state.length > 0) {
                // this is not JSON, but javascript, the important difference is that JSON
                // cannot have 'undefined' as a value, so replace with 'null' (which is allowed)
                const fixed_json = initial_state[0][1].replace(/undefined/g, 'null'); // not great, but works
                try { datas.push(JSON.parse(fixed_json)); } catch (e) {}
            }
        }
    }

    // now filter the collected data for objects that are RedNote post metadata
    let useable_items = [...traverse_data(datas, function(item, property) {
        // items on explore pages fit this heuristic
        if(item.hasOwnProperty('model_type') && item.hasOwnProperty('note_card') && item['model_type'] === 'note') {
            return item;
        }

        // user pages
        if(item.hasOwnProperty('type') && item['type'] === 'video' && item.hasOwnProperty('note_id')) {
            item['id'] = item['note_id'];
            return item;
        }

        // post pages (from embedded JSON)
        if(item.hasOwnProperty('note') && item['note'].hasOwnProperty('interactInfo')) {
            item['id'] = property;
            return item;
        }
    })];

    // if we've found objects, that's all we need, so return without looking further
    if(useable_items.length > 0) {
        return useable_items;
    }

    // if we've not found anything yet, we may be able to get some data from the
    // rendered page
    // make a DOM tree and look for matching elements in it to map to objects
    // this is far less complete than the json objects, but good enough that it might
    // be useful for a researcher
    let embedded_posts = [];
    if (response.indexOf('<!doctype html>') >= 0) {
        const dummyDocument = new DOMParser().parseFromString(response, 'text/html');

        // this is what the first few posts on an overview page look like
        for (const embedded_post of dummyDocument.querySelectorAll(".feeds-container .note-item")) {
            embedded_posts.push({
                'id': embedded_post.querySelector('a').getAttribute('href').replace(/\/$/, '').split('/').pop().split('-').pop(),
                'url': embedded_post.querySelector('a.cover').getAttribute('href'),
                'author_name': embedded_post.querySelector('.author .name').innerText,
                'author_url': embedded_post.querySelector('.author .name').innerText,
                'author_avatar_url': embedded_post.querySelector('.author img').getAttribute('src'),
                'likes': embedded_post.querySelector('span.count').innerText,
                'thumbnail_url': embedded_post.querySelector('.cover img').getAttribute('src'),
                'title': embedded_post.querySelector('.title') ? embedded_post.querySelector('.title').innerText : '',
                '_zs-origin': 'html'
            });
        }

        // this is a post when opened individually
        for (const embedded_post of dummyDocument.querySelectorAll('.note-container')) {
            embedded_posts.push({
                'id': embedded_post.querySelector('a').getAttribute('href').replace(/\/$/, '').split('/').pop().split('-').pop(),
                'url': embedded_post.querySelector('a.cover').getAttribute('href'),
                'author_name': embedded_post.querySelector('.author .name').innerText,
                'author_url': embedded_post.querySelector('.author .name').innerText,
                'author_avatar_url': embedded_post.querySelector('.author img').getAttribute('src'),
                'likes': embedded_post.querySelector('span.count').innerText,
                'thumbnail_url': embedded_post.querySelector('.cover img').getAttribute('src'),
                'title': embedded_post.querySelector('.title') ? embedded_post.querySelector('.title').innerText : '',
                '_zs-origin': 'html'
            });
        }
    }

    if (embedded_posts && embedded_posts.length > 0) {
        // if we found any posts this way, return them
        return embedded_posts;
    }

    // no posts, no data
    return [];
}

// === auto-generated by 4cat map_item sync — BLOCK REPLACED AUTOMATICALLY ===
// (regenerated from datasources/xiaohongshu/search_rednote.py)
function map_item_from_json_api_explore(post) {
    const item = post.type !== 'video' ? post.note_card : post;
    const item_id = post.id ?? post.note_id;

    // Images handling
    let images;
    if (item.image_list) {
        images = [];
        for (const image of item.image_list) {
            if (image.url_default) {
                images.push(image.url_default);
            } else if (image.info_list && image.info_list.length) {
                let found = false;
                for (const imgInfo of image.info_list) {
                    if (imgInfo.image_scene === 'WB_DFT') {
                        images.push(imgInfo.url);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    images.push(image.info_list[0].url);
                }
            }
        }
    } else if (item.cover) {
        images = [item.cover.url_default];
    } else {
        images = new MissingMappedField("");
    }

    const xsec_bit = post.xsec_token ? `?xsec_token=${post.xsec_token}` : "";
    const video_url = item.video?.media ? item.video.media.stream.h264[0].master_url : new MissingMappedField("");
    const author = item.user.nickname ?? item.user.nick_name;
    const timestamp = item.time ?? null;
    const timestampStr = timestamp ? formatUtcTimestamp(timestamp / 1000) : new MissingMappedField("");
    const hashtags = item.desc ? [...item.desc.matchAll(/#([^\s!@#$%^&*()_+{}:"|<>?\[\];',.\/`~]+)/g)].map(m => m[1]).join(",") : new MissingMappedField("");
    const body = item.desc ?? new MissingMappedField("");
    const image_urls = Array.isArray(images) ? images.join(",") : images;
    const likes = item.interact_info?.liked_count ?? null;
    const unix_ts = timestamp ? Math.floor(timestamp / 1000) : new MissingMappedField("");

    return new MappedItem({
        collected_from_url: normalize_url_encoding(post.__import_meta?.source_platform_url ?? ""),
        id: item_id,
        thread_id: item_id,
        url: `https://www.xiaohongshu.com/explore/${post.id}${xsec_bit}`,
        title: item.display_title ?? "",
        body: body,
        hashtags: hashtags,
        timestamp: timestampStr,
        author: author,
        author_avatar_url: item.user.avatar,
        image_urls: image_urls,
        video_url: video_url,
        likes: likes,
        unix_timestamp: unix_ts,
    });
}

function map_item_from_json_embedded(item) {
    const note = item.note;
    const image = note.imageList?.[0]?.urlDefault ?? new MissingMappedField("");
    const xsec_bit = `?xsec_token=${note.xsecToken}`;
    const timestamp = note.time ?? null;
    const timestampStr = timestamp ? formatUtcTimestamp(timestamp / 1000) : new MissingMappedField("");
    const hashtags = note.desc ? [...note.desc.matchAll(/#([^\s!@#$%^&*()_+{}:"|<>?\[\];',.\/`~]+)/g)].map(m => m[1]).join(",") : new MissingMappedField("");
    const body = note.desc ?? new MissingMappedField("");
    const author = note.user.nickname ?? note.user.nick_name;
    const likes = note.interactInfo?.likedCount ??
                  note.interact_info?.liked_count ??
                  note.likes ??
                  new MissingMappedField("");
    const unix_ts = timestamp ? Math.floor(timestamp / 1000) : new MissingMappedField("");

    return new MappedItem({
        collected_from_url: normalize_url_encoding(item.__import_meta?.source_platform_url ?? ""),
        id: item.id,
        thread_id: item.id,
        url: `https://www.xiaohongshu.com/explore/${item.id}${xsec_bit}`,
        title: note.title ?? "",
        body: body,
        hashtags: hashtags,
        timestamp: timestampStr,
        author: author,
        author_avatar_url: note.user.avatar,
        image_url: image,
        video_url: new MissingMappedField(""),
        likes: likes,
        unix_timestamp: unix_ts,
    });
}

function map_item_from_html(item) {
    return new MappedItem({
        collected_from_url: normalize_url_encoding(item.__import_meta?.source_platform_url ?? ""),
        id: item.id,
        thread_id: item.id,
        url: `https://www.xiaohongshu.com${item.url}`,
        title: item.title,
        body: new MissingMappedField(""),
        hashtags: new MissingMappedField(""),
        timestamp: new MissingMappedField(""),
        author: item.author_name,
        author_avatar_url: item.author_avatar_url,
        image_url: item.thumbnail_url,
        video_url: new MissingMappedField(""),
        likes: item.likes,
        unix_timestamp: new MissingMappedField(""),
    });
}

export function map_item(post) {
    // Reject tile stub items – minimal thumbnail entries with no content
    if (!post.note_card && !post.user && post['_zs-origin'] !== 'html' && !post.note) {
        const source = post.__import_meta?.source_url ?? "";
        throw new MapItemException(`Xiaohongshu tile stub without post content (source: ${source || 'unknown'})`);
    }
    if (post['_zs-origin'] === 'html') {
        return map_item_from_html(post);
    } else {
        if (post.note) {
            return map_item_from_json_embedded(post);
        } else {
            return map_item_from_json_api_explore(post);
        }
    }
}
// === end auto-generated ===
