zeeschuimer.register_module(
    'Gab',
    'gab.com',
    function (response, source_platform_url, source_url) {
      let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');
      console.log('domain:', domain);
      if (
        !["gab.com"].includes(domain) 
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
        console.log('traversing!');
        console.log('object keys:', Object.keys(obj));
        let s = obj['s'];
        for (let postnum in Object.keys(s)) {
          let post = s[postnum];
          console.log('post', Object.keys(post));
          post['id'] = post['i'];
          posts.push(post);
        }
      }

      traverse(data);
      return posts;
    }
);
