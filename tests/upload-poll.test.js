/**
 * Tests for the 4CAT upload progress poll in popup/interface.js.
 *
 * `upload_poll.init` asks 4CAT whether an uploaded dataset has finished
 * processing, and on completion writes the dataset link into the interface and
 * records the upload. Everything it does happens inside an
 * `onreadystatechange` handler, so which readyState the handler acts on
 * decides whether any of it runs.
 *
 * An XMLHttpRequest reports four readyStates, and only the last one
 * (`DONE`, 4) is guaranteed to carry the whole response body:
 *
 *   2  HEADERS_RECEIVED  status is known, responseText is still empty
 *   3  LOADING           responseText holds whatever has arrived so far
 *   4  DONE              responseText is complete
 *
 * The tests below drive those states explicitly, including the case where the
 * body arrives across two of them, which is what tells a handler reading state
 * 4 apart from one reading state 3.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextEncoder as NodeTextEncoder } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTERFACE_SOURCE = readFileSync(join(__dirname, '..', 'popup', 'interface.js'), 'utf8');

if (typeof globalThis.TextEncoder === 'undefined') {
    globalThis.TextEncoder = NodeTextEncoder;
}

/** A finished check-query response, as 4CAT sends it. */
const COMPLETED = JSON.stringify({
    done: true,
    status: 'Dataset completed.',
    url: 'http://localhost/results/f7b31c256ae30dc451d2fe0d5e37bd4b/',
    rows: 310,
});

/**
 * An XMLHttpRequest whose readyStates are driven by the test.
 *
 * `steps` is replayed in order, each entry setting readyState, status and
 * responseText before the handler is called, so a test can say exactly how
 * much of the body had arrived at each state.
 */
function install_fake_xhr(steps) {
    const seen = [];
    const requests = [];
    function FakeXHR() {
        requests.push(this);
        this.DONE = 4;
        this.readyState = 0;
        this.status = 0;
        this.responseText = '';
    }
    FakeXHR.prototype.open = function (method, url) { this.url = url; };
    FakeXHR.prototype.send = function () {
        this.replay = (async () => {
            for (const step of steps) {
                this.readyState = step.readyState;
                this.status = step.status ?? 200;
                this.responseText = step.responseText ?? '';
                if (this.onreadystatechange) {
                    await this.onreadystatechange();
                }
                // what the interface was showing after this state was handled
                seen.push({
                    readyState: step.readyState,
                    message: document.getElementById('upload-status').innerText,
                    link: document.querySelector('#upload-status a')?.getAttribute('href') ?? null,
                });
            }
        })();
    };
    globalThis.XMLHttpRequest = FakeXHR;

    /**
     * Wait for every request raised so far to finish replaying.
     *
     * init() awaits the stored 4CAT URL before it opens the request, and the
     * completion branch awaits the upload being recorded, so the work outlives
     * the call that started it.
     */
    const settled = async () => {
        for (let i = 0; i < 50 && !requests.length; i++) await Promise.resolve();
        await Promise.all(requests.map(r => r.replay));
        for (let i = 0; i < 10; i++) await Promise.resolve();
    };

    return { seen, settled };
}

/**
 * Run popup/interface.js the way the browser runs it, as a classic script, and
 * take references out of its own scope.
 *
 * The file is evaluated unchanged; only a tail is appended to hand back the
 * things these tests need, since `const`/`var` at the top of a script are not
 * reachable from outside when the script is evaluated as a function body.
 */
function load_interface() {
    const uploads = [];
    globalThis.browser = {
        extension: {
            getBackgroundPage: () => ({
                browser: {
                    storage: { local: {
                        get: async () => ({ '4cat-url': 'http://localhost' }),
                        set: async () => {},
                    } },
                },
                db: { uploads: { add: async (row) => { uploads.push(row); } } },
                zeeschuimer: { modules: {} },
            }),
        },
        downloads: { onChanged: { addListener() {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    };

    const handle = new Function(
        INTERFACE_SOURCE + '\n;return {upload_poll, is_uploading: () => is_uploading};'
    )();
    return { ...handle, uploads };
}

/** The bits of the popup that upload_poll reads and writes. */
function build_dom() {
    document.body.innerHTML = `
        <p id="upload-status"></p>
        <button class="upload-to-4cat" data-platform="douyin.com" disabled></button>
    `;
}

const buttons_disabled = () =>
    [...document.querySelectorAll('.upload-to-4cat')].every(b => b.hasAttribute('disabled'));

describe('upload_poll', () => {
    beforeEach(build_dom);

    test('reports completion when the whole body arrives at once', async () => {
        const { settled } = install_fake_xhr([
            { readyState: 2, responseText: '' },
            { readyState: 3, responseText: COMPLETED },
            { readyState: 4, responseText: COMPLETED },
        ]);
        const { upload_poll, uploads } = load_interface();

        await upload_poll.init({ key: 'f7b31c25' }, 'douyin.com');
        await settled();

        expect(document.querySelector('#upload-status a').getAttribute('href'))
            .toBe('http://localhost/results/f7b31c256ae30dc451d2fe0d5e37bd4b/');
        expect(uploads).toEqual([expect.objectContaining({
            platform: 'douyin.com', items: 310,
            url: 'http://localhost/results/f7b31c256ae30dc451d2fe0d5e37bd4b/',
        })]);
        expect(buttons_disabled()).toBe(false);
    });

    test('reports completion when the body arrives across two readyStates', async () => {
        // State 3 carries a fragment: valid JSON cannot be parsed from it yet.
        // This is the case a handler acting on state 3 cannot serve.
        const half = COMPLETED.slice(0, 40);
        const { seen, settled } = install_fake_xhr([
            { readyState: 2, responseText: '' },
            { readyState: 3, responseText: half },
            { readyState: 4, responseText: COMPLETED },
        ]);
        const { upload_poll, uploads } = load_interface();

        await upload_poll.init({ key: 'f7b31c25' }, 'douyin.com');
        await settled();

        expect(document.querySelector('#upload-status a')?.getAttribute('href'))
            .toBe('http://localhost/results/f7b31c256ae30dc451d2fe0d5e37bd4b/');
        expect(uploads).toHaveLength(1);
        expect(seen.map(s => s.readyState)).toEqual([2, 3, 4]);
    });

    test('shows no error while the response is still arriving', async () => {
        const { seen, settled } = install_fake_xhr([
            { readyState: 2, responseText: '' },
            { readyState: 3, responseText: COMPLETED },
            { readyState: 4, responseText: COMPLETED },
        ]);
        const { upload_poll } = load_interface();

        await upload_poll.init({ key: 'f7b31c25' }, 'douyin.com');
        await settled();

        const complained = seen.filter(s => (s.message ?? '').includes('malformed'));
        expect(complained).toEqual([]);
    });

    test('a poll that cannot be read gives the upload buttons back', async () => {
        const { settled } = install_fake_xhr([
            { readyState: 2, responseText: '' },
            { readyState: 4, status: 500, responseText: 'Internal Server Error' },
        ]);
        const { upload_poll } = load_interface();

        await upload_poll.init({ key: 'f7b31c25' }, 'douyin.com');
        await settled();

        expect(document.getElementById('upload-status').innerText)
            .toContain('Error while checking for upload status');
        // Without this the popup can never start another upload.
        expect(buttons_disabled()).toBe(false);
    });
});
