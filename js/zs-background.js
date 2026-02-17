window.db = new Dexie('zeeschuimer-items');
window.db.version(1).stores({
    items: "++id, item_id, nav_index, source_platform",
    uploads: "++id",
    nav: "++id, tab_id, session",
    settings: "key"
});

window.db.version(2).stores({
    items: "++id, item_id, nav_index, source_platform, last_updated, [item_id+source_platform+last_updated]",
    uploads: "++id",
    nav: "++id, tab_id, session",
    settings: "key"
}).upgrade(async (tx) => {
    await tx.table('items').toCollection().modify((item) => {
        if (!item.last_updated) {
            item.last_updated = item.timestamp_collected || Date.now();
        }
    });
});

window.zeeschuimer = {
    modules: {},
    session: null,
    tab_url_map: {},

    /**
     * Register Zeeschuimer module
     * @param name  Module identifier
     * @param domain  Module primary domain name
     * @param callback  Function to parse request content with, returning an Array of extracted items
     * @param module_id  Module ID; if not given, use domain name as module ID. Use this if multiple modules read from
     *                   the same domain.
     * @param overwrite_partial  Optional function to determine if incoming item should replace existing item.
     *                       Signature: (incoming_item, existing_item) => boolean. Returns true if incoming should
     *                       replace existing, false otherwise. Backend routes to same-nav or any-nav based on availability.
     * @param override_message  Optional string describing when/how this module uses overwrite_partial. Shown in UI tooltip.
     */
    register_module: function (name, domain, callback, module_id=null, overwrite_partial=null, override_message=null) {
        if(!module_id) {
            module_id = domain;
        }
        this.modules[module_id] = {
            name: name,
            domain: domain,
            callback: callback,
            overwrite_partial: overwrite_partial,
            override_message: override_message
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

        // synchronise browser icon with whether capture is enabled or not
        setInterval(async function () {
            let enabled = [];
            for (const module in zeeschuimer.modules) {
                const enabled_key = 'zs-enabled-' + module;
                const is_enabled = await browser.storage.local.get(enabled_key);
                if (is_enabled.hasOwnProperty(enabled_key) && !!parseInt(is_enabled[enabled_key])) {
                    enabled.push(module);
                }
            }
            let path = enabled.length > 0 ? 'images/zeeschuimer-icon-active.png' : 'images/zeeschuimer-icon-inactive.png';
            browser.browserAction.setIcon({path: path})
        }, 500);
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

        const document_url = details.url;
        const origin_url = details.hasOwnProperty("originUrl") && details.originUrl ? details.originUrl : document_url;

        // both the domain of the document itself, as well as the domain of the document it was requested by via fetch
        const document_source_domain = document_url.split('://').pop().split('/')[0].replace(/^www\./, '').toLowerCase();
        const possible_source_domains = [
            document_source_domain,
            origin_url.split('://').pop().split('/')[0].replace(/^www\./, '').toLowerCase()
        ];

        // the document can be parsed by all modules listening on either the origin or document's URL's domain
        let eligible_modules = Object.fromEntries(Object.entries(window.zeeschuimer.modules).filter(entry => {
            return possible_source_domains.some((domain) => domain.endsWith(entry[1]["domain"].toLowerCase()));
        }));

        filter.ondata = event => {
            let str = decoder.decode(event.data, {stream: true});
            full_response += str;
            filter.write(event.data);
        }

        filter.onstop = async (event) => {
            // pass the document to all eligible modules that are also enabled
            let enabled_modules = [];
            for(const module_id in eligible_modules) {
                const module_enabled_key = 'zs-enabled-' + module_id;
                let module_enabled = await browser.storage.local.get(module_enabled_key);
                module_enabled = module_enabled.hasOwnProperty(module_enabled_key) && !!parseInt(module_enabled[module_enabled_key]);

                if(module_enabled) {
                    enabled_modules.push(module_id);
                }
            }
            await zeeschuimer.parse_request(full_response, origin_url, document_url, details.tabId, enabled_modules);
            filter.disconnect();
            full_response = '';
        }

        return {};
    },

    /**
     * Parse captured request
     * @param response  Content of the request
     * @param origin_url  URL of the *page* the data was requested from
     * @param document_url  URL of the content that was captured
     * @param tabId  ID of the tab in which the request was captured
     * @param enabled_modules  List of IDs of enabled modules
     */
    parse_request: async function (response, origin_url, document_url, tabId, enabled_modules) {
        if (!origin_url) {
            origin_url = document_url;
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
            origin_url = tab.url;
        } catch (Error) {
            tabId = -1;
            // invalid tab id, use provided originUrl
        }

        // sometimes the tab URL changes without triggering a webNavigation
        // event! so check if the URL changes, and then increase the nav
        // index *as if* an event had triggered if it does
        if (old_url && origin_url !== old_url) {
            await zeeschuimer.nav_handler(tabId);
        }

        this.tab_url_map[tabId] = origin_url;

        // get the navigation index for the tab
        // if any of the processed items already exist for this combination of
        // navigation index and tab ID, it is ignored as a duplicate
        let nav_index = await db.nav.where({"tab_id": tabId, "session": this.session}).first();
        if (!nav_index) {
            nav_index = {"tab_id": tabId, "session": this.session, "index": 0};
            await db.nav.add(nav_index);
        }
        nav_index = nav_index.session + ":" + nav_index.tab_id + ":" + nav_index.index;

        const duplicate_behavior_key = 'zs-duplicate-behavior';
        const duplicate_behavior = await browser.storage.local.get(duplicate_behavior_key);
        let action_on_duplicate = duplicate_behavior[duplicate_behavior_key] || 'insert';
        if (typeof action_on_duplicate === 'string') {
            action_on_duplicate = action_on_duplicate.toLowerCase();
        }
        // 'merge' not yet supported via UI (and is untested)
        if (!['insert', 'skip', 'update', 'merge'].includes(action_on_duplicate)) {
            console.warn('Invalid global duplicate behavior setting', action_on_duplicate, '; using default "insert" behavior');
            action_on_duplicate = 'insert';
        }

        let item_list = [];
        for (let module_id in this.modules) {
            if(!enabled_modules.includes(module_id)) {
                continue
            }

            item_list = this.modules[module_id].callback(response, origin_url, document_url);
            if (item_list && item_list.length > 0) {
                await Promise.all(item_list.map(async (item) => {
                    if (!item) {
                        return;
                    }

                    let item_id = item["id"];
                    if (item_id === undefined || item_id === null) {
                        console.warn('Item contained null item_id; skipping', item);
                        return;
                    }

                    await db.transaction('rw', db.items, async () => {
                        const module = this.modules[module_id];
                        const existing_item_current_nav = await db.items.where({
                            "item_id": item_id,
                            "nav_index": nav_index,
                            "source_platform": module_id
                        }).first();
                        // Cross-nav lookup: same item_id and platform across all time, newest last_updated first.
                        const existing_item_any_nav = await db.items
                            .where('[item_id+source_platform+last_updated]')
                            .between(
                                [item_id, module_id, Dexie.minKey],
                                [item_id, module_id, Dexie.maxKey]
                            )
                            .last();

                        let action = null;
                        let target_item = null;

                        if (existing_item_current_nav) {
                            // Item appears again on the same navigation index
                            // Check module overwrite_partial to determine whether to update or skip. 
                            // This allows modules to update incomplete items that are captured multiple times during the same navigation
                            // And ensure complete items are not overwritten with partial data
                            if (module && typeof module.overwrite_partial === "function" && await module.overwrite_partial(item, existing_item_current_nav)) {
                                // Update existing item with more complete data
                                action = 'update';
                                target_item = existing_item_current_nav;
                            } else {
                                // Default for same-nav duplicate is to skip, as it's most likely a true duplicate.
                                action = 'skip';
                                target_item = existing_item_current_nav;
                            }
                        } else if (existing_item_any_nav) {
                            // Item appears again but on a different navigation index. 
                            // Check global fallback behavior to determine action
                            target_item = existing_item_any_nav;
                            if (action_on_duplicate === 'insert') {
                                action = 'insert';
                            } else if (action_on_duplicate === 'skip') {
                                // Only update if module overwrite_partial explicitly returns true for cross-nav duplicates
                                // This implies we have only capture a partial object at this point
                                if (module && typeof module.overwrite_partial === "function" && await module.overwrite_partial(item, existing_item_any_nav)) {
                                    action = 'update';
                                } else {
                                    action = 'skip';
                                }
                            } else if (["update", "merge"].includes(action_on_duplicate)) {
                                // Do not update/merge if module overwrite_partial explicitly returns false for cross-nav duplicates
                                // This prevents us from overwriting complete items with partial data if we have only captured a partial object at this point
                                if (module && typeof module.overwrite_partial === "function" && await module.overwrite_partial(item, existing_item_any_nav) === false) {
                                    // Could merge here, but we want to avoid shallow (e.g. partial "user": {"id": 123} vs complete "user": {"id": 123, "name": "Alice"}) or otherwise destructive merges by default, so skip instead.
                                    action = 'skip';
                                } else {
                                    action = action_on_duplicate;
                                }
                            } else {
                                // Invalid fallback action, default to insert
                                console.warn('Invalid global duplicate behavior setting', action_on_duplicate, '; using default "insert" behavior');
                                action = 'insert';
                            }
                        } else {
                            // No duplicates, insert new item
                            action = 'insert';
                        }

                        // Normalize action string.
                        if (typeof action === 'string') {
                            action = action.toLowerCase();
                        }

                        // Validate action; fall back to insert if invalid.
                        if (!['insert', 'skip', 'update', 'merge'].includes(action)) {
                            console.warn('Invalid action for module', module_id, action, '; using insert');
                            action = 'insert';
                            target_item = null;
                        }

                        if (action === "skip") {
                            return;
                        }

                        if (action === "insert") {
                            // Insert new item with incoming data
                            await db.items.add({
                                "nav_index": nav_index,
                                "item_id": item_id,
                                "timestamp_collected": Date.now(),
                                "last_updated": Date.now(),
                                "source_platform": module_id,
                                "source_platform_url": origin_url,
                                "source_url": document_url,
                                "user_agent": navigator.userAgent,
                                "data": item
                            });
                            return;
                        }

                        if (action === "update") {
                            // Replace the stored data with the incoming item, keeping the original timestamp_collected.
                            await db.items.update(target_item.id, {
                                "nav_index": target_item.nav_index,
                                "item_id": item_id,
                                "timestamp_collected": target_item.timestamp_collected || Date.now(),
                                "last_updated": Date.now(),
                                "source_platform": module_id,
                                "source_platform_url": origin_url,
                                "source_url": document_url,
                                "user_agent": navigator.userAgent,
                                "data": item
                            });
                            return;
                        }

                        if (action === "merge") {
                            // Merge stored data with the incoming item (shallow merge).
                            const merged_data = Object.assign({}, target_item.data || {}, item);

                            await db.items.update(target_item.id, {
                                "nav_index": target_item.nav_index,
                                "item_id": item_id,
                                "timestamp_collected": target_item.timestamp_collected || Date.now(),
                                "last_updated": Date.now(),
                                "source_platform": module_id,
                                "source_platform_url": origin_url,
                                "source_url": document_url,
                                "user_agent": navigator.userAgent,
                                "data": merged_data
                            });
                            return;
                        }
                    });
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
