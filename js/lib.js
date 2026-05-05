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
