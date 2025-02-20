zeeschuimer.register_module(
    'LinkedIn',
    "linkedin.com",
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        if (domain !== 'linkedin.com') {
            return [];
        }

        // objects embedded in HTML are identified by this bit of text
        let items = [];
        let data = [];
        let data_type = "";
        try {
            if(response.indexOf('<!DOCTYPE html>') >= 0) {
                throw new Error();
            }
            // when dealing with JSON, just parse that JSON and process it
            const json_data = JSON.parse(response);
            data.push(json_data);
            data_type = "JSON";
        } catch (e) {
            // data is not JSON, so it's probably HTML
            // HTML has data embedded in <code> tags
            // store these for processing
            const code_regex = RegExp(/<code.*>([^<]+)<\/code>/g);

            for (const code_bit of response.matchAll(code_regex)) {
                // console.log("Code; checking for JSON");
                try {
                    // use he to decode from HTML entities (the way the data is embedded)
                    data.push(JSON.parse(he.decode(code_bit[1].trim())));
                    data_type = "HTML";
                    // console.log("Found JSON in code block");
                } catch (e) {
                }
            }
        }

        const eligible_list_types = ["feedDashMainFeedByMainFeed", "feedDashInterestUpdatesByInterestFeedByKeywords", "feedDashProfileUpdatesByMemberShareFeed", "searchDashClustersByAll", "feedDashUpdatesByPostSlug"]
        const uninteresting_list_types = ["*dashMySettings", "messagingDashMessagingSettings", "*searchDashSearchHome", "searchDashTypeaheadByGlobalTypeahead", "messagingDashAffiliatedMailboxesAll", "legoDashPageContentsByPageKeyAndSlotId", "searchDashFilterClustersByFilters"]
        for (const data_bit of data) {
            // now we have the data, try to parse it
            // is this object post data?
            let item_index = [];
            let location = "";
            if ("data" in data_bit && "included" in data_bit) {
                // items may be referenced as 'results' for search result pages or 'elements' for the feed
                let item_key = '';
                if ("*elements" in data_bit["data"]) {
                    item_index = data_bit["data"]["*elements"];
                    location = "data.*elements";
                } else if ("results" in data_bit["data"]) {
                    item_index = data_bit["data"]["results"];
                    location = "data.results";
                } else if ("data" in data_bit["data"] && Object.keys(data_bit["data"]["data"]).filter(k => eligible_list_types.includes(k))) {
                    for(const k of eligible_list_types) {
                        if(k in data_bit["data"]["data"]) {
                            const elements_key = (data_bit["data"]["data"][k]['*elements'] !== undefined) ? '*elements' : 'elements';
                            item_index = data_bit["data"]["data"][k][elements_key];
                            location = `data.data.${k}.${elements_key}`;

                            if (typeof (item_index) !== 'string' && item_index && item_index[0]['items'] !== undefined) {
                                // embedded results on search page
                                item_index = item_index[0]['items'].map(item => {
                                    return item['item']['searchFeedUpdate']['*update'];
                                });
                            }
                            break;
                        }
                    }
                    if (location === "") {
                        // Found nothing eligible
                        let uninteresting = false;
                        for (const k of uninteresting_list_types) {
                            if(k in data_bit["data"]["data"]) {
                                uninteresting = true;
                            }
                        }

                        if (!uninteresting) {
                            // Possibly interesting data
                            // console.log("No items found in data_bit:");
                            // console.log(data_bit);
                        }
                        continue;
                    }
                } else {
                    // console.log("No items found in data:");
                    // console.log(data_bit);
                    continue;
                }
                //console.log(`Searching items at ${location} from ${data_type} data on ${source_platform_url}`);

                // there is a list of objects, each with an ID
                // and a separate list of items to display, a list of those IDs
                // so the first step is to map item IDs to objects
                let mapped_objects = [];

                data_bit["included"].forEach(object => {
                    mapped_objects[object["entityUrn"]] = object;
                });

                // then we get the objects with the IDs in the item list
                // and that is our result set!
                let num_items = 0;
                for (let object_ref in item_index) {
                    let result = item_index[object_ref];

                    if (typeof result !== 'string') {
                        continue;
                    }

                    // there are many types of content in these responses
                    // we are (for now?) only interested in posts, which are identified in this way
                    if (result.indexOf('urn:li:fs_updateV2:(urn:li:activity:') !== 0
                      && result.indexOf('urn:li:fsd_update:(urn:li:activity:') !== 0) {
                        // console.log(`Skipping non-post item ${result}`);
                        continue;
                    }

                    let result_object = recursively_enrich(mapped_objects[result], mapped_objects);
                    result_object["id"] = result;

                    items.push(result_object);
                    num_items++;
                }
                console.log(`Found ${num_items} items in ${location} from ${data_type} data on ${source_platform_url}`);

            }
        }

        return items;
    });

/**
 * Enrich an object
 *
 * Some fields may contain references to other objects stored in a response's "include" field
 * This function recursively resolves these references
 *
 * @param object  Object to enrich
 * @param mapped_objects  Map of all available objects
 * @returns object  Enriched object
 */
function recursively_enrich(object, mapped_objects) {
    if (typeof (object) != 'object') {
        return object;
    }

    for (let field in object) {
        if (typeof field === 'string' && field.indexOf('*') === 0) {
            if (typeof object[field] === 'string' && object[field].indexOf('urn:') === 0) {
                // singular reference
                object[field] = recursively_enrich(mapped_objects[object[field]], mapped_objects);
            } else if (typeof object[field] === 'object') {
                // list of references
                for (let i in object[field]) {
                    if (typeof object[field][i] === 'string' && object[field][i].indexOf('urn:') === 0) {
                        object[field][i] = recursively_enrich(mapped_objects[object[field]], mapped_objects);
                    }
                }
            }
        } else {
            object[field] = recursively_enrich(object[field], mapped_objects);
        }
    }

    return object;
}