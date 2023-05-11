zeeschuimer.register_module(
    'Douyin',
    'douyin.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        if (!["douyin.com"].includes(domain)) {
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
        } else if ("cards" in data) {
            // Front Page (首页) tab
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
            console.log(`Collected ${usable_items.length} Douyin videos from Front page tab`)
            return usable_items;
        } else if ("aweme_list" in data) {
            // Recommend (推荐) tab, Hot (热点) tab, and Channels (e.g. game (游戏), entertainment (娱乐), music (音乐))

            let usable_items = [];
            for(let i in data["aweme_list"]) {
                let item_data = data["aweme_list"][i];
                item_data["id"] = item_data["aweme_id"];
                usable_items.push(item_data);
            }
            console.log(`Collected ${usable_items.length} Douyin videos from Recommend, Hot, or Channel tabs`)
            return usable_items;
        } else {
            // debug
            //console.log("MAYBE INTERESTING")
            //console.log(data)
        }

        // if () {
        //     // Live Stream (直播) tab}
        // Unable to detect this domain?
        // }
    }
);