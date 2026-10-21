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

        // user pages and saved-post boards; require 'user' to skip the previews
        // of someone's posts shown when hovering over their name
        // (user/hover_card), which have the same keys but no author or content
        if(item.hasOwnProperty('type') && item['type'] === 'video' && item.hasOwnProperty('note_id') && item.hasOwnProperty('user')) {
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
export function map_item(post) {
    // Reject tile stub items
    if (!('note_card' in post) && !('user' in post) && py_get(post, '_zs-origin') !== 'html' && !('note' in post)) {
        const source = py_get(py_get(post, '__import_meta', {}), 'source_url', '');
        throw new MapItemException(`Xiaohongshu tile stub without post content (source: ${source || 'unknown'})`);
    }

    if (py_get(post, '_zs-origin') === 'html') {
        return map_item_from_html(post);
    } else if ('note' in post) {
        return map_item_from_json_embedded(post);
    } else {
        return map_item_from_json_api_explore(post);
    }
}

function map_item_from_json_api_explore(post) {
    const item = py_get(post, 'type') !== 'video' ? py_get(post, 'note_card') : post;
    const item_id = py_get(post, 'id', py_get(post, 'note_id'));

    // Images handling
    let images;
    if (item && Array.isArray(item.image_list) && item.image_list.length) {
        images = [];
        for (const image of item.image_list) {
            if ('url_default' in image && image.url_default) {
                images.push(image.url_default);
            } else if ('info_list' in image && image.info_list) {
                let found = false;
                for (const imgInfo of image.info_list) {
                    if (imgInfo.image_scene === 'WB_DFT') {
                        images.push(imgInfo.url);
                        found = true;
                        break;
                    }
                }
                if (!found && image.info_list.length) {
                    images.push(image.info_list[0].url);
                }
            }
        }
    } else if (item && item.cover) {
        images = [item.cover.url_default];
    } else {
        images = new MissingMappedField("");
    }

    const xsec_bit = py_get(post, 'xsec_token') ? `?xsec_token=${post.xsec_token}` : "";
    let video_url;
    if (item && item.video && item.video.media) {
        video_url = getVideoUrl(item.video.media.stream || {});
    } else {
        video_url = new MissingMappedField("");
    }

    const author = (item.user.nickname !== undefined) ? item.user.nickname : item.user.nick_name;
    const timestamp = py_get(item, 'time');

    const hashtags = ('desc' in item)
        ? [...item.desc.matchAll(/#([^\s!@#$%^&*()_+{}:"|<>?\[\];',.\/`~]+)/g)].map(m => m[1]).join(',')
        : new MissingMappedField("");

    const body = ('desc' in item) ? item.desc : new MissingMappedField("");

    const collected_from_url = readable_url(py_get(py_get(post, '__import_meta', {}), 'source_platform_url', ''));

    return new MappedItem({
        collected_from_url,
        id: item_id,
        thread_id: item_id,
        url: `https://www.xiaohongshu.com/explore/${post.id}${xsec_bit}`,
        title: py_get(item, 'display_title', ''),
        body,
        hashtags,
        timestamp: timestamp ? formatUtcTimestamp(timestamp / 1000) : new MissingMappedField("") ,
        author,
        author_avatar_url: item.user.avatar,
        image_urls: Array.isArray(images) ? images.join(',') : images,
        video_url,
        likes: item.interact_info.liked_count,
        unix_timestamp: timestamp ? Math.floor(timestamp / 1000) : new MissingMappedField("")
    });
}

function getVideoUrl(streams) {
    const h264 = ['h264', 'EF4'];
    const formats = [...h264, ...Object.keys(streams).filter(k => !h264.includes(k))];
    for (const name of formats) {
        const list = streams[name] || [];
        for (const stream of list) {
            if (stream.master_url) {
                return stream.master_url;
            }
        }
    }
    return new MissingMappedField("");
}

function map_item_from_json_embedded(item) {
    const note = item.note;
    const image = note.imageList[0].urlDefault;
    const xsec_bit = `?xsec_token=${note.xsecToken}`;
    const timestamp = py_get(note, 'time');

    let likes;
    if ('interactInfo' in note) {
        likes = note.interactInfo.likedCount;
    } else if ('interact_info' in note) {
        likes = note.interact_info.liked_count;
    } else if ('likes' in note) {
        likes = note.likes;
    } else {
        likes = new MissingMappedField("");
    }

    const author = (note.user.nickname !== undefined) ? note.user.nickname : note.user.nick_name;
    const hashtags = ('desc' in note)
        ? [...note.desc.matchAll(/#([^\s!@#$%^&*()_+{}:"|<>?\[\];',.\/`~]+)/g)].map(m => m[1]).join(',')
        : new MissingMappedField("");
    const body = ('desc' in note) ? note.desc : new MissingMappedField("");

    const collected_from_url = readable_url(py_get(py_get(item, '__import_meta', {}), 'source_platform_url', ''));

    return new MappedItem({
        collected_from_url,
        id: item.id,
        thread_id: item.id,
        url: `https://www.xiaohongshu.com/explore/${item.id}${xsec_bit}`,
        title: py_get(note, 'title', ''),
        body,
        hashtags,
        timestamp: timestamp ? formatUtcTimestamp(timestamp / 1000) : new MissingMappedField("") ,
        author,
        author_avatar_url: note.user.avatar,
        image_url: image,
        video_url: new MissingMappedField("") ,
        likes,
        unix_timestamp: timestamp ? Math.floor(timestamp / 1000) : new MissingMappedField("")
    });
}

function map_item_from_html(item) {
    const collected_from_url = readable_url(py_get(py_get(item, '__import_meta', {}), 'source_platform_url', ''));
    return new MappedItem({
        collected_from_url,
        id: item.id,
        thread_id: item.id,
        url: `https://www.xiaohongshu.com${item.url}`,
        title: item.title,
        body: new MissingMappedField("") ,
        hashtags: new MissingMappedField("") ,
        timestamp: new MissingMappedField("") ,
        author: item.author_name,
        author_avatar_url: item.author_avatar_url,
        image_url: item.thumbnail_url,
        video_url: new MissingMappedField("") ,
        likes: item.likes,
        unix_timestamp: new MissingMappedField("")
    });
}
// === end auto-generated ===
