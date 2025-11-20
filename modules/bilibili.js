zeeschuimer.register_module(
    'Bilibili',
    'bilibili.com',
    function (response, source_platform_url, source_url) {
        // Ensure each item has an "id" field using the bvid
        function ensureItemId(item) {
            if (item.bvid) {
                item.id = item.bvid;
            }
            return item;
        }

        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        if (!["bilibili.com"].includes(domain)) {
            return [];
        }

        if (!response) {
            return [];
        }

        let found_items;
        let type_of_item;

        // Try to parse as JSON first (API responses)
        let data;
        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            // Not JSON - might be HTML with embedded __pinia data
            if (typeof response === 'string' && response.includes('window.__pinia')) {
                console.log('Bilibili module: Detected HTML with __pinia, attempting to parse');
                
                // Extract the script tag or line containing window.__pinia
                // Look for the line - it should be in a <script> tag
                const lines = response.split('\n');
                let piniaLine = '';
                for (let line of lines) {
                    if (line.includes('window.__pinia')) {
                        piniaLine = line;
                        break;
                    }
                }
                
                if (piniaLine) {
                    // Parse the pinia data using the embedded parser
                    const videos = parsePiniaData(piniaLine);
                    
                    if (videos && videos.length > 0) {
                        console.log(`Bilibili module found ${videos.length} videos from __pinia HTML`);
                        for (let i = 0; i < videos.length; i++) {
                            console.log(`${i + 1}: ${videos[i].title || 'No title'}`);
                        }
                        return videos.map(ensureItemId);
                    }
                }
            }
            return [];
        }

        if (typeof data !== 'object' || !("data" in data) || typeof data["data"] !== 'object' ) {
            return [];
        // some Bilibili API responses use "item", some "archives"
        }  else if (("item" in data["data"]) && Array.isArray(data["data"]["item"])) {
            // Main display items array 
            type_of_item = "main item array";
            found_items = data["data"]["item"];
        } else if (("archives" in data["data"]) && Array.isArray(data["data"]["archives"])) {
            // Main display items array; on channel pages
            type_of_item = "main archives array";
            found_items = data["data"]["archives"];
        } else if (("items" in data["data"]) && Array.isArray(data["data"]["items"])) {
            // "Hot" cards that are added to the main display items array
            // It appears that only one is used from the array, but not always the first...
            type_of_item = "hot item array";
            found_items = data["data"]["items"];
        } else if (("recommend_room_list" in data["data"]) && Array.isArray(data["data"]["recommend_room_list"])) {
            // Live room recommendations added to the main display items array
            // Also appears that only one item in the array is used, but randomly
            type_of_item = "recommend room list array";
            found_items = [];
            for (let item of data["data"]["recommend_room_list"]) {
                item["id"] = item["roomid"];
                found_items.push(item);
            }
        } else {
            // No recognized items found
            return [];
        }
        console.log(`Bilibili module found (${type_of_item}) items in ${source_url}:`);

        i = 0;
        for (let item of found_items) {
            i++;
            if (typeof item == 'object' || ('title' in item)) {
                console.log(`${i}: ${item['title']}`);
            } else {
                console.log(`Invalid item ${i}  in ${type_of_item}:`);
                console.log(item);
            }
        }
        return found_items.map(ensureItemId);
    }
);