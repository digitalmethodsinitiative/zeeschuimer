window.db = new Dexie('zeeschuimer-items');
window.db.version(1).stores({
    items: "++id, source_platform, source_platform_url, source_url, item",
    uploads: "++id, timestamp, url, platform, items"
});

window.zeeschuimer = {
    modules: {},

    register_module: function (name, callback) {
        zeeschuimer.modules[name] = callback;
    },

    listener: function (details) {
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
            zeeschuimer.parse_request(full_response, source_platform_url, source_url, details.tabId);
            filter.write(encoder.encode(full_response));
            filter.disconnect();
            full_response = '';
        }

        return {};
    },

    parse_request: async function parse_request(response, source_platform_url, source_url, tabId) {
        if (!source_platform_url) {
            source_platform_url = source_url;
        }

        try {
            // get the *actual url* of the tab, not the url that the request
            // reports, which may be wrong
            let tab = await browser.tabs.get(tabId);
            source_platform_url = tab.url;
        } catch(Error) {
            // invalid tab id, use provided originUrl
        }

        let item_list = [];
        for (let module in zeeschuimer.modules) {
            item_list = zeeschuimer.modules[module](response, source_platform_url, source_url);
            if (item_list.length > 0) {
                await Promise.all(item_list.map(async (item) => {
                    await window.db.items.add({
                        "source_platform": module,
                        "source_platform_url": source_platform_url,
                        "source_url": source_url,
                        "data": item
                    });
                }));

                return;
            }
        }
    },

    has_tab: async function() {
        const tabs = await browser.tabs.query({});
        const fullUrl = browser.runtime.getURL('popup/status.html');
        const brightbeamTabs = tabs.filter((tab) => {
            return (tab.url === fullUrl);
        });
        return brightbeamTabs[0] || false;
    }

}

browser.webRequest.onBeforeRequest.addListener(
    zeeschuimer.listener, {urls: ["https://*/*"], types: ["main_frame", "xmlhttprequest"]}, ["blocking"]
);

browser.browserAction.onClicked.addListener(async () => {
    let tab = await window.zeeschuimer.has_tab();
    if(!tab) {
        browser.tabs.create({ url: 'popup/status.html' });
    } else if (!tab.active) {
        browser.tabs.update(tab.id, {active: true});
    }
});