zeeschuimer.register_module(
    'Facebook (posts)',
    'facebook.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["facebook.com"].includes(domain) || !source_url.endsWith('api/graphql/')) {
            return [];
        }

        let datas = [];
        let edges = [];
        const type_list = ['SOCIAL_POSTS', 'POSTS_SET_FEATURED', 'PUBLIC_POSTS'];

        const parse_ = function (obj){
            const exactKeysToRemove = new Set([
                "encrypted_tracking",
                "click_tracking_linkshim_cb",
                "encrypted_click_tracking",
                "comet_footer_renderer",
                "actor_provider",
                "trackingdata",
                "viewability_config",
                "client_view_config",
                "accessibility_caption",
                "reaction_display_config",
                "accent_color",
                "focus"
            ]);
        
            function shouldRemoveKey(key) {
                return (
                    exactKeysToRemove.has(key) ||
                    key.startsWith("__") ||
                    key.startsWith("ghl") ||
                    key.startsWith("viewer_")
                );
            }
        
            function deepClean(target) {
                if (Array.isArray(target)) {
                    for (let i = target.length - 1; i >= 0; i--) {
                        const item = target[i];
                        if (typeof item === "object" && item !== null) {
                            deepClean(item);
                            if (isEmpty(item)) {
                                target.splice(i, 1); // Delete empty items
                            }
                        } else if (item === null || item === undefined) {
                            target.splice(i, 1);
                        }
                    }
                } else if (target && typeof target === "object") {
                    for (const key of Object.keys(target)) {
                        if (shouldRemoveKey(key)) {
                            delete target[key];
                        } else {
                            const value = target[key];
                            if (typeof value === "object" && value !== null) {
                                deepClean(value);
                                if (isEmpty(value)) {
                                    delete target[key];
                                }
                            }
                        }
                    }
                }
            }
        
            function isEmpty(value) {
                if (Array.isArray(value)) {
                    return value.length === 0;
                } else if (value && typeof value === "object") {
                    return Object.keys(value).length === 0;
                }
                return false;
            }
        
            const cloned = structuredClone(obj);
            deepClean(cloned);
            return cloned;
            
        }

        try {
            datas.push(JSON.parse(response));
        } catch (e) {
            if (response.substring(0, 1) === '{') {
                //ndjson
                const lines = response.split('\n');
                for (const line of lines) {
                    try {
                        datas.push(parse_(JSON.parse(line)));
                    } catch (e) {
                    }
                }
            }
        }

        const traverse = function (obj) {
            for (const property in obj) {
                if (!obj.hasOwnProperty(property)) {
                    // not actually a property
                    continue;
                }

                if(obj['id'] && obj['__typename'] === 'Story' && obj['comet_sections']) {
                    console.log(obj);
                    edges.push(obj);
                } else if (typeof (obj[property]) === "object") {
                    traverse(obj[property]);
                }
            }
        }


        for (const data of datas) {
            if (data) {
                traverse(data);
            }
        }

        for(const index in edges) {
            try {
                const better_id = atob(edges[index]['id']);
                edges[index]['id'] = better_id;
            } catch (e) {
                // pass
            }
        }
        return edges;
    }
);