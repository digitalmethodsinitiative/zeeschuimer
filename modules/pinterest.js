zeeschuimer.register_module(
    'Pinterest',
    "pinterest.com",
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        if (!domain.endsWith('pinterest.com')) {
            return [];
        }

        /**
         * Some data is embedded in the page rather than loaded asynchronously.
         * This here extracts it!
         */
        if(!response) {
            return [];
        }

        let pins = [];
        let data = [];

        try {
            if(response.indexOf('<!DOCTYPE html>') >= 0) {
                throw new Error();
            }
            // when dealing with JSON, just parse that JSON and process it
            const json_data = JSON.parse(response);
            data.push(json_data);
        } catch (e) {
            // data is not JSON, so it's probably HTML
            // HTML has data embedded in <script> tags
            // store these for processing
            const code_regex = RegExp(/<script data-relay-response="true" type="application\/json">([^<]+)<\/script>/g);

            for (const code_bit of response.matchAll(code_regex)) {
                try {
                    // use he to decode from HTML entities (the way the data is embedded)
                    data.push(JSON.parse(he.decode(code_bit[1].trim())));
                } catch (e) {
                }
            }

            // now extract some stuff from the HTML by making a DOM tree and pulling from it
            // this is far less complete than the json objects, but good enough that it might
            // be useful for a researcher
            if(response.indexOf('<!DOCTYPE html>') >= 0) {
                const dummyDocument = new DOMParser().parseFromString(response, 'text/html');
                const embedded_pins = dummyDocument.querySelectorAll("article[data-test-id='bestPin']");
                for(const embedded_pin of embedded_pins) {
                    const mapped_pin = {
                        'id': embedded_pin.querySelector('a').getAttribute('href').replace(/\/$/, '').split('/').pop().split('-').pop(),
                        'tags': Array.from(embedded_pin.querySelectorAll('div[data-test-id="vase-tag"]')).map(x => { return x.querySelector('a').innerText }),
                        'title': embedded_pin.querySelector('h2') ? embedded_pin.querySelector('h2').innerText : '',
                        'body': embedded_pin.querySelector('h3') ? embedded_pin.querySelector('h3').innerText : '',
                        'pins': Array.from(embedded_pin.querySelectorAll('div')).pop().innerText,
                        'image': embedded_pin.querySelector('img').getAttribute('src'),
                        '_zs-origin': 'html'
                    };
                    pins.push(mapped_pin);
                }
            }


        }

        const traverse = function (obj) {
            for (const property in obj) {
                if (!obj.hasOwnProperty(property) || !obj[property]) {
                    // not actually a property
                    continue;
                }

                if (
                    // post page recommendations: https://www.pinterest.com/pin/507921664242278249/
                    (obj[property].hasOwnProperty('__isNode') && obj[property]['__isNode'] === 'Pin')
                    // ideas page: https://www.pinterest.com/ideas/2024-summer-olympics/920026959546/
                    // board page: https://www.pinterest.com/nahidessa/spiritual-groups/
                    // user page: https://www.pinterest.com/walmart/
                    // search results: https://www.pinterest.com/search/pins/?q=Aesthetic%20vibes
                    || (obj[property].hasOwnProperty('type') && obj[property]['type'] === 'pin')
                    // front page: https://www.pinterest.com/ideas/
                    // main explore page
                    || (obj[property].hasOwnProperty('__typename') && obj[property]['__typename'] === 'Pin' && property === 'node')
                    // have also seen this one somewhere, but can't see where now...
                    || (obj.hasOwnProperty('__typename') && obj['__typename'] === 'V3GetPin' && property === 'data')
                ) {
                    let post = obj[property];
                    if(!post.hasOwnProperty('images') || !post.hasOwnProperty('pinner')) {
                        // incomplete post... sometimes happens on 'find similar pins' page
                        continue;
                    }
                    if(post.hasOwnProperty('entityId')) {
                        post['id'] = post['entityId'];
                    }
                    post['_zs-origin'] = 'json';
                    pins.push(post);
                } else if (typeof (obj[property]) === "object") {
                    traverse(obj[property]);
                }
            }
        }

        for(const data_bit of data) {
            traverse(data_bit);
        }
        return pins;
    }
)