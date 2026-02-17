// Helper to extract embedded Instagram JSON data from HTML responses
function extractEmbeddedInstagramJSON(response) {
    const datas = [];

    let js_prefixes = [
        "{\"require\":[[\"ScheduledServerJS\",\"handle\",null,[{\"__bbox\":{\"require\":[[\"RelayPrefetchedStreamCache\",\"next\",[],[",
        // Explorer embedded JSON has a different prefix
        "{\"require\":[[\"ScheduledServerJS\",\"handle\",null,[{\"__bbox\":{\"require\":[[\"PolarisQueryPreloaderCache\",\"add\",[],["
    ];

    let prefix;
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
                json_bit = json_bit.substring(0, json_bit.length - 1);
            }

            if (json_bit.indexOf('adp_PolarisDesktopPostPageRelatedMediaGrid') >= 0) {
                // 'related posts', this is never what we are looking for
                continue;
            }

            if (prefix.indexOf("additionalDataLoaded") !== -1) {
                // remove trailing )
                json_bit = json_bit.slice(0, -1);
            } else if (js_prefixes.length === 0) {
                // last prefix has some special handling in upstream code
                json_bit = json_bit.split(']]}}')[0];
            }

            json_bit = json_bit.split('],["CometResourceScheduler"')[0];

            try {
                extracted_json = JSON.parse(json_bit);
                // Explorer embedded JSON is wrapped differently
                function _traverse_parsed_json(obj) {
                    for (let property in obj) {
                        if (!obj.hasOwnProperty(property)) {
                            // not actually a property
                            continue;
                        }
                        if (property === "result" && "response" in obj[property]) {
                            try {
                                return JSON.parse(obj[property]["response"]);
                            } catch (e) {
                                console.log('Instagram JSON parse error in explorer wrapper');
                                console.log(obj[property]["response"]);
                            }
                        } else if (typeof (obj[property]) === "object") {
                            const res = _traverse_parsed_json(obj[property]);
                            if (res !== null) return res;
                        } else {
                            // not an object, can't contain the explorer JSON
                            continue;
                        }
                    }
                    return null;
                }
                const explorer_json = _traverse_parsed_json(extracted_json);
                if (explorer_json !== null) {
                    datas.push(explorer_json);
                } else {
                    datas.push(JSON.parse(json_bit));
                }
            } catch (e) {
                console.log('Instagram JSON parse error');
                console.log(json_bit);
            }
        }
    }

    return datas;
};

zeeschuimer.register_module(
    'Instagram (posts & reels)',
    'instagram.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["instagram.com"].includes(domain)) {
            return [];
        }
        
        const debug_logs = false;

        // determine what part of instagram we're working in
        const path = new URL(source_platform_url).pathname.split('/').filter(Boolean);
        const source_url_path = new URL(source_url).pathname.split('/').filter(Boolean);
        let view = "";
        if (["logging_client_events"].includes(source_url_path[0])) {
            // background requests for logging
            if (debug_logs) console.log('ignoring background request ' + source_url);
            return [];
        } else if (path.length === 0) {
            /// www.instagram.com, no sub URL
            view = "frontpage";
        } else if (["direct", "account", "directory", "lite", "legal" ].includes(path[0])) {
            // not post listings but misc instagram views/pages
            // direct = messages; could be interesting in some cases (e.g. researcher sending themselves specific reels)
            if (debug_logs) console.log('ignoring misc url ' + source_url);
            return [];
        } else if (["static_resources"].includes(path[0])) {
            // static resources (e.g. for the web interface), not actual content
            if (debug_logs) console.log('ignoring static resource ' + source_url);
            return [];
        } else if (source_url.indexOf('injected_story_units') >= 0) {
            // injected ads (this URL appears on many ad blocklists!)
            // might enable if we decide to also capture ads? but not clear where these actually show up in the
            // interface...
            if (debug_logs) console.log('ignoring ads from ' + source_url);
            return [];
        } else if (path[0] === "explore") {
            view = "explore";
            if (path[1] === "locations") {
                view = "location";
            } else if (path[1] === "search") {
                // hashtag, location view
                view = "search";
            }
        } else if (path[0] === "reels") {
            // reels explore page
            view = "reels";
            // NOTE: https://www.instagram/reels routes to a random reel (e.g. https://www.instagram.com/reels/DR1BchxgSxf/)
            // This makes it difficult to distinguish between single reel pages and the reels explore page (though single reel pages are captured below)
            if (path.length > 1 && path[1] === "audio") {
                // reels shared audio page
                view = "reels_audio";
            }
        } else if (path[0] === "stories") {
            if (path.length > 1 && path[1] === "highlights") {
                // User highlight reels
                // e.g. https://www.instagram.com/stories/highlights/numeric_highlight_code
                view = "highlight_reels";
                // These objects are NOT complete reels; the "code" field is misleading (would connect to a different reel if used in URL)
                // Can find real reel code in "store_feed_media" under "media_code", but the object is missing virtually everything else
                // skipping as of 2026-jan-29; would need special handling
            } else {
                // 2026-2-5 stories explore page (https://www.instagram.com/stories/) does not exist
                return [];
            }
        } else if (path[0] === "reel") {
            // single reel
            view = "single_reel";
        } else if (path[0] === "p") {
            // single post page
            view = "single_post";
        
        // Assuming we caught everything else above, these should be user pages
        } else if (path.length == 1) {
            // user profile page w/ posts
            // e.g. https://www.instagram.com/username/
            view = "user_posts";
        } else if (path.length > 1) {
            // Additional user pages with different content (e.g. tagged posts, reels, etc.)
            if (path[1] === "tagged") {
                // user tagged posts page (e.g. https://www.instagram.com/user/tagged/)
                view = "user_tagged";
            } else if (path[1] === "reels") {
                // user reels page (e.g. https://www.instagram.com/username/reels/)
                view = "user_reels";
            } else if (path[1] === "reposts") {
                // user reposts page (e.g. https://www.instagram.com/username/reposts/)
                view = "user_reposts";
            } else if (path[1] === "saved") {
                // user saved posts page (e.g. https://www.instagram.com/username/saved/)
                view = "user_saved";
            } else if (path[1] === "p") {
                // single post page with extra path element (e.g. https://www.instagram.com/username/p/postcode/)
                view = "single_post";
            } else if (path[1] === "reel") {
                // single reel page with extra path element (e.g. https://www.instagram.com/username/reel/reelcode/)
                view = "single_reel";
            } else {
                // some other page; may not be user (path[0] could be new content type)
                view = "unknown";
                console.log('Unknown page type', path, 'for url', source_platform_url);
            }
        }
        // console.log(view + ' view for ' + source_platform_url + ' from ' + source_url);

        // instagram sometimes loads content in the background without actually using it
        // maybe pre-caching it or something?
        // this next bit tries to avoid that noise ending up in the data
        if ((source_platform_url.indexOf('reels/audio') >= 0
                || source_platform_url.indexOf('/explore/') >= 0
            )
            && source_platform_url.indexOf('/locations/') < 0
            && (source_url.endsWith('graphql') || source_url.endsWith('graphql/query'))) {
            // reels audio page f.ex. loads personalised reels in the background (unrelated to the audio) but doesn't
            // seem to actually use them)

            if (debug_logs) console.log('ignoring pre-cache ' + source_url);
            return [];
        }

        if (source_url.indexOf("/api/v1/discover/web/explore_grid/") >= 0) {
            // Preload explorer content
            // Not used on search or location explorer pages
            // ✔️ confirmed working as of 2026-2-5
            if (view !== "explore") {
                if (debug_logs) console.log('ignoring pre-cache ' + source_url);
                return [];
            }
        }

        let datas = [];
        try {
            // some responses have this prefix that needs to be removed before parsing
            // e.g. /api/vi1/clips/music/...
            if (response.startsWith("for (;;);")) {
                    response = response.slice("for (;;);".length);
                }
            // if it's JSON already, just parse it
            datas.push(JSON.parse(response));
        } catch {
            // data can be embedded in the HTML in these JavaScript statements
            // - single post pages (e.g. https://www.instagram.com/p/C1hWCZLPQ9T/)
            // - single reel pages (e.g. https://www.instagram.com/reel/C1hWCZLPQ9T/)
            //   ✔️ confirmed working as of 2026-2-5

            // Extract any embedded JSON fragments using shared helper
            try {
                datas.push(...(extractEmbeddedInstagramJSON(response) || []));
            } catch (e) {
                // ignore
                console.log(e);
                return [];
            }
        }

        if (datas.length === 0) {
            // console.log('no datas for ' + source_url);
            return [];
        } else if (datas.length === 1 && 'lightspeed_web_request_for_igd' in datas[0] && source_url.endsWith('graphql')) {
            // this is one of those background requests
            // console.log('ignoring background request ' + source_url);
            datas = [];
        }

        let possible_item_lists = ["items", "edges", "repost_grid_items", "medias", "feed_items", "fill_items", "two_by_two_item"];
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
                // Handle frontpage and filter our background requests for it 
                if (property === "xdt_api__v1__feed__timeline__connection") {  
                    if (view === "frontpage") {
                        // - posts in personal feed without adds (i.e. https://instagram.com)
                        //   ✔️ confirmed working 2026-feb-5
                        if (debug_logs) console.log('processing timeline edges from ' + source_url);
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
                        return;   
                    } else {
                        // this is a background request for the personal feed
                        if (debug_logs) console.log('ignoring background feed request ' + source_platform_url);
                        return;
                    }

                // Handle most other pages with generic item list parsing to verify post/reels
                } else if (possible_item_lists.includes(property)) {
                    if (Array.isArray(obj[property]) && obj[property].length === 0) {
                        // empty list
                        continue;
                    } 

                    let items;
                    if (property === "edges" || property === "repost_grid_items") {
                        // `edges` lists have [{node: {media: {...}}}, ...] format 
                        // or [{node: {...}}, ...] format
                        
                        // Normalize edges to node objects
                        const nodes = (obj[property] || []).map(entry => entry && (entry.node || entry));

                        // If nodes contain a `media` property, extract those media objects
                        const hasOwn = Object.prototype.hasOwnProperty;
                        const medias = nodes
                            .map(n => n && hasOwn.call(n, 'media') && n.media ? n.media : null)
                            .filter(Boolean);

                        if (medias.length > 0) {
                            if (debug_logs) console.log('processing edges list (w/ media) from ' + source_url);
                            // Reels page e.g. https://www.instagram.com/reels/ 
                            // ✔️ confirmed working 2026-feb-5
                            // User reels page e.g. https://www.instagram.com/joshokeefeofficial/reels/
                            // ✔️ confirmed working 2026-feb-5
                            // Single reel page e.g. https://www.instagram.com/reels/DOgYE8ZjSBH/
                            // ✔️ confirmed working 2026-feb-5
                            // Single post page e.g. https://www.instagram.com/p/DUWPxaxD5BU/
                            // ✔️ confirmed working 2026-feb-5
                            // User reposts page e.g. https://www.instagram.com/username/reposts/
                            // ✔️ confirmed working 2026-feb-5
                            items = medias;
                        } else {
                            // If nodes themselves look like media objects (have id & media_type), use them
                            const nodeMediaLike = nodes.filter(n => n && 'id' in n && 'media_type' in n);
                            if (nodeMediaLike.length > 0) {
                                if (debug_logs) console.log('processing edges list (w/o media) from ' + source_url);
                                items = nodeMediaLike;
                                // Tagged posts page e.g. https://www.instagram.com/steveo/tagged/
                                // ✔️ confirmed working 2026-feb-5
                            } else {
                                // fallback to original property 
                                items = obj[property];
                            }
                        }

                    
                    
                    

                    } else if (property === "medias" || property === "fill_items") {
                        // Can be background loaded on various pages
                        if (["explore", "search"].includes(view)) {
                            // - posts on explore pages for specific tags (e.g. https://www.instagram.com/explore)
                            // ✔️ confirmed working as of 2026-feb-5
                            // - posts on explore pages for specific tags (e.g. https://www.instagram.com/explore/tags/blessed/)
                            // ✔️ confirmed working as of 2026-feb-5
                            if (debug_logs) console.log('processing medias/fill_items list from ' + source_url);
                            items = obj[property].map(media => media["media"]);
                        } else {
                            if (debug_logs) console.log('ignoring background medias/fill_items from ' + source_url);
                            continue;
                        }                        
                    } else if (property === "feed_items") {
                        if (debug_logs) console.log('processing feed_items list from ' + source_url);
                        items = obj[property].map(media => media["media_or_ad"]);
                    } else if (property === "items" && obj[property].length === obj[property].filter(i => 'media' in i).length) {
                        
                        if (view === "explore" || ['api/v1/clips/music/', "api/v1/feed/saved/"].some(endpoint => source_url.indexOf(endpoint) >= 0)) {
                            // - posts on explore pages for sounds (e.g. https://www.instagram.com/reels/audio/290315579897542/)
                            //   ✔️ confirmed working as of 2026-feb-5
                            // User saved posts page (e.g. https://www.instagram.com/username/saved/)
                            //   ✔️ confirmed working as of 2026-feb-5
                            // Explore page reels are loaded here
                            // ✔️ confirmed working as of 2026-feb-5
                            // Note: this loads reels via explorer, but can load both posts and reels e.g. in saved posts
                            if (debug_logs) console.log('processing explore items list with media property from ' + source_url);
                            items =  obj[property].map(media => media["media"]);
                        } else {
                            if (debug_logs) console.log('ignoring background items with media property from ' + source_url);
                            continue;
                        }  
                    } else if (property === "two_by_two_item") {
                        if (debug_logs) console.log('processing two_by_two_item list from ' + source_url);
                        // highlighted (4x size) items on e.g. tag overview page
                        items = [obj[property]['channel']['media']]
                    } else {
                        // Single reel popup e.g. https://www.instagram.com/reel/CsBfqYvuMg0/
                        // ✔️ confirmed working 2026-feb-5
                        if (debug_logs) console.log('processing generic items list from ' + source_url);
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
                                // && "caption" in item (partial reels may not have captions)
                                // ensure post/reel is "seen" (if that info is available)
                                && ("is_seen" in item ? item["is_seen"] !== false : true)
                                // these next two are ads, which are not actually shown in the feed but still loaded in the
                                // background
                                && !("product_type" in item && item["product_type"] === "ad")
                                && !("link" in item && item["link"] && item["link"].startsWith('https://www.facebook.com/ads/'))
                            );
                        }));
                    }

                } else if (["xdt_api__v1__feed__user_timeline_graphql_connection", "xdt_location_get_web_info_tab"].includes(property)) {
                    // - posts on user pages (e.g. https://www.instagram.com/ogata.yoshiyuki/)
                    //   ✔️ confirmed working as of 2026-feb-5
                    // - posts on explore pages for locations (e.g. https://www.instagram.com/explore/locations/238875664/switzerland/)
                    //   ✔️ confirmed working as of 2026-feb-5
                    if (debug_logs) console.log('processing user timeline edges from ' + source_url);
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

        if (edges.length === 0) {
            // console.log('no edges for ' + source_url);
            // console.log(datas);
            return [];
        } 

        let partial_count = 0;
        // Add custom fields 
        const enriched = edges.map(edge => {
            // mark partial objects (missing caption or video_versions)
            if (debug_logs) console.log('processing post/reel id ' + edge.code);

            // These are partial reel objects from user/audio/and other pages
            if (!('caption' in edge) || !('video_versions' in edge)) {
                edge = Object.assign({}, edge, { 
                    _zs_partial: true
                });
                partial_count++;
            } else {
                edge = Object.assign({}, edge, {
                    _zs_partial: false
                });
            }

            edge = Object.assign({}, edge, {
                _zs_instagram_view: view,
            });

            return edge;
        });

        if (debug_logs) console.log(view + ' got ' + edges.length + ' (partial: ' + partial_count + ') via ' + source_url)
        // generic ad filter...
        return enriched.filter(edge => edge["product_type"] !== "ad");
    },
    null,
    function (incoming_item, existing_item) {
        // Return true if incoming item should replace existing; false otherwise.
        // Compare partial vs full: upgrade partial to full; don't downgrade full to partial.
        if (!existing_item || !existing_item.data) {
            return false;
        }

        const existing_partial = existing_item.data._zs_partial === true;
        const incoming_partial = incoming_item && incoming_item._zs_partial === true;

        // Upgrade: partial → full
        if (existing_partial && !incoming_partial) {
            return true;
        }

        // Downgrade protection: full → partial
        if (!existing_partial && incoming_partial) {
            return false;
        }

        // No opinion on same completeness level
        return false;
    },
    "For Instagram, some reel collection pages do not include video links or captions; these are updated when you navigate to the individual reel page to add the missing data."
);