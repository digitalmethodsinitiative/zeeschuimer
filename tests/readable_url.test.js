/**
 * Tests for readable_url in js/lib.js.
 *
 * readable_url is a copy of the function of the same name in 4CAT's
 * common/lib/helpers.py, and both must give the same result, because the
 * map_item functions in modules/ are compared with 4CAT's. These cases are the
 * ones 4CAT's tests/test_readable_url.py checks, with the same expected
 * results. The one part left out here is 4CAT's unpacking of URLs that were
 * saved with the whole URL encoded ("https%3A%2F%2F..."), which Zeeschuimer
 * never sees.
 *
 * setup-globals.cjs puts readable_url and URL_ENCODED_CHARACTERS into scope.
 */

describe('readable_url', () => {
    describe('readable text is decoded', () => {
        test.each([
            ['https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F?aid=1&type=general',
                'https://www.douyin.com/search/美食?aid=1&type=general'],
            ['https://www.instagram.com/explore/tags/caf%C3%A9/?hl=en',
                'https://www.instagram.com/explore/tags/café/?hl=en'],
            ['https://example.com/?q=%E5%BE%AE%E5%8D%9A%20%E7%83%AD%E6%90%9C',
                'https://example.com/?q=微博%20热搜'],
            ['https://x.com/search?q=%23%D9%85%D8%B1%D8%AD%D8%A8%D8%A7&src=typeahead_click',
                'https://x.com/search?q=%23مرحبا&src=typeahead_click'],
            ['https://example.com/?q=it%E2%80%94works%20%E2%9C%9D%EF%B8%8F%20%F0%9F%98%80',
                'https://example.com/?q=it—works%20✝\ufe0f%20😀'],
            ['https://example.com/#%E8%AF%9D%E9%A2%98', 'https://example.com/#话题'],
            // lowercase escapes are decoded too
            ['https://example.com/?q=%e7%be%8e', 'https://example.com/?q=美'],
        ])('%s', (url, expected) => {
            expect(readable_url(url)).toBe(expected);
        });
    });

    describe('encoded plain characters stay as they are', () => {
        test.each([
            // a hashtag search: decoding %23 would make "#blessed" a fragment and the search empty
            'https://www.instagram.com/explore/search/keyword/?q=%23blessed',
            'https://x.com/search?q=%23hashtag%20lang%3Aen&src=typed_query&f=live',
            'https://www.tiktok.com/@someone/video/7567473806386760982?q=%23tag&t=1767714509282',
            // encoded & and = are part of a value, not separators
            'https://example.com/?q=%3D%26&r=%23',
            // + means a space in a query; %2B is a plus sign
            'https://example.com/search?q=a%2Bb',
            'https://example.com/search?q=a+b',
            // a URL that was encoded twice stays that way, as the site wrote it
            'https://example.com/search?q=a%252Bb',
            'https://example.com/search?q=%2520',
            'https://www.xiaohongshu.com/search_result?keyword=%25E5%2590%258C%25E4%25BA%25BAAI&source=web_explore_feed',
            'https://nl.pinterest.com/search/pins/?q=covers%20aesthetic&source_module_id=OB_covers%2520aesthetic'
                + '&add_refine=Covers%7Cguide%7Cword%7C3',
            // an encoded / ? # % or space in the path is not a separator either
            'https://example.com/a%2Fb%3Fc/d%20e/100%25',
            // a URL in a parameter stays as it was: encoded, or not
            'https://weibo.com/newlogin?tabtype=weibo&gid=102803&openLoginLayer=0&url=https%3A%2F%2Fweibo.com%2F',
            'https://weibo.com/newlogin?tabtype=weibo&gid=102803&openLoginLayer=0&url=https://weibo.com/',
            'https://www.instagram.com/accounts/onetap/?next=%2F',
            // the page reads the fragment itself
            'https://example.com/#/route?tab=1%202',
            // letters and digits
            'https://example.com/?q=%41%31',
            // quotation marks would end the link in 4CAT's preview
            'https://www.linkedin.com/search/results/content/?datePosted=%22past-month%22&keywords=ai%20coding'
                + '&sid=j).&sortBy=%22relevance%22',
        ])('%s', (url) => {
            expect(readable_url(url)).toBe(url);
        });
    });

    describe('nothing is reordered, merged or dropped', () => {
        test.each([
            'https://example.com/?a=1&b=2&a=3',
            'https://example.com/?a=1&b=2&a=3&a=',
            'https://example.com/?a=&b&=c&&d=',
            'https://example.com/?&&',
            'https://example.com/?',
            'https://example.com/?q=1#',
            'https://example.com/a;?q=1',
            'https://example.com/a;b/c;d?k=v;w=x',
            'HTTPS://Example.COM/Path?Q=1',
            'https://[::1]:8080/?q=1',
            'https://[fe80::1%25eth0]/?q=1',
            'https://user:pw@[2001:db8::1]:443/?q=1',
            'https://weibo.com/7786617255/RmncIsrT0?from=feed#comment',
            'view-source:https://www.tiktok.com/@someone',
            'mailto:someone@example.com?subject=hi',
            'http:path?q=1',
            '//example.com/?q=1',
            '/relative/path?q=1',
        ])('%s', (url) => {
            expect(readable_url(url)).toBe(url);
        });
    });

    describe('what a URL cannot contain is encoded', () => {
        test.each([
            ['https://example.com/search?q=hello world', 'https://example.com/search?q=hello%20world'],
            ['https://example.com/搜索?q=微博 热搜&tag=#话题#', 'https://example.com/搜索?q=微博%20热搜&tag=#话题#'],
            ['https://example.com/?q=1#frag ment?x=1', 'https://example.com/?q=1#frag%20ment?x=1'],
            ['https://example.com/?a=say "hi"&b=<b>', 'https://example.com/?a=say%20%22hi%22&b=%3Cb%3E'],
            ['https://example.com/{a|b}^`', 'https://example.com/%7Ba%7Cb%7D%5E%60'],
            ['https://example.com/?a=\x01\x7f', 'https://example.com/?a=%01%7F'],
            ['mailto:someone@example.com?subject=hi there', 'mailto:someone@example.com?subject=hi%20there'],
            ['not a url', 'not%20a%20url'],
        ])('%s', (url, expected) => {
            expect(readable_url(url)).toBe(expected);
        });

        test('a backslash is left alone, since browsers read it as "/" in the path', () => {
            expect(readable_url('https://example.com/a\\b?q=c\\d')).toBe('https://example.com/a\\b?q=c\\d');
        });
    });

    describe('invisible characters stay visible', () => {
        test.each([
            // already encoded: zero-width space, no-break space, right-to-left override, BOM, ideographic space
            ['https://example.com/?a=%E2%80%8B&b=%C2%A0&c=%E2%80%AE&d=%EF%BB%BF&e=%E3%80%80',
                'https://example.com/?a=%E2%80%8B&b=%C2%A0&c=%E2%80%AE&d=%EF%BB%BF&e=%E3%80%80'],
            // not encoded
            ['https://example.com/?a=x\u200by&b=x\u00a0y&c=\u202eabc&d=\ufeff&e=x\u3000y',
                'https://example.com/?a=x%E2%80%8By&b=x%C2%A0y&c=%E2%80%AEabc&d=%EF%BB%BF&e=x%E3%80%80y'],
            // visible text next to an invisible character is still decoded
            ['https://example.com/?q=%E7%BE%8E%E2%80%8B%E9%A3%9F', 'https://example.com/?q=美%E2%80%8B食'],
            // the replacement character means some other program could not read the text
            ['https://example.com/?q=%EF%BF%BD', 'https://example.com/?q=%EF%BF%BD'],
        ])('%s', (url, expected) => {
            expect(readable_url(url)).toBe(expected);
        });

        test('emoji joiners and selectors are shown', () => {
            const family = '%F0%9F%91%A8%E2%80%8D%F0%9F%91%A9%E2%80%8D%F0%9F%91%A7';
            expect(readable_url(`https://example.com/?q=${family}`)).toBe('https://example.com/?q=👨\u200d👩\u200d👧');
            expect(readable_url('https://example.com/?q=%E2%9D%A4%EF%B8%8F')).toBe('https://example.com/?q=❤\ufe0f');
        });
    });

    describe('what cannot be decoded is left as it is', () => {
        test.each([
            // cut off in the middle of a character: the whole run stays encoded
            'https://example.com/?q=%E5%BE%AE%E5',
            'https://example.com/?q=%E5%BE%AE%E5%E5%8D%9A',
            // not valid UTF-8 at all
            'https://example.com/?q=%ED%A0%80&r=%F0%80%80&s=%C0%AF&t=%FF',
            // Chinese in an older encoding (GBK): decoding parts of it would show the wrong characters
            'https://example.com/?q=%C3%C0%CA%B3',
            // a % that does not start an escape
            'https://example.com/?q=%zz&r=%4&s=%%41&t=100%',
        ])('%s', (url) => {
            expect(readable_url(url)).toBe(url);
        });
    });

    describe('clean-up and odd input', () => {
        test.each([
            ['  https://example.com/?q=1', 'https://example.com/?q=1'],
            ['\thttps://exa\nmple.com/?q=1\r', 'https://example.com/?q=1'],
            ['https://example.com/?q=a\tb', 'https://example.com/?q=ab'],
            ['', ''],
            [null, ''],
            [undefined, ''],
            [12345, '12345'],
        ])('%p', (url, expected) => {
            expect(readable_url(url)).toBe(expected);
        });

        test('half of a two-part character passes through', () => {
            expect(readable_url('https://example.com/?a=\ud800')).toBe('https://example.com/?a=\ud800');
        });
    });

    describe('running it again changes nothing', () => {
        // the same kind of troublesome pieces as 4CAT's test uses
        const pieces = [...'abcXYZ019-._~:/?#[]@!$&\'()*+,;=%" <>\\^`{|}'].concat([
            '\t', '\n', '\x01', '\x7f', '\u00a0', '\u200b', '\u202e', '\u3000', '\ufeff', '\ufffd', '\u{1f600}',
            '\u{e0001}', '\ue000', '美', 'é', '✝\ufe0f', '%E7%BE%8E', '%e7%be%8e', '%C3%A9', '%E2%80%8B', '%C2%A0',
            '%E2%80%AE', '%EF%BB%BF', '%EF%BF%BD', '%F0%9F%98%80', '%E5', '%BE', '%E5%BE', '%ED%A0%80', '%C0%AF',
            '%F4%90%80%80', '%C3%C0%CA%B3', '%25', '%2525', '%23', '%26', '%3D', '%2B', '%20', '%3A', '%2F', '%5C',
            '%41', '%7F', '%01', '%zz', '%4', '%',
        ]);
        const prefixes = ['https://example.com/', 'https://example.com/p?q=', 'https://example.com/?a=1#', '', '  https://x.com/'];

        // a small seeded generator, so every run tests the same inputs
        let seed = 4;
        const next = (n) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % n;
        };
        const urls = Array.from({ length: 2000 }, () =>
            prefixes[next(prefixes.length)] + Array.from({ length: 1 + next(12) }, () => pieces[next(pieces.length)]).join(''));

        const encoded_characters = new RegExp(URL_ENCODED_CHARACTERS.source);
        const ascii_escapes = /%[0-7][0-9A-Fa-f]/g;

        test.each(urls)('%j', (url) => {
            const result = readable_url(url);
            expect(readable_url(result)).toBe(result);

            // the result holds nothing that should have been encoded...
            expect(encoded_characters.test(result)).toBe(false);

            // ...and every encoded plain character is still there
            expect((result.match(ascii_escapes) || []).length).toBeGreaterThanOrEqual((url.match(ascii_escapes) || []).length);
        });
    });
});
