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