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

        // Handling posts in explore, in a group, or on a user's profile
        if ((source_url.indexOf('explore?') >= 0 || source_url.indexOf('timelines/group/') >= 0 || source_url.indexOf('accounts/')) && data.s && Array.isArray(data.s)) {
            for (let post of data.s) {
                let transformedPost = {
                    type: "post",
                    id: post.i,
                    created_at: post.ca,
                    content: removeHtmlTagsUsingDOMParser(post.c),
                    url: post.ul,
                    group: post.g ? post.g.id : null,
                    account: {
                      id: post.ai,
                      username: null,
                      display_name: null,
                      url: null,
                      avatar: null 
                    }
                };
                items.push(transformedPost);
            }
        }

        // Handling posts in search, since it's different for whatever reason
        if (source_url.indexOf('search?type=status') >= 0 && data.statuses && Array.isArray(data.statuses)) {
            for (let post of data.statuses) {
                let transformedPost = {
                    type: "post",
                    id: post.id,
                    created_at: post.created_at,
                    content: removeHtmlTagsUsingDOMParser(post.content),
                    url: post.url,
                    group: post.g ? post.g.id : null,
                    account: {
                        id: post.account.id,
                        username: post.account.username,
                        display_name: post.account.display_name,
                        url: post.account.url,
                        avatar: post.account.avatar
                    }
                };
                items.push(transformedPost);
            }
        }

        // Handling groups
        if (source_url.indexOf('groups') >= 0 && Array.isArray(data) && 'member_count' in data[0]) {
            for (let group of data) {
                let transformedGroup = {
                    type: "group",
                    id: group.id,
                    created_at: group.created_at,
                    url: group.url,
                    account: {
                        title: group.title,
                        description: group.description,
                        member_count: group.member_count,
                        is_verified: group.is_verified,
                        is_private: group.is_private,
                        category: group.group_category ? group.group_category.text : null
                    }
                };
                items.push(transformedGroup);
            }
        }

        // Handling user information
        if (source_url.indexOf('/users/') >= 0 && data.hasOwnProperty('id') && data.hasOwnProperty('username') && data.username.trim() !== '') {
            let transformedUser = {
                type: "user",
                id: data.id,
                created_at: data.created_at,
                url: data.url,
                account: {
                    username: data.username,
                    display_name: data.display_name,
                    note: data.note,
                    avatar: data.avatar,
                    followers_count: data.followers_count,
                    following_count: data.following_count,
                    statuses_count: data.statuses_count,
                    is_pro: data.is_pro,
                    is_verified: data.is_verified,
                    is_donor: data.is_donor,
                    is_investor: data.is_investor,
                    show_pro_life: data.show_pro_life,
                    is_parody: data.is_parody,
                }
            };
            items.push(transformedUser);
        }
        
        return items;
    }
);