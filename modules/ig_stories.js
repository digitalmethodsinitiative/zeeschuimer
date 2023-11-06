zeeschuimer.register_module(
    'IG Stories',
    'instagram.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        let endpoint = source_url.split("/").slice(3).join("/").split("?")[0].split("#")[0].replace(/\/$/, '');

        const firebase_url = zeeschuimer.firebase_url['firebase-url']
        const firebase_key = zeeschuimer.firebase_key['firebase-key']
        const firebase_project = zeeschuimer.firebase_project['firebase-project']
        console.log(firebase_url)

        if (!["instagram.com"].includes(domain)) {
            return [];
        }

        let whitelisted_endpoints = [
            "api/v1/feed/reels_media", // live-loading stories
            "api/v1/feed/reels_tray", // stories tray
        ]


        if(!whitelisted_endpoints.includes(endpoint)) {
            return [];
        }

        console.log("Triggered")

        // determine what part of instagram we're working in
        let path = source_platform_url.split("/");
        let view = "";
        if(path.length === 3) {
            view = "frontpage";
        } else if(["direct", "account", "directory", "lite", "legal"].includes(path[3])) {
            // not post listings
            return [];
        } else if(path[3] === "explore") {
            // hashtag, location view
            view = "search";
        } else {
            view = "user";
        }


        let data;
        try {
            // if it's JSON already, just parse it
            data = JSON.parse(response);
        } catch (SyntaxError) {
            // data can be embedded in the HTML in either of these two JavaScript statements
            // if the second is present, it overrides the first
            let js_prefixes = ["window._sharedData = {", "window.__additionalDataLoaded('feed',{", "window.__additionalDataLoaded('feed_v2',{"];
            let prefix;

            while(js_prefixes.length > 0) {
                prefix = js_prefixes.shift();
                if (response.indexOf(prefix) === -1) {
                    continue
                }

                let json_bit = response.split(prefix.slice(0, -1))[1].split(';</script>')[0];
                if(prefix.indexOf("additionalDataLoaded") !== -1) {
                    // remove trailing )
                    json_bit = json_bit.slice(0, -1);
                }
                try {
                    data = JSON.parse(json_bit);
                } catch (SyntaxError) {
                }

                // we go through all prefixes even if we already found one,
                // because one overrides the other
            }

            if(!data) {
                return [];
            }
        }

        let possible_edges = ["reels_media", "tray"];
        
        let edges = [];

        const sendItemsToAPI = function(dataToSend) {
            // Upload the data to the API via POST
            fetch(`${firebase_url}/add?project=${firebase_project}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': firebase_key },
                body: JSON.stringify(dataToSend),
            })
                .then(response => {
                if (response.ok) {
                    console.log(response)
                    console.log('Data uploaded successfully');
                } else {
                    console.error('Failed to upload data:', response.statusText);
                }
                })
                .catch(error => {
                console.error('Error uploading data:', error.message);
                });
            };
    

        const traverse = function (obj) {
            for (const property in obj) {
              if (obj.hasOwnProperty(property) && possible_edges.includes(property)) {
                console.log("Traversing:", property);
          
                // Check if the property is an array before using forEach
                if (Array.isArray(obj[property])) {
                  obj[property].forEach(function (item) {
                    const user = item.user;
                    const reelItems = item.items;

                    if (reelItems && reelItems.length > 0) {
                        reelItems.forEach(function (reel) {
                            const edge = {
                                ...reel, // Spread operator to include all properties from the 'reel' object
                                user: {
                                    ...user,
                                },
                            };
                            edges.push(edge);
                        });
                    }
                });
                }
              }
            }
          };
          
        traverse(data);
    
        // Upload data to firebase
        sendItemsToAPI(edges);
        return edges;
    }
);