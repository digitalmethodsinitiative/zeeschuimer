zeeschuimer.register_module(
    'Gab',
    'gab.com',
    function (response, source_platform_url, source_url) {
      let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

      if (
        !["gab.com"].inclues(domain) 
        || (
            source_url.indexOf('explore') < 0
          && source_url.indexOf('video') < 0
          )
      ) {
        return [];
      }

      let data;
      let posts = [];
      try {
        data = JSON.parse(response);
      } catch (SyntaxError) {
          return [];
      }

      let traverse = function (obj) {
        for (let property in obj) {
            let child = obj[property]
            if (!child) {
                continue;
            }
            if (
                (
                    child.hasOwnProperty('s')
                )
            ) {
                for (let entry in child['s']) {
                    post = child['s'][entry];
                    posts.push(post);
                }
                
            }
        }
      }

      traverse(data);
      return posts;
    }
);
