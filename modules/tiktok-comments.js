zeeschuimer.register_module(
    'TikTok (comments)',
    "tiktok.com",
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["tiktok.com"].includes(domain)) {
            return [];
        }

        let data;
        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }



        if ('comments' in data) {
            return data['comments'].filter(function (item) {
                // simple heuristic to identify comment objects
                return typeof item === 'object' && 'cid' in item && 'aweme_id' in item;
            }).map(item => {
                item["id"] = item["cid"]; // no 'id' field by default
                return item;
            });
        }

        return [];
    },
    'tiktok-comments'
);