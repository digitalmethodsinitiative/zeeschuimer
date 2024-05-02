// Function to remove HTML tags using a DOM Parser
function removeHtmlTagsUsingDOMParser(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    return doc.body.textContent || "";
}

// Registering the module with Zeeschuimer
zeeschuimer.register_module(
    'Truth Social',
    'truthsocial.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["truthsocial.com"].includes(domain)) {
            return [];
        }

        let data;
        let items = [];

        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        function processPost(post) {
            if (!post.account) return null;
            post.content = removeHtmlTagsUsingDOMParser(post.content || "");
            return post;
        }

        if ((source_url.includes('following') || source_url.includes('truths') || source_url.includes('groups')) && Array.isArray(data)) {
            items = data.map(post => processPost(post));
        }

        return items;
    }
);
