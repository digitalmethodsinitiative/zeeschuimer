export const MODULE_NAME = 'LinkedIn';
export const DOMAIN = 'linkedin.com';

export function capture(response, source_platform_url, source_url) {
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

                        if (item_index && item_index[0]['items'] !== undefined) {
                            // embedded results on search page
                            item_index = item_index[0]['items'].filter(i => i['item']['searchFeedUpdate']).map(item => {
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
}

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

// === auto-generated by 4cat map_item sync — BLOCK REPLACED AUTOMATICALLY ===
// (regenerated from datasources/linkedin/search_linkedin.py)
function getAuthor(post) {
    const author = {
        username: post.actor.navigationContext.actionTarget.split("linkedin.com/").pop().split("?")[0],
        name: post.actor.name.text,
        description: post.actor.description?.text ?? "",
        pronouns: "",
        avatar_url: "",
        is_company: "no",
        url: post.actor.navigationContext.actionTarget.split("?")[0]
    };

    if (post.actor.name?.attributes && post.actor.name.attributes[0]) {
        const attr0 = post.actor.name.attributes[0];
        if (attr0["*miniProfile"]) {
            const profile = attr0["*miniProfile"];
            if (profile.picture) {
                const artifacts = profile.picture.artifacts.slice().sort((a, b) => b.width - a.width);
                author.avatar_url = profile.picture.rootUrl + artifacts[0].fileIdentifyingUrlPathSegment;
            }
            if (profile.customPronoun) {
                author.pronouns = profile.customPronoun;
            } else if (profile.standardizedPronoun) {
                author.pronouns = profile.standardizedPronoun.toLowerCase();
            }
        } else if (attr0["*miniCompany"]) {
            const comp = attr0["*miniCompany"];
            const artifacts = comp.logo.artifacts.slice().sort((a, b) => b.width - a.width);
            author.is_company = "yes";
            author.avatar_url = comp.logo.rootUrl + artifacts[0].fileIdentifyingUrlPathSegment;
        }
    }

    if (post.actor.name?.attributesV2 && post.actor.name.attributesV2[0]) {
        const pron = post.actor.name.attributesV2[0].detailData?.["*profileFullName"]?.pronoun;
        if (pron) {
            if (pron.customPronoun) author.pronouns = pron.customPronoun;
            else if (pron.standardizedPronoun) author.pronouns = pron.standardizedPronoun;
        }
    }

    const avatar = post.actor.image?.attributes?.[0]?.detailData?.nonEntityProfilePicture;
    if (avatar && avatar.vectorImage) {
        author.avatar_url = avatar.vectorImage.rootUrl + avatar.vectorImage.artifacts[0].fileIdentifyingUrlPathSegment;
    }

    return author;
}

function parseTimeAgo(time_ago) {
    const part = time_ago.split("•")[0];
    const numbers = part.replace(/[^0-9]/g, "").trim();
    const letters = part.replace(/[0-9]/g, "").trim();

    const periodLengths = {
        s: 1,
        m: 60,
        h: 3600,
        d: 86400,
        w: 7 * 86400,
        mo: 30.4375 * 86400,
        mnd: 30.4375 * 86400,
        yr: 365.25 * 86400,
        j: 365.25 * 86400
    };

    const num = numbers.length ? parseInt(numbers, 10) : 0;
    const factor = periodLengths[letters] ?? 0;
    return factor * num;
}

export function map_item(item) {
    if (!item.actor) {
        return {};
    }
    let time_collected;
    if (item.__import_meta) {
        time_collected = Math.floor(item.__import_meta.timestamp_collected / 1000);
    } else {
        time_collected = Math.floor(Date.now() / 1000);
    }
    const time_ago = item.actor.subDescription?.text ?? "";
    const timestamp = Math.floor(time_collected - parseTimeAgo(time_ago));

    // images
    const images = [];
    if (item.content && item.content.images) {
        for (const image of item.content.images) {
            const image_data = image.attributes[0].vectorImage;
            const artifacts = image_data.artifacts.slice().sort((a, b) => b.width - a.width);
            const url = image_data.rootUrl + artifacts[0].fileIdentifyingUrlPathSegment;
            images.push(url);
        }
    }
    if (images.length === 0 && item.content && item.content.articleComponent && item.content.articleComponent.largeImage) {
        const largeImg = item.content.articleComponent.largeImage;
        const attr0 = largeImg.attributes[0];
        const image = attr0.detailData?.vectorImage;
        if (!image && attr0.imageUrl) {
            images.push(attr0.imageUrl.url);
        } else if (image && image.artifacts) {
            images.push(image.rootUrl + image.artifacts[0].fileIdentifyingUrlPathSegment);
        }
    }

    // video thumbnail
    let video_thumb_url = "";
    let thumb_content = null;
    if (item.content && "*videoPlayMetadata" in item.content) {
        thumb_content = item.content["*videoPlayMetadata"].thumbnail;
    } else if (item.content && item.content.linkedInVideoComponent && item.content.linkedInVideoComponent) {
        thumb_content = item.content.linkedInVideoComponent["*videoPlayMetadata"].thumbnail;
    } else if (item.content && item.content.externalVideoComponent && item.content.externalVideoComponent) {
        thumb_content = item.content.externalVideoComponent["*videoPlayMetadata"].thumbnail;
    }
    if (thumb_content) {
        video_thumb_url = thumb_content.rootUrl + thumb_content.artifacts[0].fileIdentifyingUrlPathSegment;
    }

    const author = getAuthor(item);

    const meta_urn = (item.updateMetadata?.urn) ?? item.preDashEntityUrn;
    const urn = "urn:li:activity:" + meta_urn.split("urn:li:activity:")[1].split(",")[0].split(")")[0];
    const item_id = urn.split(":").pop();

    // hashtags
    let hashtags = [];
    if (item.commentary && item.commentary.text && item.commentary.text.attributes) {
        hashtags = item.commentary.text.attributes
            .filter(tag => tag.type === "HASHTAG")
            .map(tag => tag.trackingUrn.split(":").pop());
    } else if (item.commentary && item.commentary.text && item.commentary.text.attributesV2) {
        hashtags = item.commentary.text.attributesV2
            .filter(tag => tag.detailData && tag.detailData["*hashtag"])
            .map(tag => tag.detailData["*hashtag"].trackingUrn.split(":").pop());
    }

    // mentions
    const author_mentions = [];
    const author_name_mentions = [];
    if (item.commentary && item.commentary.text && item.commentary.text.attributes) {
        for (const mention of item.commentary.text.attributes) {
            if (mention.type === "PROFILE_MENTION") {
                const mini = mention["*miniProfile"];
                author_mentions.push(mini.publicIdentifier);
                author_name_mentions.push([mini.firstName ?? "", mini.lastName ?? ""].join(" ").trim());
            } else if (mention.type === "COMPANY_NAME") {
                const mini = mention["*miniCompany"];
                author_mentions.push(mini.universalName);
                author_name_mentions.push(mini.name ?? "");
            }
        }
    }

    // metrics
    let metrics = {};
    if (item["*socialDetail"] && "*totalSocialActivityCounts" in item["*socialDetail"]) {
        const counts = item["*socialDetail"]["*totalSocialActivityCounts"];
        metrics = {
            comments: counts.numComments,
            shares: counts.numShares,
            reactions: counts.numLikes,
            reaction_like: 0,
            reaction_empathy: 0,
            reaction_praise: 0,
            reaction_entertainment: 0,
            reaction_appreciation: 0,
            reaction_interest: 0
        };
        if (Array.isArray(counts.reactionTypeCounts)) {
            for (const rc of counts.reactionTypeCounts) {
                const key = "reaction_" + rc.reactionType.toLowerCase();
                metrics[key] = rc.count;
            }
        }
    } else {
        const sd = item["*socialDetail"];
        metrics = {
            comments: sd.comments?.paging?.total ?? 0,
            shares: sd.totalShares ?? 0,
            reactions: sd.likes?.paging?.total ?? 0
        };
    }

    // link url
    let link_url = "";
    if (item.content && item.content.navigationContext) {
        link_url = item.content.navigationContext.actionTarget ?? "";
    } else if (item.content && item.content.articleComponent && item.content.articleComponent.navigationContext) {
        link_url = item.content.articleComponent.navigationContext.actionTarget ?? "";
    }

    // build result object
    const result = {
        collected_from_url: normalize_url_encoding(item.__import_meta?.source_platform_url ?? ""),
        id: item_id,
        thread_id: item_id,
        body: item.commentary?.text?.text ?? "",
        timestamp: formatUtcTimestamp(timestamp),
        timestamp_collected: formatUtcTimestamp(time_collected),
        timestamp_ago: time_ago.split("•")[0].trim(),
        is_promoted: /\d/.test(time_ago) ? "no" : "yes",
        // author fields (author_ prefix, drop trailing _username)
        ...Object.fromEntries(Object.entries(author).map(([k, v]) => {
            let field = "author_" + k;
            field = field.replace("_username", "");
            return [field, v];
        })),
        author_mentions: author_mentions.join(","),
        author_name_mentions: author_name_mentions.join(","),
        hashtags: hashtags.join(","),
        image_urls: images.join(","),
        video_thumb_url: video_thumb_url,
        post_url: "https://www.linkedin.com/feed/update/" + urn,
        link_url: link_url,
        ...metrics,
        inclusion_context: item.header?.text?.text ?? "",
        unix_timestamp: timestamp,
        unix_timestamp_collected: time_collected
    };

    return new MappedItem(result);
}
// === end auto-generated ===
