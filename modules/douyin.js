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

        if ("cards" in data) {
            console.log("Collecting Douyin data...")
            let useable_items = [];
            for(let i in data["cards"]) {
                let item = data["cards"][i]["aweme"];
                try {
                    let item_data = JSON.parse(item);
                    item_data["id"] = item_data["aweme_id"];
                    useable_items.push(item_data);
                } catch (SyntaxError) {
                    console.log("Failed to parse item: " + item)
                }

            }
            return useable_items;
        }
    }
);