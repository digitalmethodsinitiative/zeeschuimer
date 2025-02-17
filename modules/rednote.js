zeeschuimer.register_module(
    'RedNote/Xiaohongshu',
    "xiaohongshu.com",
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        if (!domain.endsWith('xiaohongshu.com')) {
            return [];
        }

        /**
         * Some data is embedded in the page rather than loaded asynchronously.
         * This here extracts it!
         */
        if(!response) {
            return [];
        }

        let datas = [];
        try {
            datas.push(JSON.parse(response));
        } catch (e) {
            // JSON, but in the HTML source doee
            if(response.indexOf('<script>window.__INITIAL_STATE__')) {
                const initial_state = [...response.matchAll(/<script>window.__INITIAL_STATE__=(.*)<\/script>/g)];
                if(initial_state && initial_state.length > 0) {
                    const fixed_json = initial_state[0][1].replace(/undefined/g, 'null'); // not great, but works
                    try { datas.push(JSON.parse(fixed_json)); } catch (e) {}
                }
            }
        }

        let useable_items = [...traverse_data(datas, function(item, property) {
            // explore pages
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

        if(useable_items.length > 0) {
            return useable_items;
        }


        // now extract some stuff from the HTML by making a DOM tree and pulling from it
        // this is far less complete than the json objects, but good enough that it might
        // be useful for a researcher
        let embedded_posts = [];
        if (response.indexOf('<!doctype html>') >= 0) {
            const dummyDocument = new DOMParser().parseFromString(response, 'text/html');
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
            // if there were embedded posts, there will not be any JSON-based posts, so return immediately
            return embedded_posts;
        }

        return [];
    }
)