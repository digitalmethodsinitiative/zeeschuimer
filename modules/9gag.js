zeeschuimer.register_module(
    '9GAG',
    '9gag.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["9gag.com"].includes(domain)) {
            return [];
        }


        /**
         * Some data is embedded in the page rather than loaded asynchronously.
         * This here extracts it!
         */
        let embedded_sigil_start = /(window\._config = JSON.parse\()/mg;
        let embedded_sigil_end = /(\);<\/script>)/mg;
        let data;
        if(embedded_sigil_start.test(response)) {
            response = response.split(embedded_sigil_start)[2];
            if(!embedded_sigil_end.test(response)) {
                return [];
            }
            try {
                response = JSON.parse(response.split(embedded_sigil_end)[0]);
            } catch (e) {
                return [];
            }
        } else {
            try {
                data = JSON.parse(response);
            } catch (SyntaxError) {
                return [];
            }
        }

        if(!("data" in data) || typeof data["data"] !== 'object' || !("posts" in data["data"])) {
            return [];
        }

        return data["data"]["posts"];
    }
);