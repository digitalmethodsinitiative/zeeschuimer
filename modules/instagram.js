zeeschuimer.register_module(
    'Instagram (Posts)',
    'instagram.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        let endpoint = source_url.split("/").slice(3).join("/").split("?")[0].split("#")[0].replace(/\/$/, '');

        if (!["instagram.com"].includes(domain)) {
            return [];
        }

        /*let whitelisted_endpoints = [
            "graphql/query", //live-loading @ front page
            "api/v1/collections/list",
            "api/v1/feed/user/33646200", //live-loading @ user page
            "api/v1/tags/blessed/sections", //live-loading @ tag explore page
            "api/v1/locations/214262158/sections", //live-loading @ location explore page
            "api/v1/clips/music", //live-loading @ music overview page
        ]

        if(!whitelisted_endpoints.includes(endpoint)) {
            return [];
        }*/

        // determine what part of instagram we're working in
        // 'view' unused for now but may have some bearing on how to parse the data
        // in any case
        let path = source_platform_url.split('?')[0].replace(/\/$/, '').split("/");
        let view = "";
        if (path.length === 3) {
            // www.instagram.com, no sub URL
            view = "frontpage";
        } else if (["direct", "account", "directory", "lite", "legal"].includes(path[3])) {
            // not post listings but misc instagram views/pages
            return [];
        } else if (source_url.indexOf('injected_story_units') >= 0) {
            // injected ads (this URL appears on many ad blocklists!)
            // might enable if we decide to also capture ads? but not clear where these actually show up in the
            // interface...
            return [];
        } else if (path[3] === "explore") {
            // hashtag, location view
            view = "search";
        } else {
            // user pages or similar
            view = "user";
        }

        // instagram sometimes loads content in the background without actually using it
        // maybe pre-caching it or something?
        // this next bit tries to avoid that noise ending up in the data
        if ((source_platform_url.indexOf('reels/audio') >= 0
                || source_platform_url.indexOf('/explore/') >= 0
            )
            && source_url.endsWith('graphql')) {
            // reels audio page f.ex. loads personalised reels in the background (unrelated to the audio) but doesn't
            // seem to actually use them

            return [];
        }


        let datas = [];
        try {
            // if it's JSON already, just parse it
            datas.push(JSON.parse(response));
        } catch {
            // data can be embedded in the HTML in these JavaScript statements
            let js_prefixes = [
                "window._sharedData = {",
                "window.__additionalDataLoaded('feed',{",
                "window.__additionalDataLoaded('feed_v2',{",
                " data-sjs>{",
                "{\"require\":[[\"ScheduledServerJS\",\"handle\",null,[{\"__bbox\":{\"require\":[[\"RelayPrefetchedStreamCache\",\"next\",[],["
            ];

            let prefix;

            while (js_prefixes.length > 0) {
                prefix = js_prefixes.shift();
                if (response.indexOf(prefix) === -1) {
                    // prefix not found
                    continue
                }
                //console.log(`caught ${prefix}`)

                let json_bit = response.split(prefix.slice(0, -1))[1].split('</script>')[0].trim();
                if (json_bit.endsWith(';')) {
                    json_bit = json_bit.substring(0, -1);
                }

                if (prefix.indexOf("additionalDataLoaded") !== -1) {
                    // remove trailing )
                    json_bit = json_bit.slice(0, -1);
                } else if (js_prefixes.length === 0) {
                    // last prefix has some special handling
                    // remove trailing stuff...
                    json_bit = json_bit.split(']]}}')[0];
                }


                try {
                    datas.push(JSON.parse(json_bit));
                } catch {
                    // fine, not JSON after all
                }
            }

            if (datas.length === 0) {
                return [];
            }
        }

        if (datas.length === 1 && 'lightspeed_web_request_for_igd' in datas[0] && source_url.endsWith('graphql')) {
            // this is one of those background requests
            datas = [];
        }

        let possible_item_lists = ["medias", "feed_items", "fill_items"];
        let edges = [];

        // find edge lists in the extracted JSON data
        // these are basically any property with a name as defined above
        // since instagram has all kinds of API responses a generic approach
        // works best
        let traverse = function (obj) {
            for (let property in obj) {
                if (!obj.hasOwnProperty(property)) {
                    // not actually a property
                    continue;
                }

                // pages not covered:
                // - explore (e.g. https://www.instagram.com/explore/)
                //   ❌ as of 2024-feb-20
                // - 'tagged' pages for a user (e.g. https://www.instagram.com/steveo/tagged/)
                //   ❌ as of 2024-feb-20
                // - 'reels' user pages (e.g. https://www.instagram.com/ogata.yoshiyuki/reels/)
                //   ❌ as of 2024-feb-20
                // these do not load enough post metadata (e.g. author or caption), so too different from other items
                // to parse
                // - suggested posts on user feed
                // these could easily be included... may add in the future

                if (possible_item_lists.includes(property) || property === "items") {
                    // - posts on explore pages for specific tags (e.g. https://www.instagram.com/explore/tags/blessed/)
                    // - posts on explore pages for locations (e.g. https://www.instagram.com/explore/locations/238875664/switzerland/)
                    //   ✔️ confirmed working as of 2024-feb-20
                    // - posts on explore pages for sounds (e.g. https://www.instagram.com/reels/audio/290315579897542/)
                    //   ✔️ confirmed working as of 2024-feb-20
                    // - posts when opened by clicking on them
                    //   ✔️ confirmed working as of 2024-feb-20
                    let items;
                    if (property === "medias" || property === "fill_items") {
                        items = obj[property].map(media => media["media"]);
                    } else if (property === "feed_items") {
                        items = obj[property].map(media => media["media_or_ad"]);
                    } else if (property === "items" && obj[property].length === obj[property].filter(i => Object.getOwnPropertyNames(i).join('') === 'media').length) {
                        // - posts on explore pages for sounds (e.g. https://www.instagram.com/reels/audio/290315579897542/)
                        //   ✔️ confirmed working as of 2024-feb-20
                        if(property === 'items' && 'design' in obj) {
                            // this is loaded, but never actually displayed...
                            // seems to be a preview of reels for a given tag, but again, not
                            // actually visible in the interface afaics
                            continue;
                        }
                        items = obj[property].filter(node => "media" in node).map(node => node["media"]).filter(node => {
                            return "id" in node
                        });
                    } else {
                        items = obj[property];
                    }

                    // simple item lists
                    // this could be more robust...
                    if (items) {
                        edges.push(...items.filter(item => {
                            return (
                                item
                                && "id" in item
                                && "media_type" in item
                                && "user" in item
                                && "caption" in item
                                && (!("product_type" in item) || item["product_type"] !== "story")
                                // these next two are ads, which are not actually shown in the feed but still loaded in the
                                // background
                                && (!("product type" in item) || item["product_type"] !== "ad")
                                && (!("link" in item) || !item["link"] || !item["link"].startsWith('https://www.facebook.com/ads/'))
                            );
                        }));
                    }
                } else if (view !== 'user' && ["xdt_api__v1__feed__timeline__connection"].includes(property)) {
                    // - posts in personal feed *that are followed* (i.e. not suggested; e.g. https://instagram.com)
                    //   ✔️ confirmed working 2024-feb-20
                    edges.push(...obj[property]["edges"].filter(edge => "node" in edge).map(edge => edge["node"]).filter(node => {
                        return "media" in node
                            && node["media"] !== null
                            && "id" in node["media"]
                            && "user" in node["media"]
                            && !!node["media"]["user"];
                    }).map(node => node["media"]));
                } else if (["xdt_api__v1__feed__user_timeline_graphql_connection"].includes(property)) {
                    // - posts on user pages (e.g. https://www.instagram.com/ogata.yoshiyuki/)
                    //   ✔️ confirmed working as of 2024-feb-20
                    edges.push(...obj[property]["edges"].filter(edge => "node" in edge).map(edge => edge["node"]).filter(node => {
                        return node !== null
                            && "id" in node
                            && "user" in node
                            && !!node["user"]
                            // these next two are ads, which are not actually shown in the feed but still loaded in the
                            // background
                            && (!("product type" in node ) || node["product_type"] !== "ad")
                            && (!("ad_action" in node) || node["ad_action"] === null)
                            && (!("link" in node) || !node["link"] || !node["link"].startsWith('https://www.facebook.com/ads/'))
                    }));
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

        return edges;
    }
);