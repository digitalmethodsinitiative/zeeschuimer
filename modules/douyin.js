zeeschuimer.register_module(
    'Douyin',
    'douyin.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (domain !== 'douyin.com' && domain !== 'live.douyin.com') { //!["douyin.com", "live.douyin.com"].includes(domain)) {
            return [];
        }

        let data;
        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        if (("e" in data) && ("sc" in data) && ("tc" in data) && (3 === Object.keys(data).length)) {
            // These appear to be status pings of some kind
            return [];
        } else {
            // debug
            console.log("MAYBE INTERESTING")
            console.log(data)
        }

        if ("cards" in data) {
            // Front Page (首页) tab
            console.log("Collecting Douyin Front Page data...")
            let usable_items = [];
            for(let i in data["cards"]) {
                let item = data["cards"][i]["aweme"];
                try {
                    let item_data = JSON.parse(item);
                    item_data["id"] = item_data["aweme_id"];
                    usable_items.push(item_data);
                } catch (SyntaxError) {
                    console.log("Failed to parse item: " + item)
                }

            }
            return usable_items;
        }

        // Recommend (推荐) tab, Hot (热点) tab, and Channels (e.g. game (游戏), entertainment (娱乐), music (音乐))
        if ("aweme_list" in data) {
            console.log("Collecting Douyin Recommend, Hot, or Channel data...")
            let usable_items = [];
            for(let i in data["aweme_list"]) {
                let item_data = data["aweme_list"][i];
                item_data["id"] = item_data["aweme_id"];
                usable_items.push(item_data);
            }
            return usable_items;
        }

        // if () {
        //     // Live Stream (直播) tab}
        // }
    }
);