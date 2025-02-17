zeeschuimer.register_module(
    'Threads',
    'threads.net',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["threads.net"].includes(domain)) {
            return [];
        }

        let edges = [];
        let datas = [];
        try {
            // if it's JSON already, just parse it
            datas.push(JSON.parse(response));
        } catch {
            // data can be embedded in the HTML in these JavaScript statements
            // this is identical to Instagram (see instagram.js)

            let js_prefixes = [
                "{\"require\":[[\"ScheduledServerJS\",\"handle\",null,[{\"__bbox\":{\"require\":[[\"RelayPrefetchedStreamCache\",\"next\",[],["
            ];

            let prefix;
            
            while (js_prefixes.length > 0) {
                prefix = js_prefixes.shift();

                // we go through the response line by line, because prefixes may
                // occur multiple times but always on a single line
                for (const line of response.split("\n")) {
                    if (line.indexOf(prefix) === -1) {
                        // prefix not found
                        continue;
                    }

                    let json_bit = line.split(prefix.slice(0, -1))[1].split('</script>')[0].trim();
                    if (json_bit.endsWith(';')) {
                        json_bit = json_bit.substring(0, -1);
                    }

                    if (prefix.indexOf("additionalDataLoaded") !== -1) {
                        // remove trailing )
                        json_bit = json_bit.slice(0, -1);
                    } else if (js_prefixes.length === 0) {
                        // last prefix has some special handling
                        // remove trailing stuff...
                        json_bit = json_bit.split(']]}}')[0];
                    }


                    try {
                        datas.push(JSON.parse(json_bit));
                    } catch {
                        // fine, not JSON after all
                    }
                }
            }

            if (datas.length === 0) {
                // console.log('no datas for ' + source_url);
                return [];
            }
        }

        return [...traverse_data(datas, function (item, property) {
            if (property === 'post' && item['pk'] && item['code']) {
                return item;
            }
        })]
    }
);