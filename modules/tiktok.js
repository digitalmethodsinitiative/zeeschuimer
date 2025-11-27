zeeschuimer.register_module(
    'TikTok (posts)',
    "tiktok.com",
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        if (domain !== 'tiktok.com') {
            return [];
        }

        /**
         * Some data is embedded in the page rather than loaded asynchronously.
         * This here extracts it!
         */
        let embedded_sigil_start = /(window\['SIGI_STATE']\s*=\s*|<script id="SIGI_STATE" type="application\/json">)/mg;
        let embedded_sigil_end = /(;\s*window\['SIGI_RETRY']\s*=\s*|<\/script>)/mg;
        let data;
        let from_embed = false;
        if(embedded_sigil_start.test(response)) {
            response = response.split(embedded_sigil_start)[2];
            if(!embedded_sigil_end.test(response)) {
                return [];
            }
            response = response.split(embedded_sigil_end)[0];
            from_embed = true;
        }

        // NEW: detect JSON embedded in HTML via <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
        if (!from_embed && typeof response === 'string' && response.indexOf('<script') >= 0) {
            const udrMatch = response.match(/<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
            if (udrMatch && udrMatch[1]) {
                try {
                    const ud = JSON.parse(udrMatch[1]);
                    const scope = ud && ud.__DEFAULT_SCOPE__;
                    const updatedItems = scope && scope["webapp.updated-items"];
                    if (Array.isArray(updatedItems)) {
                        // Return items from the new payload, excluding live items
                        return updatedItems.filter(x => !x?.liveRoomInfo);
                    }
                } catch (e) {
                    // fall through to other strategies
                }
            }
        }

        if(!response) {
            return [];
        }

        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        // TikTok preloads some data (for example on hover over a link)
        // https://www.tiktok.com/api/preload/item_list/ returns itemList array with full items that may not be reloaded if the user visits the link
        const from_preload = (typeof source_url === 'string') && (source_url.indexOf('/api/preload/') >= 0);
        if (from_preload) {
            // We could updated add an attribute to the items to indicate they are from preload, but we should encourage a full reload anyway
            // So we just ignore these items for now
            return [];
        }

        if("ItemModule" in data) {
            let r = Object.values(data["ItemModule"]);
            return r.filter(x => !x.hasOwnProperty('liveRoomInfo'));
        } else if ("itemList" in data) {
            return data["itemList"].filter(x => !x.hasOwnProperty('liveRoomInfo'));
        } else if ("item_list" in data) {
            return data["item_list"].filter(x => !x.hasOwnProperty('liveRoomInfo'));
        } else if ("data" in data) {
            // search results "top results" (i.e. not the video tab)
            let r = Object.values(data["data"]);
            let useable_items = [];
            if(r.length === 0) {
                return [];
            }
            let items = r.filter(x => x.hasOwnProperty('item') && x.hasOwnProperty('type')).map(x => x["item"]);
            let known_fields = ["id", "desc", "createTime", "music"];
            let bad_fields = ["liveRoomInfo"]; // if these are present, skip the post, e.g. for live streams
            for(let i in items) {
                let item = items[i];
                let item_ok = true;
                for (let j in known_fields) {
                    if (!item.hasOwnProperty(known_fields[j])) {
                        item_ok = false;
                    }
                }
                for (let j in bad_fields) {
                    if (item.hasOwnProperty(bad_fields[j])) {
                        item_ok = false;
                    }
                }
                if(item_ok) {
                    useable_items.push(item);
                }
            }
            return useable_items;
        } else {
            return [];
        }
    }
)