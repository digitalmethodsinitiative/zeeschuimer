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
                let post_author = post.ai;
                let has_link = "no";
                let has_image = "no";
                let author_info = {
                    id: null,
                    username: null,
                    account: null,
                    display_name: null,
                    note: null,
                    avatar: null
                }
                let image_info = {
                    id: null,
                    url: null,
                    type: null
                }
                let link_info = {
                    id: null,
                    url: null,
                    title: null,
                    description: null,
                    type: null,
                    image: null
                }


                if (post.pci) {
                    has_link = "yes";
                    post_link = post.pci;
                    for (let link of data.pc) {
                        if (post_link == link.id) {
                            link_info = {
                                id: link.id,
                                url: link.url,
                                title: link.title,
                                description: link.description,
                                type: link.type,
                                image: link.image
                            }
                        }
                    }
                }
                if (post.mai) {
                    has_image = "yes";
                    post_image = post.mai[0];
                    for (let image of data.ma) {
                        if (post_image == image.i) {
                            image_info = {
                                id: image.i,
                                url: image.u,
                                type: image.type,
                            }
                        }
                    }
                }
                for (let author of data.a) {
                    if (author.i == post_author) {
                        author_info = {
                            id: author.i,
                            username: author.un,
                            account: author.ac,
                            display_name: author.dn,
                            note: author.nt,
                            avatar: author.avatar
                        }
                    }
                }
                let transformedPost = {
                    id: post.i,
                    created_at: post.ca,
                    content: removeHtmlTagsUsingDOMParser(post.c),
                    url: post.ul,
                    reaction_count: post.fc ? post.fc : 0,
                    reposts_count: post.rbc,
                    replies_count: post.rc,
                    group: {
                        id: post.g ? post.g.id : null,
                        title: post.g ? post.g.title : null,
                        description: post.g ? removeHtmlTagsUsingDOMParser(post.g.description) : null,
                        member_count: post.g ? post.g.member_count : null,
                        is_private: post.g ? post.g.is_private : null,
                        url: post.g ? post.g.url : null,
                        created_at: post.g ? post.g.created_at : null
                    },
                    account: {
                        id: author_info.id,
                        username: author_info.username,
                        account: author_info.account,
                        display_name: author_info.display_name,
                        note: removeHtmlTagsUsingDOMParser(author_info.note),
                    },
                    link: {
                        id: has_link == "yes" ? link_info.id : null,
                        url: has_link == "yes" ? link_info.url : null,
                        title: has_link == "yes" ? link_info.title : null,
                        description: has_link == "yes" ? link_info.description: null,
                        type: has_link == "yes" ? link_info.type : null,
                        image: has_link == "yes" ? link_info.image : null
                    },
                    image: {
                        id: has_image == "yes" ? image_info.id : null,
                        url: has_image == "yes" ? image_info.url : null,
                        type: has_image == "yes" ? image_info.type : null
                    }
                };
                items.push(transformedPost);
            }
        }
        return items;
    }
);