const db = new Dexie('zeeschuimer-items');
window.db = db;
window.db.version(1).stores({
    items: "++id, source_platform, source_platform_url, source_url, item"
});

function listener(details) {
    let filter = browser.webRequest.filterResponseData(details.requestId);
    let decoder = new TextDecoder("utf-8");
    let encoder = new TextEncoder();
    let full_response = '';
    let source_url = details.url;
    let source_platform_url = details.hasOwnProperty("originUrl") ? details.originUrl : source_url;

    filter.ondata = event => {
        let str = decoder.decode(event.data, {stream: true});
        full_response += str;
    }

    filter.onstop = event => {
        parse_request(full_response, source_platform_url, source_url);
        filter.write(encoder.encode(full_response));
        filter.disconnect();
        full_response = '';
    }

    return {};
}

browser.webRequest.onBeforeRequest.addListener(
    listener, {urls: ["https://*/*"], types: ["main_frame", "xmlhttprequest"]}, ["blocking"]
);

async function parse_request(response, source_platform_url, source_url) {
    if(!source_platform_url) {
        source_platform_url = source_url;
    }

    let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
    if(domain !== "tiktok.com" && domain !== "instagram.com") {
        console.log("Unknown domain " + domain);
        return;
    }

    let data;
    try {
        data = JSON.parse(response);
    } catch(SyntaxError) {
        // not JSON, doesn't concern us unless it's an instagram index page
        if(response.indexOf('window._sharedData = {') === -1) {
            return;
        }
        let json_bit = response.split('window._sharedData = ')[1].split(';</script>')[0];
        try {
            data = JSON.parse(json_bit);
        } catch(SyntaxError) {
            // embedded data can't be parsed as JSON
            return;
        }

        try {
            data = {"data": data["entry_data"]["ProfilePage"][0]["graphql"]}
        } catch(TypeError) {
            // some other data was embedded
            return;
        }
    }

    let item_list;
    if(data["itemList"]) {
        item_list = data["itemList"];
    } else {
        try {
            item_list = data["data"]["user"]["edge_owner_to_timeline_media"]["edges"];
        } catch(TypeError) {
            // not instagram or tiktok, unknown
            return;
        }
    }

    await Promise.all(item_list.map(async (item) => {
        await window.db.items.add({
            "source_platform": domain,
            "source_platform_url": source_platform_url,
            "source_url": source_url,
            "data": item
        });
    }));
}