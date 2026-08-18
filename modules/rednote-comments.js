zeeschuimer.register_module(
    'RedNote (comments)',
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
            if(item.hasOwnProperty('sub_comment_count')) {
                return item;
            }
        })];

        // if we've found objects, that's all we need, so return without looking further
        if(useable_items.length > 0) {
            return useable_items;
        }

        if (embedded_posts && embedded_posts.length > 0) {
            // if we found any posts this way, return them
            return embedded_posts;
        }

        // no posts, no data
        return [];
    },
    'xiaohongshu-comments'
)