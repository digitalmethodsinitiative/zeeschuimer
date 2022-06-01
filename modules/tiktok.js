zeeschuimer.register_module(
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

        if(!response) {
            return [];
        }

        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        console.log('aaaaaaaaaaaaaa');
        if("ItemModule" in data) {
            let r = Object.values(data["ItemModule"]);
            return r;
        } else if ("itemList" in data) {
            return data["itemList"];
        } else if ("item_list" in data) {
            return data["item_list"];
        } else if ("data" in data) {
            // search results "top results" (i.e. not the video tab)
            let r = Object.values(data["data"]);
            if(r.length === 0) {
                return [];
            }
            if(!r[0].hasOwnProperty("type") || !r[0].hasOwnProperty("item")) {
                return [];
            }
            let items = r.map(x => x["item"]);
            let known_fields = ["id", "desc", "createTime", "music", "duetInfo"];
            for(let i in known_fields) {
                if(!items[0].hasOwnProperty(known_fields[i])) {
                    return [];
                }
            }
            return items;
        } else {
            return [];
        }
    }
)