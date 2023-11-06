window.db = new Dexie('zeeschuimer-items');
window.db.version(1).stores({
    items: "++id, item_id, nav_index, source_platform",
    uploads: "++id",
    nav: "++id, tab_id, session",
    settings: "key"
});

window.zeeschuimer = {
    modules: {},
    session: null,
    tab_url_map: {},
    firebase_url: null,
    firebase_key: null,
    firebase_project: null,

    /**
     * Register Zeeschuimer module
     * @param name  Module identifier
     * @param domain  Module primary domain name
     * @param callback  Function to parse request content with, returning an Array of extracted items
     */
    register_module: function (name, domain, callback) {
        this.modules[domain] = {
            name: name,
            callback: callback
        };
    },

    /**
     * Initialise Zeeschuimer
     * Called on browser session start; increases session index to aid in deduplicating extracted items.
     */
    init: async function () {
        let session;
        session = await db.settings.get("session");
        if (!session) {
            session = {"key": "session", "value": 0};
            await db.settings.add(session);
        }

        session["value"] += 1;
        this.session = session["value"];
        await db.settings.update("session", session);
        await db.nav.where("session").notEqual(this.session).delete();

        const firebase_url = await browser.storage.local.get('firebase-url');
        this.firebase_url = firebase_url

        const firebase_key = await browser.storage.local.get('firebase-key');
        this.firebase_key = firebase_key

        const firebase_project = await browser.storage.local.get('firebase-project');
        this.firebase_project = firebase_project
    },

    /**
     * Request listener
     * Filters HTTP requests and passes the content to the parser
     * @param details  Request details
     */
    listener: function (details) {
        let filter = browser.webRequest.filterResponseData(details.requestId);
        let decoder = new TextDecoder("utf-8");
        let full_response = '';
        let source_url = details.url;
        let source_platform_url = details.hasOwnProperty("originUrl") ? details.originUrl : source_url;

        filter.ondata = event => {
            let str = decoder.decode(event.data, {stream: true});
            full_response += str;
            filter.write(event.data);
        }

        filter.onstop = async (event) => {
            let base_url = source_platform_url ? source_platform_url : source_url;
            let source_platform = base_url.split('://').pop().split('/')[0].replace(/^www\./, '').toLowerCase();
            let enabled_key = 'zs-enabled-' + source_platform;
            let is_enabled = await browser.storage.local.get(enabled_key);
            let enabled = is_enabled.hasOwnProperty(enabled_key) && !!parseInt(is_enabled[enabled_key]);
            if (enabled) {
                zeeschuimer.parse_request(full_response, source_platform_url, source_url, details.tabId);
            }
            filter.disconnect();
            full_response = '';
        }

        return {};
    },

    /**
     * Parse captured request
     * @param response  Content of the request
     * @param source_platform_url  URL of the *page* the data was requested from
     * @param source_url  URL of the content that was captured
     * @param tabId  ID of the tab in which the request was captured
     */
    parse_request: async function (response, source_platform_url, source_url, tabId) {
        if (!source_platform_url) {
            source_platform_url = source_url;
        }

        // what url was loaded in the tab the previous time?
        let old_url = '';
        if (tabId in this.tab_url_map) {
            old_url = this.tab_url_map[tabId];
        }

        try {
            // get the *actual url* of the tab, not the url that the request
            // reports, which may be wrong
            let tab = await browser.tabs.get(tabId);
            source_platform_url = tab.url;
        } catch (Error) {
            tabId = -1;
            // invalid tab id, use provided originUrl
        }

        // sometimes the tab URL changes without triggering a webNavigation
        // event! so check if the URL changes, and then increase the nav
        // index *as if* an event had triggered if it does
        if (old_url && source_platform_url !== old_url) {
            await zeeschuimer.nav_handler(tabId);
        }

        this.tab_url_map[tabId] = source_platform_url;

        // get the navigation index for the tab
        // if any of the processed items already exist for this combination of
        // navigation index and tab ID, it is ignored as a duplicate
        let nav_index = await db.nav.where({"tab_id": tabId, "session": this.session}).first();
        if (!nav_index) {
            nav_index = {"tab_id": tabId, "session": this.session, "index": 0};
            await db.nav.add(nav_index);
        }
        nav_index = nav_index.session + ":" + nav_index.tab_id + ":" + nav_index.index;

        let item_list = [];
        for (let module in this.modules) {
            item_list = this.modules[module].callback(response, source_platform_url, source_url);
            if (item_list && item_list.length > 0) {
                await Promise.all(item_list.map(async (item) => {
                    if (!item) {
                        return;
                    }

                    let item_id = item["id"];
                    let exists = await db.items.where({"item_id": item_id, "nav_index": nav_index}).first();

                    if (!exists) {
                        await db.items.add({
                            "nav_index": nav_index,
                            "item_id": item_id,
                            "timestamp_collected": Date.now(),
                            "source_platform": module,
                            "source_platform_url": source_platform_url,
                            "source_url": source_url,
                            "user_agent": navigator.userAgent,
                            "data": item
                        });
                        
                    }

                }));

                return;
            }
        }
    },

    /**
     * Check if extension tab is open or not
     * @returns {Promise<boolean>}
     */
    has_tab: async function () {
        const tabs = await browser.tabs.query({});
        const full_url = browser.runtime.getURL('popup/interface.html');
        const zeeschuimer_tab = tabs.filter((tab) => {
            return (tab.url === full_url);
        });
        return zeeschuimer_tab[0] || false;
    },

    /**
     * Callback for browser navigation
     * Increases the nav_index for a given tab to aid in deduplication of captured items
     * @param tabId  Tab ID to update nav index for
     */
    nav_handler: async function (tabId) {
        if (tabId.hasOwnProperty("tabId")) {
            tabId = tabId.tabId;
        }

        let nav = await db.nav.where({"session": this.session, "tab_id": tabId});
        if (!nav) {
            nav = {"session": this.session, "tab_id": tabId, "index": 0}
            await db.nav.add(nav);
        }

        await db.nav.where({"session": this.session, "tab_id": tabId}).modify({"index": nav["index"] + 1});
    }
}

zeeschuimer.init();

browser.webRequest.onBeforeRequest.addListener(
    zeeschuimer.listener, {urls: ["https://*/*"], types: ["main_frame", "xmlhttprequest"]}, ["blocking"]
);

browser.webNavigation.onCommitted.addListener(
    zeeschuimer.nav_handler
);

browser.browserAction.onClicked.addListener(async () => {
    let tab = await zeeschuimer.has_tab();
    if (!tab) {
        browser.tabs.create({url: 'popup/interface.html'});
    } else if (!tab.active) {
        browser.tabs.update(tab.id, {active: true});
    }
});
