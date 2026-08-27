/**
 * Tests for navigation-index bookkeeping in js/zs-background.js.
 *
 * Zeeschuimer tells apart "this item again on the same page" from "this item
 * again on a new page" by the nav index, which nav_handler bumps on every
 * committed navigation. Every duplicate-handling decision downstream depends
 * on that number, and duplicate-behavior.test.js supplies nav_index values as
 * fixtures ('1:1:0', '1:1:1'), so nothing there exercises the code that
 * produces them.
 *
 * These tests run the real background script instead: the file is evaluated
 * the way the browser evaluates it, as a classic script against `Dexie` and
 * `browser` globals, and the functions it defines are called directly.
 */

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKGROUND_SOURCE = readFileSync(join(__dirname, '..', 'js', 'zs-background.js'), 'utf8');
const DB_NAME = 'zeeschuimer-items';

// fake-indexeddb clones every stored record; jsdom does not always provide
// structuredClone.
if (typeof globalThis.structuredClone === 'undefined') {
    globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

/**
 * Enough of the WebExtension API for the background script to load.
 *
 * Only storage.local carries behaviour: the duplicate-handling setting is read
 * from it, and tests vary that. The listener registrations are no-ops because
 * the tests call the handlers themselves rather than waiting on browser events.
 */
function make_browser(settings = {}) {
    const store = { ...settings };
    // parse_request asks the tab for its real URL and falls back to tab id -1
    // when that lookup fails, which would take every capture out of the tab it
    // belongs to. Tests set the URL a tab is currently showing here.
    const tab_urls = new Map();
    return {
        storage: {
            local: {
                get: async (key) => (key in store ? { [key]: store[key] } : {}),
                set: async (values) => { Object.assign(store, values); },
            },
        },
        webRequest: { onBeforeRequest: { addListener() {} }, filterResponseData: () => ({}) },
        webNavigation: { onCommitted: { addListener() {} } },
        browserAction: { onClicked: { addListener() {} }, setIcon() {} },
        runtime: { getURL: (path) => path },
        tabs: {
            get: async (id) => {
                if (!tab_urls.has(id)) throw new Error('no such tab');
                return { id, url: tab_urls.get(id) };
            },
            query: async () => [],
            create() {}, update() {},
        },
        __tab_urls: tab_urls,
    };
}

/**
 * Evaluate js/zs-background.js and wait until it has finished starting up.
 *
 * init() runs at the end of the file but is not awaited there, so the session
 * id it assigns is not available the moment evaluation returns. setInterval is
 * stubbed out first: the script starts an icon-sync timer that would otherwise
 * keep running for the rest of the suite.
 */
async function load_background(settings = {}) {
    const Dexie = (await import('dexie')).default;

    // Each load opens its own connection to the same database name. An earlier
    // one left open blocks the delete below, and the reload then races the
    // schema.
    if (globalThis.db && typeof globalThis.db.close === 'function') {
        globalThis.db.close();
    }
    await Dexie.delete(DB_NAME);

    globalThis.Dexie = Dexie;
    globalThis.browser = make_browser(settings);
    const real_set_interval = globalThis.setInterval;
    globalThis.setInterval = () => 0;
    try {
        new Function(BACKGROUND_SOURCE)();
    } finally {
        globalThis.setInterval = real_set_interval;
    }

    const deadline = Date.now() + 5000;
    while (globalThis.zeeschuimer.session === null) {
        if (Date.now() > deadline) throw new Error('background script did not finish init()');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    return { zeeschuimer: globalThis.zeeschuimer, db: globalThis.db };
}

// Every {session, tab_id} lookup makes Dexie suggest a compound index, and the
// background script does one per navigation. It is advice about the schema
// rather than anything wrong here, and it buries the run in ~70 lines.
let real_warn;
beforeAll(() => {
    real_warn = console.warn;
    console.warn = (...args) => {
        if (typeof args[0] === 'string' && args[0].includes('would benefit of a compound index')) return;
        real_warn(...args);
    };
});
afterAll(() => { console.warn = real_warn; });

/** The stored nav index for a tab, as nav_handler leaves it. */
async function stored_index(db, zeeschuimer, tab_id) {
    const record = await db.nav.where({ session: zeeschuimer.session, tab_id }).first();
    return record ? record.index : null;
}

describe('nav_handler', () => {
    test('assigns a first index and increments it on every navigation', async () => {
        const { zeeschuimer, db } = await load_background();

        // the listener seeds index 0 for a tab it has not seen before
        await db.nav.add({ session: zeeschuimer.session, tab_id: 7, index: 0 });
        expect(await stored_index(db, zeeschuimer, 7)).toBe(0);

        const seen = [];
        for (let navigation = 0; navigation < 4; navigation++) {
            await zeeschuimer.nav_handler(7);
            seen.push(await stored_index(db, zeeschuimer, 7));
        }

        expect(seen).toEqual([1, 2, 3, 4]);
    });

    test('never leaves the index unusable', async () => {
        const { zeeschuimer, db } = await load_background();
        await db.nav.add({ session: zeeschuimer.session, tab_id: 1, index: 0 });

        for (let navigation = 0; navigation < 3; navigation++) {
            await zeeschuimer.nav_handler(1);
            const index = await stored_index(db, zeeschuimer, 1);
            expect(Number.isFinite(index)).toBe(true);
        }
    });

    test('every navigation yields a distinct nav index', async () => {
        const { zeeschuimer, db } = await load_background();
        await db.nav.add({ session: zeeschuimer.session, tab_id: 3, index: 0 });

        const indices = [await stored_index(db, zeeschuimer, 3)];
        for (let navigation = 0; navigation < 5; navigation++) {
            await zeeschuimer.nav_handler(3);
            indices.push(await stored_index(db, zeeschuimer, 3));
        }

        expect(new Set(indices).size).toBe(indices.length);
    });

    test('accepts the object form webNavigation passes', async () => {
        const { zeeschuimer, db } = await load_background();
        await db.nav.add({ session: zeeschuimer.session, tab_id: 12, index: 0 });

        await zeeschuimer.nav_handler({ tabId: 12, url: 'https://example.com/', frameId: 0 });

        expect(await stored_index(db, zeeschuimer, 12)).toBe(1);
    });

    test('counts tabs independently', async () => {
        const { zeeschuimer, db } = await load_background();
        await db.nav.add({ session: zeeschuimer.session, tab_id: 1, index: 0 });
        await db.nav.add({ session: zeeschuimer.session, tab_id: 2, index: 0 });

        await zeeschuimer.nav_handler(1);
        await zeeschuimer.nav_handler(1);
        await zeeschuimer.nav_handler(2);

        expect(await stored_index(db, zeeschuimer, 1)).toBe(2);
        expect(await stored_index(db, zeeschuimer, 2)).toBe(1);
    });
});

/**
 * The behaviour the nav index exists to support.
 *
 * A module is registered that returns the same item every time, so the only
 * thing that changes between calls is whether a navigation happened in
 * between. That is what the duplicate-handling setting is supposed to act on.
 */
describe('duplicate handling across navigations', () => {
    const TAB = 5;
    const PLATFORM = 'example.com';
    // Three pages, not two. A nav index that is merely *wrong* still differs
    // from the initial one, so a single navigation cannot tell a working
    // counter from a stuck one; a second navigation can.
    const PAGES = [
        'https://example.com/feed',
        'https://example.com/explore',
        'https://example.com/tag/cats',
    ];

    async function setup(duplicate_behavior) {
        const loaded = await load_background({ 'zs-duplicate-behavior': duplicate_behavior });
        loaded.zeeschuimer.register_module('Example', PLATFORM, () => [{ id: 'post-1', body: 'hello' }]);
        return loaded;
    }

    /** Capture the same item on `url`, as though the tab had navigated there. */
    async function browse_to(zeeschuimer, url) {
        globalThis.browser.__tab_urls.set(TAB, url);
        await zeeschuimer.parse_request('{}', url, url, TAB, [PLATFORM]);
    }

    test('the same item seen twice on one page is stored once', async () => {
        const { zeeschuimer, db } = await setup('insert');

        await browse_to(zeeschuimer, PAGES[0]);
        await browse_to(zeeschuimer, PAGES[0]);

        expect(await db.items.count()).toBe(1);
    });

    test('"keep duplicates" records the item once per page it appears on', async () => {
        const { zeeschuimer, db } = await setup('insert');

        for (const page of PAGES) {
            await browse_to(zeeschuimer, page);
        }

        expect(await db.items.count()).toBe(PAGES.length);
        const nav_indices = (await db.items.toArray()).map(item => item.nav_index);
        expect(new Set(nav_indices).size).toBe(PAGES.length);
    });

    test('"skip duplicates" keeps only the first sighting', async () => {
        const { zeeschuimer, db } = await setup('skip');

        for (const page of PAGES) {
            await browse_to(zeeschuimer, page);
        }

        expect(await db.items.count()).toBe(1);
    });
});
