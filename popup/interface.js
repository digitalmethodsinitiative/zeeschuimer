const background = browser.extension.getBackgroundPage();
var have_4cat = false;
var have_firebase = false;
var have_firebase_key = false;
var have_firebase_project = false;
var xhr;
var is_uploading = false;

/**
 * StreamSaver init
 * Unused for now - see documentation for the download_blob function.
 */
/*var fileStream;
var writer;
var encode = TextEncoder.prototype.encode.bind(new TextEncoder);

streamSaver.mitm = 'mitm.html';
// Abort the download stream when leaving the page
window.isSecureContext && window.addEventListener('beforeunload', evt => {
    writer.abort()
    writer = undefined;
    fileStream = undefined;
})*/

/**
 * Create DOM element
 *
 * Convenience function because we can't use innerHTML very well in an
 * extension context.
 *
 * @param tag  Tag of element
 * @param attributes  Element attributes
 * @param content  Text content of attribute
 * @returns {*}
 */
function createElement(tag, attributes={}, content=undefined) {
    let element = document.createElement(tag);
    for(let attribute in attributes) {
        element.setAttribute(attribute, attributes[attribute]);
    }
    if (content && typeof(content) === 'object' && 'tagName' in content) {
        element.appendChild(content);
    } else if(content !== undefined) {
        element.textContent = content;
    }

    return element;
}

// /**
//  * Get URL of 4CAT instance to connect to
//  *
//  * This is stored in the LocalStorage.
//  *
//  * @param e
//  * @returns {Promise<*>}
//  */
// async function get_4cat_url(e) {
//     let url = await background.browser.storage.local.get(['4cat-url']);
//     if (url['4cat-url']) {
//         url = url['4cat-url'];
//     } else {
//         url = '';
//     }

//     return url;
// }

async function get_firebase_url(e) {
    let url = await background.browser.storage.local.get(['firebase-url']);
    if (url['firebase-url']) {
        url = url['firebase-url'];
    } else {
        url = '';
    }

    return url;
}


async function get_firebase_key(e) {
    let url = await background.browser.storage.local.get(['firebase-key']);
    if (url['firebase-key']) {
        url = url['firebase-key'];
    } else {
        url = '';
    }

    return url;
}

async function get_firebase_project(e) {
    let project = await background.browser.storage.local.get(['firebase-project']);
    if (project['firebase-project']) {
        project = project['firebase-project'];
    } else {
        project = '';
    }

    return project;
}


// /**
//  * Set URL of 4CAT instance to connect to
//  *
//  * This is stored in the LocalStorage.
//  *
//  * @param e
//  * @returns {Promise<void>}
//  */
// async function set_4cat_url(e) {
//     if(e !== true && !e.target.matches('#fourcat-url')) {
//         return;
//     }

//     let url;
//     if(e !== true) {
//         url = document.querySelector('#fourcat-url').value;
//         if(url.length > 0) {
//             if (url.indexOf('://') === -1) {
//                 url = 'http://' + url;
//             }
//             url = url.split('/').slice(0, 3).join('/');
//         }
//         await background.browser.storage.local.set({'4cat-url': url});
//     } else {
//         url = await background.browser.storage.local.get(['4cat-url']);
//         if(url['4cat-url']) {
//             url = url['4cat-url'];
//         } else {
//             url = '';
//         }
//     }

//     have_4cat = (url && url.length > 0);
// }

async function set_firebase_url(e) {
    if(e !== true && !e.target.matches('#firebase-url')) {
        return;
    }

    let url;
    if(e !== true) {
        url = document.querySelector('#firebase-url').value;
        if(url.length > 0) {
            if (url.indexOf('://') === -1) {
                url = 'https://' + url;
            }
            url = url.split('/').slice(0, 3).join('/');
        }
        await background.browser.storage.local.set({'firebase-url': url});
    } else {
        url = await background.browser.storage.local.get(['firebase-url']);
        if(url['firebase-url']) {
            url = url['firebase-url'];
        } else {
            url = '';
        }
    }

    have_firebase = (url && url.length > 0);
}

async function set_firebase_key(e) {
    if(e !== true && !e.target.matches('#firebase-key')) {
        return;
    }

    let key;
    if(e !== true) {
        key = document.querySelector('#firebase-key').value;
        await background.browser.storage.local.set({'firebase-key': key});
    } else {
        key = await background.browser.storage.local.get(['firebase-key']);
        if(key['firebase-key']) {
            key = key['firebase-key'];
        } else {
            key = '';
        }
    }

    have_firebase_key = (key && key.length > 0);
}

async function set_firebase_project(e) {
    if(e !== true && !e.target.matches('#firebase-project')) {
        return;
    }

    let key;
    if(e !== true) {
        key = document.querySelector('#firebase-project').value;
        await background.browser.storage.local.set({'firebase-project': key});
    } else {
        key = await background.browser.storage.local.get(['firebase-project']);
        if(key['firebase-project']) {
            key = key['firebase-project'];
        } else {
            key = '';
        }
    }

    have_firebase_key = (key && key.length > 0);
}



/**
 * Manage availability of interface buttons
 *
 * Some buttons are only available when a 4CAT URL has been provided, or when
 * items have been collected, etc. This function is called periodically to
 * enable or disable buttons accordingly.
 */
function activate_buttons() {
    document.querySelectorAll("td button").forEach(button => {
        let current = button.disabled;
        let items = parseInt(button.parentNode.parentNode.querySelector('.num-items').innerText);
        let new_status = current;

        if(button.classList.contains('upload-to-4cat') && !is_uploading) {
            new_status = !(items > 0 && have_4cat);
            if(new_status && !have_4cat) {
                button.classList.add('tooltippable');
                button.setAttribute('title', 'Configure a 4CAT URL to enable uploading to 4CAT');
            } else {
                button.classList.remove('tooltippable');
                button.setAttribute('title', '');
            }

        } else if(button.classList.contains('download-ndjson') || button.classList.contains('reset')) {
            new_status = !(items > 0);
        }

        if(new_status !== current) {
            button.disabled = new_status;
        }
    });
}

/**
 * Toggle data capture for a platform
 *
 * Callback; platform depends on the button this callback is called through.
 *
 * @param e
 * @returns {Promise<void>}
 */
async function toggle_listening(e) {
    let platform = e.target.getAttribute('name');
    let now = await background.browser.storage.local.get([platform]);
    let current = !!parseInt(now[platform]);
    let updated = current ? 0 : 1;

    await background.browser.storage.local.set({[platform]: String(updated)});
}

/**
 * Get Zeeschuimer stats
 *
 * Loads the amount of items collected, etc. This function is called
 * periodically to keep the numbers in the interface updated as items are
 * coming in.
 *
 * @returns {Promise<void>}
 */
async function get_stats() {
    let response = [];
    let platform_map = [];
    Object.keys(background.zeeschuimer.modules).forEach(function(platform) { platform_map[platform] = background.zeeschuimer.modules[platform].name; });
    for(let module in background.zeeschuimer.modules) {
        response[module] = await background.db.items.where("source_platform").equals(module).count();
    }

    for (let platform in response) {
        let row_id = "stats-" + platform.replace(/[^a-zA-Z0-9]/g, "");
        let new_num_items = parseInt(response[platform]);
        if(!document.querySelector("#" + row_id)) {
            let toggle_field = 'zs-enabled-' + platform;
            let enabled = await background.browser.storage.local.get([toggle_field])
            enabled = enabled.hasOwnProperty(toggle_field) && !!parseInt(enabled[toggle_field]);
            let row = createElement("tr", {"id": row_id});

            // checkbox stuff
            let checker = createElement("label", {"for": toggle_field});
            checker.appendChild(createElement('input', {"id": toggle_field, "name": toggle_field, "type": "checkbox"}))
            checker.appendChild(createElement('span', {"class": "toggle"}));
            if(enabled) { checker.firstChild.setAttribute('checked', 'checked'); }
            checker.addEventListener('change', toggle_listening);

            row.appendChild(createElement("td", {}, createElement('div', {'class': 'toggle-switch'}, checker)));
            row.appendChild(createElement("td", {}, createElement('a', {'href': 'https://' + platform}, platform_map[platform])));
            row.appendChild(createElement("td", {"class": "num-items"}, new Intl.NumberFormat().format(response[platform])));

            let actions = createElement("td");
            let clear_button = createElement("button", {"data-platform": platform, "class": "reset"}, "Delete");
            let download_button = createElement("button", {
                "data-platform": platform,
                "class": "download-ndjson"
            }, ".ndjson");
            // let fourcat_button = createElement("button", {
            //     "data-platform": platform,
            //     "class": "upload-to-4cat",
            // }, "to 4CAT");

            actions.appendChild(clear_button);
            actions.appendChild(download_button);
            // actions.appendChild(fourcat_button);

            row.appendChild(actions);
            document.querySelector("#item-table tbody").appendChild(row);
        } else if(new_num_items !== parseInt(document.querySelector("#" + row_id + " .num-items").innerText)) {
            document.querySelector("#" + row_id + " .num-items").innerText = new Intl.NumberFormat().format(new_num_items);
        }
    }

    let uploads = await background.db.uploads.orderBy("id").limit(10);
    let num_uploads = parseInt(await background.db.uploads.orderBy("id").limit(10).count());

    //if(num_uploads > 0 && !document.querySelector('#clear-history')) {
    //    document.querySelector('#upload-table').parentNode.appendChild(createElement('button', {id: 'clear-history'}, 'Clear history'));
    //} else if (num_uploads === 0 && !document.querySelector('#upload-table .empty-table-notice')) {
    //    document.querySelector('#upload-table tbody').appendChild(createElement('tr', {class: 'empty-table-notice'},
    //        createElement('td', {colspan: 4}, 'No datasets uploaded so far.')));
    //}

    await uploads.each(upload => {
        let row_id = "upload-" + upload.id;
        if(!document.querySelector("#" + row_id)) {
            if(document.querySelector('#upload-table .empty-table-notice')) {
                document.querySelector('#upload-table .empty-table-notice').remove();
            }
            let row = createElement("tr", {"id": row_id});
            row.appendChild(createElement("td", {}, upload.platform));
            row.appendChild(createElement("td", {}, new Intl.NumberFormat().format(upload.items)));
            row.appendChild(createElement("td", {}, (new Date(upload.timestamp)).toLocaleString('en-us', {
                weekday: "long",
                year: "numeric",
                month: "short",
                day: "numeric"
            })));
            row.appendChild(createElement("td", {}, createElement("a", {"href": upload.url, "target": "_blank"}, upload.url.split("/")[2])));
            document.querySelector("#upload-table tbody").prepend(row);
        }
    });

    // set_4cat_url(true);
    activate_buttons();
    init_tooltips();
}

/**
 * Handle button clicks
 *
 * Since buttons are created dynamically, the buttons don't have individual
 * listeners but this function listens to incoming events and dispatches
 * accordingly.
 *
 * @param event
 * @returns {Promise<void>}
 */
async function button_handler(event) {
    let status = document.getElementById('upload-status');

    if (event.target.matches('.reset')) {
        let platform = event.target.getAttribute('data-platform');
        await background.db.items.where("source_platform").equals(platform).delete();

    } else if (event.target.matches('.reset-all')) {
        await background.db.items.clear();

    } else if (event.target.matches('.download-ndjson')) {
        let platform = event.target.getAttribute('data-platform');
        let date = new Date();
        event.target.classList.add('loading');

        //let blob = await download_blob(platform, 'zeeschuimer-export-' + platform + '-' + date.toISOString().split(".")[0].replace(/:/g, "") + '.ndjson');
        let blob = await get_blob(platform);
        let filename = 'zeeschuimer-export-' + platform + '-' + date.toISOString().split(".")[0].replace(/:/g, "") + '.ndjson';
        await browser.downloads.download({
            url: window.URL.createObjectURL(blob),
            filename: filename,
            conflictAction: 'uniquify'
        });

        event.target.classList.remove('loading');

    // } else if (event.target.matches('.upload-to-4cat')) {
    //     let platform = event.target.getAttribute('data-platform');
    //     status.innerText = 'Creating data file for uploading...';
    //     is_uploading = true;
    //     let blob = await get_blob(platform);

    //     document.querySelectorAll('.upload-to-4cat').forEach(x => x.setAttribute('disabled', true));

    //     xhr = new XMLHttpRequest();
    //     xhr.aborted = false;
    //     let upload_url = await get_4cat_url();

    //     xhr.open("POST", upload_url + "/api/import-dataset/", true);
    //     xhr.setRequestHeader("X-Zeeschuimer-Platform", platform)
    //     xhr.onloadstart = function () {
    //         status.innerText = 'Starting upload...';
    //     }
    //     xhr.upload.onprogress = function (event) {
    //         let pct = event.total === 0 ? '???' : Math.round(event.loaded / event.total * 100);
    //         status.innerHTML = '';
    //         status.appendChild(createElement('p', {}, pct + '% uploaded'));
    //         status.appendChild(createElement('button', {id: 'cancel-upload'}, 'Cancel upload'));
    //     }
    //     xhr.onreadystatechange = function() {
    //         let response = xhr.responseText.replace(/\n/g, '');
    //         if(xhr.readyState === xhr.DONE) {
    //             if(xhr.status === 200) {
    //                 status.innerText = 'File uploaded. Waiting for processing to finish.'
    //                 if (xhr.responseURL.indexOf('/login/') >= 0) {
    //                     is_uploading = false;
    //                     status.innerText = 'You are not logged in to this 4CAT server! Open it in a separate tab, log in and try again.'
    //                     return;
    //                 }

    //                 try {
    //                     response = JSON.parse(response);
    //                 } catch (e) {
    //                     is_uploading = false;
    //                     status.innerText = 'Error during upload: malformed response from 4CAT server.';
    //                     return;
    //                 }
    //                 upload_poll.init(response);
    //             } else if(xhr.status === 429) {
    //                 status.innerText = '4CAT server refused upload, too soon after previous one. Try again in a minute.'
    //             } else if(xhr.status === 403) {
    //                 status.innerText = 'Could not log in to 4CAT server. Make sure to log in to 4CAT in this browser.';
    //             } else if(xhr.status === 404 && xhr.responseText.indexOf('Unknown platform or source format') >= 0) {
    //                 status.innerText = 'The 4CAT server does not accept ' + platform + ' datasets. The 4CAT ' +
    //                     'administrator may need to enable the data source or upgrade 4CAT.';
    //             } else if(xhr.status === 0) {
    //                 if(!xhr.aborted) {
    //                     status.innerText = 'Could not connect to 4CAT server. Is the URL correct?';
    //                 }
    //             } else {
    //                 status.innerText = 'Error ' + xhr.status + ' ' + xhr.statusText + ' during upload. Is the URL correct?';
    //             }

    //             is_uploading = false;
    //         }
    //     }
    //     xhr.send(blob);

    } else if(event.target.matches('#clear-history')) {
        await background.db.uploads.clear();
        document.querySelector('#clear-history').remove();
        document.querySelectorAll("#upload-table tbody tr").forEach(x => x.remove());

    } else if(event.target.matches('#cancel-upload')) {
        xhr.abort();
        xhr.aborted = true;
        status.innerHTML = '';

    } else if(event.target.matches('#import-button')) {
        if(!confirm('Importing data will remove all items currently stored. Are you sure?')) {
            return;
        }

        await background.db.items.clear();

        event.target.setAttribute('disabled', 'disabled');
        let file = document.querySelector('#ndjson-file').files[0];
        let reader = new FileReader();
        reader.readAsText(file);
        reader.addEventListener('load', async function (e) {
            let imported_items = 0;
            let skipped = 0;
            let jsons = reader.result.split("\n");
            for(let index in jsons) {
                let raw_json = jsons[index];
                if (!raw_json) {
                    continue;
                }

                try {
                    let imported = JSON.parse(raw_json);
                    await background.db.items.add(imported);
                    imported_items += 1;
                } catch (e) {
                    skipped += 1;
                    console.log('Skipping invalid JSON string: (' + e + ') ' + raw_json);
                }
            }

            if(skipped) {
                alert('Imported ' + imported_items + ' item(s), ' + skipped + ' skipped.');
            } else {
                alert('Imported ' + imported_items + ' item(s).');
            }
        });

        reader.addEventListener('loadend', function(e) {
            event.target.removeAttribute('disabled');
        });

    } else if (event.target.matches('#toggle-advanced-mode')) {
        let section = document.querySelector('#advanced-mode');
        let is_hidden = section.getAttribute('aria-hidden') == 'true';
        if(is_hidden) {
            section.setAttribute('aria-hidden', 'false');
            event.target.innerText = 'Hide advanced options';
        } else {
            section.setAttribute('aria-hidden', 'true');
            event.target.innerText = 'Show advanced options';
        }

        event.stopPropagation();
        return false;
    }

    get_stats();
}

/**
 * Upload status poller
 */
const upload_poll = {
    /**
     * Start polling for upload status
     *
     * Connects to the 4CAT API at the configured URL to check status of a
     * dataset that has been uploaded and is now being processed.
     *
     * @param response
     * @returns {Promise<void>}
     */
    init: async function(response) {
        let upload_url = await get_4cat_url();
        let poll_url = upload_url + '/api/check-query/?key=' + response["key"];
        let status = document.getElementById('upload-status');
        let xhr = new XMLHttpRequest();
        xhr.open("GET", poll_url, true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState === xhr.DONE) {
                return;
            }

            if (xhr.status !== 200) {
                status.innerText = 'Error while checking for upload status.'
                return;
            }

            let json_response = xhr.responseText.replace(/\n/g, '');
            let progress;
            try {
                progress = JSON.parse(json_response);
            } catch (SyntaxError) {
                status.innerText = 'Error during upload: malformed response from 4CAT server.';
                return;
            }

            if (!progress["done"]) {
                status.innerText = 'Processing upload: ' + progress["status"];
                setTimeout(() => upload_poll.init(response), 1000);
            } else {
                status.innerHTML = '';
                status.appendChild(createElement("span", {},"Upload completed! "));
                status.appendChild(createElement("a", {"href": progress["url"], "target": "_blank"}, "View dataset."));
                upload_poll.add_dataset(progress);

                document.querySelectorAll('.upload-to-4cat').forEach(x => x.removeAttribute('disabled'))
                is_uploading = false;
            }
        }
        xhr.send();
    },

    /**
     * Add dataset to Zeeschuimer history
     *
     * @param progress
     * @returns {Promise<void>}
     */
    add_dataset: async function(progress) {
        await background.db.uploads.add({
            timestamp: (new Date()).getTime(),
            url: progress["url"],
            platform: progress["datasource"],
            items: progress["rows"]
        });
    }
}

/**
 * Get a NDJON dump of items
 *
 * Retuens a Blob with all items in it as JSON files, delimited with newlines.
 * This file can be uploaded to e.g. 4CAT.
 *
 * @param platform
 * @returns {Promise<Blob>}
 */
async function get_blob(platform) {
    let ndjson = [];

    await iterate_items(platform, function(item) {
        ndjson.push(JSON.stringify(item) + "\n");
    });

    return new Blob(ndjson, {type: 'application/x-ndjson'});
}

/**
 * Use StreamSaver to download a Blob
 *
 * This is advantageous for very large files because the download starts
 * while items are being collected, instead of only after an NDJSON has been
 * created and stored in memory. However, StreamSaver is kind of awkward to
 * use in an extension context, so for now this function is not used.
 *
 * @param platform
 * @param filename
 * @returns {Promise<void>}
 */
async function download_blob(platform, filename) {
    if (!fileStream) {
        fileStream = streamSaver.createWriteStream(filename)
        writer = fileStream.getWriter()
    }

    await iterate_items(platform, function(item) {
        writer.write(encode(JSON.stringify(item) + "\n"));
    });

    await writer.close();
    writer = undefined;
    fileStream = undefined;
}

/**
 * Iterate through all collected items for a given platform
 *
 * A callback function will be called with each item as its only argument. This
 * function iterates over the items in chunks of 500, to avoid issues with
 * large datasets that are too much for the browser to handle in one go.
 *
 * @param platform  Platform to iterate items for
 * @param callback  Callback to call for each item
 * @returns {Promise<void>}
 */
async function iterate_items(platform, callback) {
    let previous;
    while(true) {
        let items;
        // we paginate here in this somewhat roundabout way because firefox
        // crashes if we query everything in one go for large datasets
        if(!previous) {
            items = await background.db.items
                .orderBy('id')
                .filter(item => item.source_platform === platform)
                .limit(500).toArray();
        } else {
            items = await background.db.items
                .where('id')
                .aboveOrEqual(previous.id)
                .filter(fastForward(previous, 'id', item => item.source_platform === platform))
                .limit(500).toArray();
        }

        if(!items.length) {
            break;
        }

        items.forEach(item => {
            callback(item);
            previous = item;
        })
    }
}

/**
 * Helper function for Dexie pagination
 *
 * Used to paginate through results where large result sets may be too much for
 * Firefox to handle.
 *
 * See https://dexie.org/docs/Collection/Collection.offset().
 *
 * @param lastRow  Last seen row (that should not be included)
 * @param idProp  Property to compare between items
 * @param otherCriteria  Other filters, as a function that returns a bool.
 * @returns {(function(*): (*|boolean))|*}
 */
function fastForward(lastRow, idProp, otherCriteria) {
    let fastForwardComplete = false;
    return item => {
        if (fastForwardComplete) return otherCriteria(item);
        if (item[idProp] === lastRow[idProp]) {
            fastForwardComplete = true;
        }
        return false;
    };
}

/**
 * Init!
 */
document.addEventListener('DOMContentLoaded', async function () {
    get_stats();
    setInterval(get_stats, 1000);

    document.addEventListener('click', button_handler);

    document.addEventListener('keyup', set_firebase_url);
    document.addEventListener('change', set_firebase_url);

    document.addEventListener('keyup', set_firebase_key);
    document.addEventListener('change', set_firebase_key);

    document.addEventListener('keyup', set_firebase_project);
    document.addEventListener('change', set_firebase_project);

    const firebase_url = await background.browser.storage.local.get('firebase-url');
    document.querySelector('#firebase-url').value = firebase_url['firebase-url'] ? firebase_url['firebase-url'] : '';

    const firebase_key = await background.browser.storage.local.get('firebase-key');
    document.querySelector('#firebase-key').value = firebase_key['firebase-key'] ? firebase_key['firebase-key'] : '';   

    const firebase_project = await background.browser.storage.local.get('firebase-project');
    document.querySelector('#firebase-project').value = firebase_project['firebase-project'] ? firebase_project['firebase-project'] : '';   

});