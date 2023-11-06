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

        // Handling posts in "explore"
        if ((source_url.indexOf('explore?') >= 0 || source_url.indexOf('home?') >= 0) && data.s && Array.isArray(data.s)) {
            for (let post of data.s) {
                let transformedPost = {
                    id: post.i,
                    created_at: post.ca,
                    content: post.c,
                    url: post.ul,
                    account: {
                      id: post.ai,
                      username: "",
                      display_name: "",
                      url: "",
                      avatar: ""  
                    }
                };
                items.push(transformedPost);
            }
        }

        // Handling posts in "search"
        if (source_url.indexOf('search?type=status') >= 0 && data.statuses && Array.isArray(data.statuses)) {
            for (let post of data.statuses) {
                let transformedPost = {
                    id: post.id,
                    created_at: post.created_at,
                    content: post.content,
                    url: post.url,
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