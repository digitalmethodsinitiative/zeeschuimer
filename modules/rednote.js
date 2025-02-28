zeeschuimer.register_module(
    'RedNote/Xiaohongshu',
    "xiaohongshu.com",
    function (response, source_platform_url, source_url) {
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
                const date_and_location = embedded_post.querySelector('.date') ? embedded_post.querySelector('.title').innerText : '';
                const { date_time, location } = parseDateAndLocation(date_and_location);

                embedded_posts.push({
                    'id': embedded_post.querySelector('a').getAttribute('href').replace(/\/$/, '').split('/').pop().split('-').pop(),
                    'url': embedded_post.querySelector('a.cover').getAttribute('href'),
                    'author_name': embedded_post.querySelector('.author .name').innerText,
                    'author_url': embedded_post.querySelector('.author .name').innerText,
                    'author_avatar_url': embedded_post.querySelector('.author img').getAttribute('src'),
                    'likes': embedded_post.querySelector('span.count').innerText,
                    'thumbnail_url': embedded_post.querySelector('.cover img').getAttribute('src'),
                    'title': embedded_post.querySelector('.title') ? embedded_post.querySelector('.title').innerText : '',
                    'date_time': date_time,
                    'location': location,
                    '_zs-origin': 'html'
                });
            }
        }

        if (embedded_posts && embedded_posts.length > 0) {
            // if we found any posts this way, return them
            return embedded_posts;
        }

        function parseString(str) {
            const parts = str.split(' ');
            const now = new Date();
            const currentYear = now.getFullYear();
            
            let normalizedDateTime;
            let location = null;
            
            if (parts.length === 1) {
              const dateStr = parts[0];
              const [month, day] = dateStr.split('-').map(num => parseInt(num, 10));
              const date = new Date(currentYear, month - 1, day, 0, 0, 0, 0);
              normalizedDateTime = date.toISOString();
            } 
            else if (parts.length === 2) {
              if (parts[0] === '今天') {
                const timeStr = parts[1];
                const [hours, minutes] = timeStr.split(':');
                const date = new Date();
                date.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
                normalizedDateTime = date.toISOString();
              } 
              else if (parts[0] === '昨天') {
                const timeStr = parts[1];
                const [hours, minutes] = timeStr.split(':');
                const date = new Date();
                date.setDate(date.getDate() - 1);
                date.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
                normalizedDateTime = date.toISOString();
              }
              else {
                const dateStr = parts[0];
                const [month, day] = dateStr.split('-').map(num => parseInt(num, 10));
                const date = new Date(currentYear, month - 1, day, 0, 0, 0, 0);
                normalizedDateTime = date.toISOString();
                location = parts[1];
              }
            }
            else if (parts.length === 3) {
              location = parts[2];
              
              if (parts[0] === '今天') {
                const timeStr = parts[1];
                const [hours, minutes] = timeStr.split(':');
                const date = new Date();
                date.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
                normalizedDateTime = date.toISOString();
              } 
              else if (parts[0] === '昨天') {
                const timeStr = parts[1];
                const [hours, minutes] = timeStr.split(':');
                const date = new Date();
                date.setDate(date.getDate() - 1);
                date.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
                normalizedDateTime = date.toISOString();
              }
            }
            
            return {
              date_time: normalizedDateTime,
              location: location
            };
          }

        // no posts, no data
        return [];
    }
)