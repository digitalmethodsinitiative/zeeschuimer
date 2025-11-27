zeeschuimer.register_module(
    'Douyin',
    'douyin.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        if (!["douyin.com"].includes(domain)) {
            return [];
        }

        if (!response) {
            return [];
        }

        /**
         * Some data is embedded in the page rather than loaded asynchronously.
         * This here extracts it!
         */
        let embedded_sigil_start = /(<script class="STREAM_RENDER_DATA" type="application\/json">)/mg;
        let embedded_sigil_end = /(<\/script>)/mg;
        let response_jsons = [];
        let from_embed = false;
        if (embedded_sigil_start.test(response)) {
            response = response.split(embedded_sigil_start)[2];
            if (!embedded_sigil_end.test(response)) {
                return [];
            }
            response_jsons.push(response.split(embedded_sigil_end)[0]);
            console.log(`Found embedded Douyin videos on page ${source_platform_url}: ${source_url}`)
            from_embed = true;
        } else {
            // Recommend aka douyin.com home page has a different embedding!
            let embedded_sigil_start = /(self.__pace_f.push\()/mg;
            let embedded_sigil_end = /(\)<\/script>)/mg;
            if (embedded_sigil_start.test(response)) {
                // There are many of these...
                let possible_responses = response.split(embedded_sigil_start);
                for (let i = 1; i < possible_responses.length; i++) {
                    response = possible_responses[i];
                    if (embedded_sigil_end.test(response)) {
                        response = response.split(embedded_sigil_end)[0];
                        if (response.includes("recommendAwemeList") || response.includes("awemeId")) {
                            // Contain possibly interesting embedded data
                            let temp_data;
                            try {
                                // Extract first JSON
                                temp_data = JSON.parse(`${response}`);
                                // console.log(`Extracted: ${temp_data}`)
                            } catch (SyntaxError) {
                                console.log(`Failed to extract embedded JSON ${SyntaxError}: ${response}`)
                                continue;
                            }
                            if (temp_data instanceof Array) {
                                for (let j in temp_data) {
                                    let item = temp_data[j];
                                    let ebmedded_list_test = /(\d:\[)/mg;
                                    if (item && ebmedded_list_test.test(item)) {
                                        try {
                                            let parsed_list = JSON.parse(item.substring(item.indexOf(":[") + 1))
                                            for (let k in parsed_list) {
                                                let embedded_json = parsed_list[k];
                                                let embedded_json_list = [];
                                                if (embedded_json instanceof Array) {
                                                    // lists of lists...
                                                    for (let l in embedded_json) {
                                                        let embedded_json_item = embedded_json[l];
                                                        if (embedded_json_item instanceof Object) {
                                                            // console.log(`Embedded JSON item:`)
                                                            // console.log(embedded_json_item)
                                                            embedded_json_list.push(embedded_json_item);
                                                        } else {
                                                            // console.log(`Unknown embedded_json_item: ${embedded_json_item}`)
                                                        }
                                                    }
                                                } else {
                                                    embedded_json_list.push(embedded_json);
                                                }
                                                for (let m in embedded_json_list) {
                                                    let embedded_json = embedded_json_list[m];
                                                    if (embedded_json && (embedded_json instanceof Object)) {
                                                        if ("recommendAwemeList" in embedded_json) {
                                                            // Add value key to format as expected
                                                            response_jsons.push(JSON.stringify({"value": embedded_json}));
                                                        } else if ("videoDetail" in embedded_json && embedded_json["videoDetail"]) {
                                                            // Add value key to format as expected
                                                            response_jsons.push(JSON.stringify({"single_vid": embedded_json["videoDetail"], "value": []}));
                                                        }
                                                        // console.log(`Extracted embedded Douyin videos on page ${source_platform_url}`)
                                                    } else {
                                                        // console.log(`Unknown embedded_json: ${embedded_json}`)
                                                    }
                                                }
                                            }
                                        } catch (SyntaxError) {
                                            console.log(`Embedded parse error ${SyntaxError}:`)
                                            console.log(item)
                                        }
                                    }
                                }
                                from_embed = true;
                            } else {
                                // console.log(`Detected embedded Douyin: ${response}`)
                            }
                        }
                    }
                }
            } else {
                // No embedded data
                // Add full response for parsing
                response_jsons.push(response);
            }
        }

        /**
         * Parse the JSON data
         * Multiple ebmedded JSONs may be present
         */
        let usable_items = [];
        for (let i in response_jsons) {
            let potential_json = response_jsons[i];
            try {
                data = JSON.parse(`${potential_json}`);
            } catch (SyntaxError) {
                if (from_embed) {
                    console.log("Failed to parse embedded Douyin videos")
                    console.log(potential_json)
                    console.log(SyntaxError)
                }
                return [];
            }

            if (from_embed) {
                let awemeList_count = 0;
                let recommendAwemeList_count = 0;
                if (source_platform_url.includes("?modal_id=") && "recommendAwemeList" in data["value"]) {
                    // This is an individual video page and the embedded data is NOT the video itself! Only visible when the individual video is closed.
                    console.log("Recommended videos on individual page are not visible")
                    // console.log(data)
                } else {
                    // Embedded data
                    if ("single_vid" in data) {
                        // Single video extracted above
                        let item = data["single_vid"];
                        if ("awemeId" in item) {
                            // Known format
                            item["id"] = item["awemeId"];
                            item["ZS_collected_from_embed"] = from_embed;
                            usable_items.push(item);
                            console.log(`Collected single video from embedded HTML ${source_platform_url}`)
                        } else {
                            console.log("Unable to parse single video from embedded data:")
                            console.log(data)
                        }
                    } else if ("value" in data) {
                        // Two places where we can find videos (at least...)
                        if (("homeFetchData" in data["value"]) && !(data["value"]["homeFetchData"] === "$undefined") && ("awemeList" in data["value"]["homeFetchData"])) {
                            for (let i in data["value"]["homeFetchData"]["awemeList"]) {
                                let item = data["value"]["homeFetchData"]["awemeList"][i];
                                item["id"] = item["awemeId"];
                                item["ZS_collected_from_embed"] = from_embed;
                                usable_items.push(item);
                            }
                            awemeList_count = data["value"]["homeFetchData"]["awemeList"].length;
                        }
                        if ("recommendAwemeList" in data["value"]) {
                            for (let i in data["value"]["recommendAwemeList"]) {
                                let item = data["value"]["recommendAwemeList"][i];
                                item["id"] = item["awemeId"];
                                item["ZS_collected_from_embed"] = from_embed;
                                usable_items.push(item);
                            }
                            recommendAwemeList_count = data["value"]["recommendAwemeList"].length;
                        }
                    }
                }
                if (usable_items.length === 0) {
                    console.log("Unable to parse embedded data:")
                    console.log(data)
                } else {
                    console.log(`Collected ${usable_items.length} Douyin videos from embedded HTML (awemeList ${awemeList_count}, recommendAwemeList ${recommendAwemeList_count})`)
                }
            } else if ("aweme_detail" in data) {
                // Single video on page (e.g. www.douyin.com/video/7092325988377316616
                let item = data["aweme_detail"];
                item["id"] = item["aweme_id"];
                usable_items.push(item);
                console.log(`Collected single video from aweme_detail ${source_platform_url}`)
            } else if ("cards" in data) {
                // Front Page (首页) tab (i.e. douyin.com/discover)
                if (source_platform_url.includes("/discover") || source_platform_url.includes("/jingxuan")) {
                    for (let i in data["cards"]) {
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
                } else {
                    // Douyin, may attempt to load these on other pages, but they are not visible.
                    // They will be displayed if we navigate to the Front Page though, HARD refresh on browser will be needed
                    console.log(`Collected but not visible Douyin videos from ${source_platform_url}`)
                    // console.log(data)
                }
                console.log(`Collected ${usable_items.length} Douyin videos for cards`)
            } else if ("aweme_list" in data) {
                // Recommend (推荐) tab, Hot (热点) tab, and Channels (e.g. game (游戏), entertainment (娱乐), music (音乐))
                // Also collects extra videos from mixes/collections (e.g. from Search page)
                // And collects the "recommended" videos from clicking on a video from ANY page (possibly without being seen... e.g. on Frong Page where we are skipping them due to this)

                // Recommend (e.g. home page douyin.com or douyin.com/?recommend=1 etc.) page tab loads multiple aweme_list objects, but only one is visible
                let url = new URL(source_platform_url);
                if (source_platform_url.includes("?modal_id=") || source_platform_url.includes("/video/") || ((url.pathname === '/' || url.pathname === '') && (["locate_item_available", "chime_video_list"].some(function (e) {
                    return e in data;
                })))) {
                    // These are not visible though they may appear when navigating to the Front Page and possibly elsewhere
                    console.log(`Collected but not visible Douyin videos from ${source_platform_url}`)
                    // console.log(data)
                } else {
                    for (let i in data["aweme_list"]) {
                        let item_data = data["aweme_list"][i];
                        item_data["id"] = item_data["aweme_id"];
                        // On search page, items collected this way are part of collections/mixes and not the first video
                        if (source_platform_url.includes("douyin.com/search")) {
                            item_data["ZS_collected_from_mix"] = true;
                            item_data["ZS_first_mix_vid"] = false;
                        }
                        usable_items.push(item_data);
                    }
                console.log(`Collected ${usable_items.length} Douyin videos for aweme_list`)
                }
            } else if (("data" in data) && Array.isArray(data["data"]) && ("global_doodle_config" in data)) {
                // Search
                let videos_count = 0;
                let mix_count = 0;
                let mix_video_count = 0;
                for (let i in data["data"]) {
                    let search_result = data["data"][i];
                    // Search items can also return "mixes"/"collections"
                    if (search_result["card_unique_name"] === "video") {
                        // Single video
                        let item_data = search_result["aweme_info"];
                        item_data["id"] = item_data["aweme_id"];
                        usable_items.push(item_data);
                        videos_count++;
                        // console.log(`Collected single video from data/card_unique_name:video ${source_platform_url}`)
                    } else if (search_result["card_unique_name"] === "aweme_mix") {
                        // Collection of videos
                        let mix_videos = search_result["aweme_mix_info"]["mix_items"];
                        let first_mix_vid = true;
                        for (let j in mix_videos) {
                            // Each video has mix_info data
                            // item_data["mix_info"]["statis"]["current_episode"] is an int starting at 1 representing the video order
                            let item_data = mix_videos[j];
                            item_data["id"] = item_data["aweme_id"];
                            // Add some metadata to ensure we know video was found in mix and which video was displayed (i.e. the first)
                            item_data["ZS_collected_from_mix"] = true;
                            if (first_mix_vid) {
                                // We know this video was displayed on screen
                                item_data["ZS_first_mix_vid"] = true;
                                first_mix_vid = false;
                            } else {
                                item_data["ZS_first_mix_vid"] = false;
                            }
                            usable_items.push(item_data);
                            mix_video_count++;
                        }
                        mix_count++;
                        // console.log(`Collected mix of ${mix_videos.length} videos from ${source_platform_url}`)
                    } else if ("card_info" in search_result && "attached_info" in search_result["card_info"] && "aweme_list" in search_result["card_info"]["attached_info"]) {
                        // Seen card_unique_name: douyin_playlet_v1
                        let first = true;
                        for (let i in search_result["card_info"]["attached_info"]["aweme_list"]) {
                            let item_data = search_result["card_info"]["attached_info"]["aweme_list"][i];
                            item_data["id"] = item_data["aweme_id"];
                            usable_items.push(item_data);
                        }
                        // I have only seen these with 1 video, but... ?
                        // console.log(`Collected ${usable_items.length} Douyin videos for ${search_result["card_unique_name"]}`)
                    } else if ("sub_card_list" in search_result) {
                        // Similar to above, but nested as sub cards
                        // douyin_trending videos may be displayed this way
                        for (let i in search_result["sub_card_list"]) {
                            let sub_card = search_result["sub_card_list"][i];
                            if ("card_info" in sub_card && "attached_info" in sub_card["card_info"] && "aweme_list" in sub_card["card_info"]["attached_info"]) {
                                for (let j in sub_card["card_info"]["attached_info"]["aweme_list"]) {
                                    let item_data = sub_card["card_info"]["attached_info"]["aweme_list"][j];
                                    item_data["id"] = item_data["aweme_id"];
                                    usable_items.push(item_data);
                                }
                            } else {
                                console.log("Unknown sub_card:")
                                console.log(sub_card)
                            }
                        }
                    } else if (["baike_wiki_doc"].includes(search_result["card_unique_name"])) {
                        // baike_wiki_doc are cool chinese wiki cards; I have seen them explaining the search term used
                        // douyin_trending trending data
                    } else {
                        console.log("WARNING: NEW card type detected! Notify ZeeSchuimer developers https://github.com/digitalmethodsinitiative/zeeschuimer/issues")
                        console.log(search_result)
                    }
                }
                console.log(`Collected ${videos_count} Douyin videos and ${mix_count} mixes (containing ${mix_video_count} videos)`)
            } else if (
                (("e" in data) && ("sc" in data) && ("tc" in data) && (3 === Object.keys(data).length)) ||
                ("StabilityStatistics" in data) || "maigc" in data ||
                ("e" in data && "sc" in data && Object.keys(data).length === 2) ||
                ((4 === Object.keys(data).length) && "description" in data && data["description"] === "" && "data" in data && ((1 === Object.keys(data["data"]).length)))
            ) {
                // These appear to be status pings and other non-video data
                return [];
            } else {
                // console.log("MAYBE INTERESTING")
                // console.log(data)
            }
            // if () {
            //     // Live Stream (直播) tab}
            // Unable to detect this domain?
            // }
        }
        if (!(usable_items.length === 0)) {
            // Return the usable items; logging to console to compare with what is displayed on the page
            let usable_count = 0;
            for (let i in usable_items) {
                usable_count++;
                let item = usable_items[i];
                if ('desc' in item && item['desc']) {
                    // streams' desc are $undefined
                    // console.log(` Item ${i}: ${item['id']} - ${item['desc']}`);
                } else {
                    // console.log(`Item ${i}: ${item['id']} - no description`);
                }
            }
            console.log(`Found ${usable_items.length} Douyin videos on page ${source_platform_url}`)
            return usable_items;
        } else {
            // console.log("Detected expected object(s) by no usable items found")
        }
    }
);