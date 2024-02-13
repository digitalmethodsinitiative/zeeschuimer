// Function to remove HTML tags using a DOM Parser
function removeHtmlTagsUsingDOMParser(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    return doc.body.textContent || "";
}

// Registering the module with Zeeschuimer
zeeschuimer.register_module(
    'Gab',
    'gab.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        // Check if the domain is gab.com and the source_url corresponds to the expected endpoints
        if (!["gab.com"].includes(domain)) {
            return [];
        }

        let data;
        let items = []; // Could be posts, groups, or users
        
        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }


        /// first, capture posts in explore, groups, or from a user's profile
        if ((source_url.indexOf('explore?') >= 0 || source_url.indexOf('timelines/group/') >= 0 || source_url.indexOf('accounts/')) && data.s && Array.isArray(data.s)) {
            for (let post of data.s) {
                post["id"] = post.i;
                post["c"] = removeHtmlTagsUsingDOMParser(post.c);
                post["link_info"] = null;
                post["image_info"] = null;
                for (let author of data.a) {
                    if (author.i == post.ai) {
                        if (author["nt"]) {
                            author["nt"] = removeHtmlTagsUsingDOMParser(author.nt);
                        }
                        post["author_info"] = author;
                    }
                }
                if (post.pci) {
                    for (let link of data.pc) {
                        if (post.pci == link.id) {
                            post["link_info"] = link;
                        }
                    }
                }
                if (post.mai) {
                    let images = [];
                    for (let post_image of post.mai) {
                        for (let image of data.ma) {
                            if (post_image == image.i) {
                                images.push(image);
                            }
                        }
                    }
                    post["image_info"] = images;
                }
                items.push(post);
            }
        }
        return items;
    }
);