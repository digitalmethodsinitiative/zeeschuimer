zeeschuimer.register_module(
    'Threads',
    'threads.net',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (
            !["threads.net"].includes(domain)
            || (
                // these are known API endpoints used to fetch posts for the interface
                source_url.indexOf('/api/graphql') < 0
            )
        ) {
            return [];
        }

        let data;
        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        let posts = [];
        let traverse = function (obj) {
            for (let property in obj) {
                let child = obj[property];
                if(!child) {
                    continue;
                }
                if(child.hasOwnProperty('thread_items') && child['thread_items']) {
                    child['thread_items'].forEach((item) => {
                        item['id'] = item['post']['id'];
                        posts.push(item)
                    });
                } else if (typeof (child) === "object") {
                    traverse(child);
                }
            }
        }

        traverse(data);
        return posts;
    }
);