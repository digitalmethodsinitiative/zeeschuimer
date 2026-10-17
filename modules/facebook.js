zeeschuimer.register_module(
    'Facebook (posts)',
    'facebook.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["facebook.com"].includes(domain) || !source_url.endsWith('api/graphql/')) {
            return [];
        }

        let datas = [];
        let edges = [];
        const type_list = ['SOCIAL_POSTS', 'POSTS_SET_FEATURED', 'PUBLIC_POSTS'];

        try {
            datas.push(JSON.parse(response));
        } catch (e) {
            if (response.substring(0, 1) === '{') {
                //ndjson
                const lines = response.split('\n');
                for (const line of lines) {
                    try {
                        datas.push(JSON.parse(line));
                    } catch (e) {
                    }
                }
            }
        }

        const traverse = function (obj) {
            for (const property in obj) {
                if (!obj.hasOwnProperty(property)) {
                    // not actually a property
                    continue;
                }

                if(obj['id'] && obj['__typename'] === 'Story' && obj['comet_sections']) {
                    console.log(obj);
                    edges.push(obj);
                } else if (typeof (obj[property]) === "object") {
                    traverse(obj[property]);
                }
            }
        }


        for (const data of datas) {
            if (data) {
                traverse(data);
            }
        }

        for(const index in edges) {
            try {
                const better_id = atob(edges[index]['id']);
                edges[index]['id'] = better_id;
            } catch (e) {
                // pass
            }
        }
        return edges;
    }
);