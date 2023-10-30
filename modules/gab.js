zeeschuimer.register_module(
    'Gab!',
    'gab.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["gab.com"].includes(domain) || (source_url.indexOf('search?type=status') < 0 && source_url.indexOf('explore?') < 0)) {
            return [];
        }

        let data;
        let posts = [];
        
        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        if (data.s && Array.isArray(data.s)) {
            console.log("exploring!");
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
                posts.push(transformedPost);
            }
        }

        if (data.statuses && Array.isArray(data.statuses)) {
            console.log("searching!")
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
                posts.push(transformedPost);
            }
        }

        return posts;
    }
);