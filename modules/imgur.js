zeeschuimer.register_module(
    'Imgur',
    'imgur.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["imgur.com"].includes(domain)) {
            return [];
        }

        let data;
        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }


        if(typeof data !== 'object' || !("posts" in data) || typeof data["posts"] !== 'object') {
            if(typeof data === 'object') {
                // heuristic to determine if objects are actually posts
                let post_objects = data.filter(function(item) {
                    return typeof item === 'object' && 'id' in item && 'account_id' in item && 'point_count' in item;
                });
                if(post_objects.length === data.length) {
                    return post_objects;
                }
            }
            return [];
        }

        return data["posts"];
    }
);