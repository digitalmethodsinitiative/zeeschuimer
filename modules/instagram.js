zeeschuimer.register_module(
    'Instagram (posts)',
    'instagram.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["instagram.com"].includes(domain)) {
            return [];
        }

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
            // console.log('ignoring misc url ' + source_url);
            return [];
        } else if (source_url.indexOf('injected_story_units') >= 0) {
            // injected ads (this URL appears on many ad blocklists!)
            // might enable if we decide to also capture ads? but not clear where these actually show up in the
            // interface...
            // console.log('ignoring ads from ' + source_url);
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
            && (source_url.endsWith('graphql') || source_url.endsWith('graphql/query'))) {
            // reels audio page f.ex. loads personalised reels in the background (unrelated to the audio) but doesn't
            // seem to actually use them)

            // console.log('ignoring pre-cache ' + source_url);
            return [];
        }

        let datas = [];
        try {
            // if it's JSON already, just parse it
            datas.push(JSON.parse(response));
        } catch {
            // data can be embedded in the HTML in these JavaScript statements
            // this is mostly used for:
            // - single post pages (e.g. https://www.instagram.com/p/C1hWCZLPQ9T/)
            //   ✔️ confirmed working as of 2024-aug-21

            let js_prefixes = [
                "{\"require\":[[\"ScheduledServerJS\",\"handle\",null,[{\"__bbox\":{\"require\":[[\"RelayPrefetchedStreamCache\",\"next\",[],["
            ];

            let prefix;
            const dummyDocument = document.implementation.createDocument(null, '', null);

            while (js_prefixes.length > 0) {
                prefix = js_prefixes.shift();

                // we go through the response line by line, because prefixes may
                // occur multiple times but always on a single line
                for (const line of response.split("\n")) {
                    if (line.indexOf(prefix) === -1) {
                        // prefix not found
                        continue;
                    }

                    let json_bit = line.split(prefix.slice(0, -1))[1].split('</script>')[0].trim();
                    if (json_bit.endsWith(';')) {
                        json_bit = json_bit.substring(0, -1);
                    }

                    if (json_bit.indexOf('adp_PolarisDesktopPostPageRelatedMediaGrid') >= 0) {
                        // 'related posts', this is never what we are looking for
                        continue;
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
            }

            if (datas.length === 0) {
                // console.log('no datas for ' + source_url);
                return [];
            }
        }

        if (datas.length === 1 && 'lightspeed_web_request_for_igd' in datas[0] && source_url.endsWith('graphql')) {
            // this is one of those background requests
            // console.log('ignoring background request ' + source_url);
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
                //   ❌ as of 2024-aug-21
                // - 'tagged' pages for a user (e.g. https://www.instagram.com/steveo/tagged/)
                //   ❌ as of 2024-aug-21
                // - 'reels' user pages (e.g. https://www.instagram.com/ogata.yoshiyuki/reels/)
                //   ❌ as of 2024-aug-21
                // these do not load enough post metadata (e.g. author or caption), so too different from other items
                // to parse
                // - suggested posts on user feed
                // these could easily be included... may add in the future

                if (possible_item_lists.includes(property) || property === "items") {
                    // - posts on explore pages for specific tags (e.g. https://www.instagram.com/explore/tags/blessed/)
                    // - posts on explore pages for locations (e.g. https://www.instagram.com/explore/locations/238875664/switzerland/)
                    //   ✔️ confirmed working as of 2024-aug-21
                    // - posts on explore pages for sounds (e.g. https://www.instagram.com/reels/audio/290315579897542/)
                    //   ✔️ confirmed working as of 2024-aug-21
                    // - posts when opened by clicking on them
                    //   ✔️ confirmed working as of 2024-aug-21
                    let items;
                    if (property === "medias" || property === "fill_items") {
                        items = obj[property].map(media => media["media"]);
                    } else if (property === "feed_items") {
                        items = obj[property].map(media => media["media_or_ad"]);
                    } else if (property === "items" && obj[property].length === obj[property].filter(i => Object.getOwnPropertyNames(i).join('') === 'media').length) {
                        // - posts on explore pages for sounds (e.g. https://www.instagram.com/reels/audio/290315579897542/)
                        //   ✔️ confirmed working as of 2024-aug-21
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
                    edges.push(...obj[property]["edges"].filter(edge => "node" in edge).map(edge => edge["node"]).map(edge => {
                        // this ensures suggested posts are also included
                        if(edge['media'] === null && edge['explore_story'] && edge['explore_story']['media']) {
                            return edge['explore_story'];
                        } else {
                            return edge;
                        }
                    }).filter(node => {
                        return "media" in node
                            && node["media"] !== null
                            && "id" in node["media"]
                            && "user" in node["media"]
                            && !!node["media"]["user"]
                    }).map(node => node["media"]));
                } else if (["xdt_api__v1__feed__user_timeline_graphql_connection"].includes(property)) {
                    // - posts on user pages (e.g. https://www.instagram.com/ogata.yoshiyuki/)
                    //   ✔️ confirmed working as of 2024-aug-21
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

        // console.log('got ' + edges.length + ' via ' + source_url)
        // generic ad filter...
        return edges.filter(edge => edge["product_type"] !== "ad");
    }
);