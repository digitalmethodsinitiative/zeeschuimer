zeeschuimer.register_module(
    'instagram.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        if (!["instagram.com"].includes(domain)) {
            return [];
        }

        // determine what part of instagram we're working in
        let path = source_platform_url.split("/");
        let view = "";
        if(path.length === 3) {
            view = "frontpage";
        } else if(["direct", "account", "directory", "lite", "legal"].includes(path[3])) {
            // not post listings
            return [];
        } else if(path[3] === "explore") {
            // hashtag, location view
            view = "search";
        } else {
            view = "user";
        }


        let data;
        try {
            // if it's JSON already, just parse it
            data = JSON.parse(response);
        } catch (SyntaxError) {
            // data can be embedded in the HTML in either of these two JavaScript statements
            // if the second is present, it overrides the first
            let js_prefixes = ["window._sharedData = {", "window.__additionalDataLoaded('feed',{"];
            let prefix;

            while(js_prefixes.length > 0) {
                prefix = js_prefixes.shift();
                if (response.indexOf(prefix) === -1) {
                    continue
                }

                let json_bit = response.split(prefix.slice(0, -1))[1].split(';</script>')[0];
                if(prefix.indexOf("additionalDataLoaded") !== -1) {
                    // remove trailing )
                    json_bit = json_bit.slice(0, -1);
                }
                try {
                    data = JSON.parse(json_bit);
                } catch (SyntaxError) {
                }

                // we go through all prefixes even if we already found one,
                // because one overrides the other
            }

            if(!data) {
                return [];
            }
        }

        let possible_edges = ["edge_owner_to_timeline_media", "edge_web_feed_timeline"];
        let edges = [];

        // find edge lists in the extracted JSON data
        // these are basically any property with a name as defined above in
        // possible_edges - since instagram has all kinds of API responses
        // a generic approach works best
        let traverse = function(obj) {
            for(let property in obj) {
                if(!obj.hasOwnProperty(property)) {
                    continue;
                }

                if(possible_edges.includes(property) && "edges" in obj[property]) {
                    // edge lists
                    // traverse data and filter for object types we can process in 4CAT
                    edges.push(...obj[property]["edges"].filter(edge => "node" in edge).map(edge => edge["node"]).filter(node => {
                        return (
                            "id" in node
                            && "__typename" in node
                            && ["GraphVideo", "GraphImage", "GraphSidecar"].includes(node["__typename"])
                        );
                    }));
                } else if(property === "items") {
                    // simple item lists
                    // this could be more robust...
                    edges.push(...obj[property].filter(item => {
                        return (
                            "media_type" in item
                            && "user" in item
                            && "caption" in item
                            && (!("product_type" in item) || item["product_type"] !== "story")
                        );
                    }));
                } else if(typeof(obj[property]) === "object") {
                    traverse(obj[property]);
                }
            }
        }

        traverse(data);

        if(edges.length > 0) {
            console.log('Found ' + edges.length + ' items via ' + source_url);
        } else {
        }
        return edges;
    }
);