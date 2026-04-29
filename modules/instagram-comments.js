zeeschuimer.register_module(
    'Instagram (comments)',
    'instagram.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["instagram.com"].includes(domain)) {
            return [];
        }

        const lower_source_url = source_url.toLowerCase();
        const looks_like_comments_request = lower_source_url.indexOf('/comments') >= 0
            || lower_source_url.indexOf('comments') >= 0
            || lower_source_url.indexOf('comment') >= 0;

        if (!looks_like_comments_request) {
            return [];
        }

        let data;
        try {
            if (response.startsWith("for (;;);")) {
                response = response.slice("for (;;);".length);
            }
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        const media_id_match = source_url.match(/\/media\/([^\/?]+)\/comments/i);
        const shortcode_match = source_platform_url.match(/\/(p|reel|reels)\/([^\/?#]+)/i);
        const post_id_from_url = media_id_match ? media_id_match[1] : null;
        const post_type = shortcode_match ? shortcode_match[1].replace('reels', 'reel') : 'p';
        const post_shortcode = shortcode_match ? shortcode_match[2] : null;
        const post_url = post_shortcode ? 'https://www.instagram.com/' + post_type + '/' + post_shortcode + '/' : source_platform_url;

        let comments = [];
        let seen = new Set();

        const normalise_user = function (user) {
            if (!user) {
                return null;
            }

            const user_id = user['pk'] || user['pk_id'] || user['id'];

            return {
                id: user_id ? String(user_id) : undefined,
                unique_id: user['username'],
                nickname: user['full_name'],
                avatar_thumb: user['profile_pic_url'],
                verified: !!user['is_verified'],
                is_private: !!user['is_private']
            };
        };

        const add_comment = function (comment, parent_comment_id=null) {
            if (!comment || typeof comment !== "object") {
                return;
            }

            const comment_id = comment['pk'] || comment['id'];
            const text = comment['text'];
            const user = normalise_user(comment['user'] || comment['owner']);
            const post_id = comment['media_id'] || comment['media_pk'] || post_id_from_url;

            if (!comment_id || !text || !user || !post_id) {
                return;
            }

            if (seen.has(String(comment_id))) {
                return;
            }
            seen.add(String(comment_id));

            comment['id'] = String(comment_id);
            comment['comment_id'] = String(comment_id);
            comment['text'] = text;
            comment['user'] = user;
            comment['post_id'] = String(post_id);
            comment['post_shortcode'] = post_shortcode;
            comment['post_url'] = post_url;
            comment['parent_comment_id'] = parent_comment_id ? String(parent_comment_id) : null;
            comment['thread_id'] = String(post_id);
            comment['_zs_comment_parent_id'] = parent_comment_id ? String(parent_comment_id) : String(post_id);
            comment['_zs_comment_thread_id'] = String(post_id);
            comment['_zs_comment_post_id'] = String(post_id);

            comments.push(comment);
        };

        const traverse = function (obj, parent_comment_id=null) {
            if (!obj || typeof obj !== "object") {
                return;
            }

            if (Array.isArray(obj)) {
                for (const item of obj) {
                    traverse(item, parent_comment_id);
                }
                return;
            }

            if ((obj['pk'] || obj['id']) && obj['text'] && (obj['user'] || obj['owner'])) {
                add_comment(obj, parent_comment_id);

                const comment_id = obj['pk'] || obj['id'];
                for (const replies_key of ['child_comments', 'preview_child_comments', 'inline_child_comments']) {
                    if (Array.isArray(obj[replies_key])) {
                        for (const reply of obj[replies_key]) {
                            traverse(reply, comment_id);
                        }
                    }
                }
                return;
            }

            for (let property in obj) {
                if (!obj.hasOwnProperty(property) || !obj[property]) {
                    continue;
                }

                if (property === 'comments' && Array.isArray(obj[property])) {
                    for (const comment of obj[property]) {
                        traverse(comment, parent_comment_id);
                    }
                } else if (property === 'edges' && Array.isArray(obj[property])) {
                    for (const edge of obj[property]) {
                        traverse(edge && edge['node'] ? edge['node'] : edge, parent_comment_id);
                    }
                } else if (typeof obj[property] === "object") {
                    traverse(obj[property], parent_comment_id);
                }
            }
        };

        traverse(data);
        return comments;
    },
    'instagram-comments'
);
