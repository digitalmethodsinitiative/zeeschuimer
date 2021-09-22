zeeschuimer.register_module(
    "tiktok.com",
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        if (domain !== 'tiktok.com') {
            return [];
        }

        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        if (!data["itemList"]) {
            return [];
        }

        return data["itemList"];
    }
)