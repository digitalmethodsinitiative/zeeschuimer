zeeschuimer.register_module(
    'Gab',
    'gab.com',
    function (response, source_platform_url, source_url) {
      let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

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
        for (let property in obj) {
          console.log('property', property);
          if (property == 's') {
            for (let entry in property) {
              console.log('entry', entry);
              let post = property[entry];
              console.log('post', post);
              posts.push(post);
            }
          }
        }
      }

      traverse(data);
      return posts;
    }
);
