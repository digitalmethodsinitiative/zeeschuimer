zeeschuimer.register_module(
    'Parler',
    'parler.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split('/')[2].toLowerCase().replace(/^www\./, '');
        if (domain !== 'parler.com' && domain !== 'api.parler.com') {
            return [];
        }

        if (source_url.indexOf('/trending/') !== -1) {
            return [];
        }

        let data;
        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        if ("data" in data) {
            // search results "top results" (i.e. not the video tab)
            let r = Object.values(data['data']);
            let useable_items = [];
            if (r.length === 0) {
                return [];
            }
            let items = r.filter(x => x && x.hasOwnProperty('postuuid'));
            let known_fields = ['body', 'user'];
            for (let i in items) {
                let item = items[i];
                let item_ok = true;
                for (let j in known_fields) {
                    if (!item.hasOwnProperty(known_fields[j])) {
                        item_ok = false;
                    }
                }

                if(item['ad']) {
                    item_ok = false;
                }

                if (item_ok) {
                    item['id'] = item['postuuid'];
                    useable_items.push(item);
                }
            }
            return useable_items;
        } else {
            return [];
        }
    }
)