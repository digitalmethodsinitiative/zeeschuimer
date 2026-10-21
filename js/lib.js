/**
 * Traverse an object, checking each item via a callback
 *
 * @param obj  Object to traverse
 * @param callback  Callback. If the callback returns a value that does not
 *   evaluate to `false`, add it to the result Array. If not, traverse the
 *   value itself, recursively.
 * @returns {*[]}  An array of collected values.
 */
function traverse_data(obj, callback) {
    let results = [];

    function _traverse_data(obj, callback) {
        for (const property in obj) {
            if (!obj.hasOwnProperty(property) || !obj[property]) {
                // not actually a property
                continue;
            }

            let callback_result = callback(obj[property], property);

            if (callback_result) {
                results.push(callback_result);
            } else if (typeof (obj[property]) === "object") {
                _traverse_data(obj[property], callback);
            }
        }
    }

    _traverse_data(obj, callback);
    return results;
}

/**
 * A mapped, collected item
 *
 * Behaves like a standard object. Included for compatibility with 4CAT.
 * `map_item()` functions should return MappedItem()s.
 */
class MappedItem {
    constructor(data) {
        Object.assign(this, data);
    }
}

/**
 * A value that could not be parsed from the source item
 *
 * Intended to be included in CSV exports when a field could not be mapped.
 * Included for compatibility with 4CAT.
 */
class MissingMappedField {
    constructor(value) {
        this.value = value
    }

    toString() {
        return `${this.value}`;
    }

    // Mirror 4CAT's API serialization so JSON.stringify produces the same
    // tagged form on both sides: 4CAT's /api/dataset/<key>/items/ endpoint,
    // when called with `missing_fields=keep`, emits missing values as
    // `{ __missing: true, value: <fallback> }`. Matching that shape here
    // lets the map_item comparator deep-equal both sides without special
    // handling.
    toJSON() {
        return { __missing: true, value: this.value };
    }
}

/**
 * Raised by `map_item` to signal a known mapping failure.
 *
 * Mirrors 4CAT's MapItemException: callers should catch it, skip the item,
 * and warn the user that the platform's format may have shifted.
 */
class MapItemException extends Error {
    constructor(message) {
        super(message);
        this.name = "MapItemException";
    }
}

/**
 * Wrap a Zeeschuimer stored item to match the shape a 4CAT map_item expects.
 *
 * 4CAT's importer constructs:
 *   { ...item.data, __import_meta: { ...everything in item except data } }
 *
 * Mirroring that here means map_item functions auto-generated from 4CAT
 * data sources can run against Zeeschuimer-stored items without translation.
 */
function wrap_for_map_item(stored_item) {
    const { data, ...meta } = stored_item;
    return { ...data, __import_meta: meta };
}

/**
 * Ports of 4CAT functions commonly used by `map_item` below
 */

/**
 * Strip HTML tags from a string.
 * @param {string} html
 * @param {boolean} convertNewlines  Convert <br> and </p> tags to \n before stripping.
 * @returns {string}
 */
function strip_tags(html, convertNewlines = true) {
    if (!html) return "";
    if (convertNewlines) {
        html = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "</p>\n");
        html = html.replace(/\n+/g, "\n");
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent || "";
}

/**
 * Characters that readable_url percent-encodes: those a URL cannot contain as
 * they are (control characters, the space and " < > ^ ` { | }), and those that
 * would be invisible or look like a space. Same list as URL_ENCODED_CHARACTERS
 * in 4CAT's common/lib/helpers.py.
 */
// eslint-disable-next-line no-control-regex, no-misleading-character-class -- control and combining characters are on the list on purpose
const URL_ENCODED_CHARACTERS = /[\x00-\x20"<>^`{|}\x7f\u0080-\u00a0\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u08e2\u115f\u1160\u1680\u17b4\u17b5\u180b-\u180f\u2000-\u200b\u200e\u200f\u2028-\u202f\u205f-\u206f\u2800\u3000\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufeff\uffa0\ufff0-\uffff]/g;

/**
 * Make a URL readable without changing where it leads.
 *
 * Copy of readable_url in 4CAT's common/lib/helpers.py, which explains each
 * step. Encoded text in other scripts and with accents (Chinese, Arabic, é,
 * emoji) is shown as the characters themselves; encoded plain characters such
 * as %20, %23 or %2F stay as written, because decoding them would change the
 * link; what a URL cannot contain as it is, and what would be invisible, is
 * encoded.
 *
 * 4CAT first unpacks URLs that were saved with the whole URL encoded
 * ("https%3A%2F%2F..."), which it can get from uploads and other tools. That
 * step is left out here: Zeeschuimer's URLs come straight from the browser and
 * never start like that, so the result is the same.
 * @param {string} url
 * @returns {string}
 */
function readable_url(url) {
    if (!url) {
        return "";
    }

    url = String(url);

    // like a browser does with a pasted URL, ignore spaces and control
    // characters around it, and tabs and line breaks inside it
    // eslint-disable-next-line no-control-regex -- matches control characters on purpose
    url = url.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
    url = url.replace(/[\t\n\r]/g, "");

    // decode each run of escapes for bytes outside ASCII, if it is valid UTF-8
    url = url.replace(/(?:%[89A-Fa-f][0-9A-Fa-f])+/g, (run) => {
        try {
            return decodeURIComponent(run);
        } catch (e) {
            return run;
        }
    });

    // encode what a URL cannot contain as it is, and what would be invisible
    return url.replace(URL_ENCODED_CHARACTERS, (character) => encodeURIComponent(character));
}

function formatUtcTimestamp(unixSeconds) {
    return new Date(unixSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Read a field the way Python's `dict.get(key, default)` does
 *
 * A key that is absent gives the default; a key that is present but null
 * gives null. JavaScript's `??` collapses those two cases into one, which is
 * why `map_item` ports that reach for it drift from 4CAT: 4CAT emits `null`
 * for a field the platform sent as null, and the fallback for one it left
 * out entirely.
 *
 * @param source  Object to read from
 * @param key  Name of the field to read
 * @param fallback  Value to return when the field is absent
 * @returns  The stored value, or the fallback
 */
function py_get(source, key, fallback = null) {
    return source && key in source ? source[key] : fallback;
}

/**
 * Read a field, marking it missing when the source did not send it
 *
 * Port of 4CAT's `value_or_missing` in `common/lib/item_mapping.py`. An
 * absent key means the source told us nothing about this field, so there is
 * no value to record. Everything the source did send is returned as it is,
 * including zero, an empty string, false and null — whether a null means "no
 * value collected" or "the value is nothing" depends on the field, so the
 * calling `map_item` decides.
 *
 * Where a datasource answers that the same way for most of its fields it may
 * treat null as missing too; that is `source[key] ?? new MissingMappedField(default)`,
 * not this function.
 *
 * @param source  Object to read from
 * @param key  Name of the field to read
 * @param fallback  Value processors should fall back on when missing
 * @returns  The stored value, or a MissingMappedField
 */
function value_or_missing(source, key, fallback) {
    return py_get(source, key, new MissingMappedField(fallback));
}