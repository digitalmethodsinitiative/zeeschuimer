zeeschuimer.register_module(
    'instagram.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        if (domain !== 'instagram.com') {
            return [];
        }

        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            if (response.indexOf('window._sharedData = {') === -1) {
                return [];
            }
            let json_bit = response.split('window._sharedData = ')[1].split(';</script>')[0];
            try {
                data = JSON.parse(json_bit);
            } catch (SyntaxError) {
                // embedded data can't be parsed as JSON
                return [];
            }

            try {
                data = {"data": data["entry_data"]["ProfilePage"][0]["graphql"]}
            } catch (TypeError) {
                // some other data was embedded
                return [];
            }
        }

        try {
            return data["data"]["user"]["edge_owner_to_timeline_media"]["edges"];
        } catch (TypeError) {
            // not instagram or tiktok, unknown
            return [];
        }
    }
);