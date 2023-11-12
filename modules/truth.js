zeeschuimer.register_module(
    'Truth Social',
    'truthsocial.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
        // Check if the domain is gab.com and the source_url corresponds to the expected endpoints
        if (!["truthsocial.com"].includes(domain)) {
            return [];
        }

        let data;
        let items = []; // Could be posts, groups, or users

        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        // Handling posts in "following"
        if (source_url.indexOf('following') && Array.isArray(data)) {
            console.log("yuh");
            for (let post of data) {
                let urls = [];
                /*
                for (let attachment of post.media_attachments) {
                    urls.push(attachment.url);
                }; */
                let transformedPost = {
                    content: post.content,
                    created_at: post.created_at,
                    favourites: post.favourites_count,
                    id: post.id,
                    //attachment_urls: urls,
                    reblogs_count: post.reblogs_count,
                    replies_count: post.replies_count,
                    account: {
                        avatar: post.account.avatar,
                        display_name: post.account.display_name,
                        followers_count: post.followers_count,
                        following_count: post.following_count,
                        header: post.account.header,
                        note: post.account.note,
                        url: post.account.url
                    }
                };
                items.push(transformedPost);
            }
        }

        return items;
    }
);