const background = browser.extension.getBackgroundPage();
var have_4cat = false;
var xhr;
var is_uploading = false;
const downloadUrls = new Map();
const duplicateBehaviorKey = 'zs-duplicate-behavior';
const mediaDownloadPlatforms = ['tiktok.com', 'instagram.com', 'twitter.com'];

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
 * @param prepend_icon  Font awesome icon ID to prepend to content
 * @returns {*}
 */
function createElement(tag, attributes={}, content=undefined, prepend_icon=undefined) {
    let element = document.createElement(tag);
    for(let attribute in attributes) {
        element.setAttribute(attribute, attributes[attribute]);
    }
    if (content && typeof(content) === 'object' && 'tagName' in content) {
        element.appendChild(content);
    } else if(content !== undefined) {
        element.textContent = content;
    }

    if(prepend_icon) {
        const icon_element = document.createElement('i');
        icon_element.classList.add('fa')
        icon_element.classList.add('fa-' + prepend_icon);
        element.textContent = ' ' + element.textContent;
        element.prepend(icon_element);
    }

    return element;
}

/**
 * Get URL of 4CAT instance to connect to
 *
 * This is stored in the LocalStorage.
 *
 * @param e
 * @returns {Promise<*>}
 */
async function get_4cat_url(e) {
    let url = await background.browser.storage.local.get(['4cat-url']);
    if (url['4cat-url']) {
        url = url['4cat-url'];
    } else {
        url = '';
    }

    return url;
}

/**
 * Set URL of 4CAT instance to connect to
 *
 * This is stored in the LocalStorage.
 *
 * @param e
 * @returns {Promise<void>}
 */
async function set_4cat_url(e) {
    if(e !== true && !e.target.matches('#fourcat-url')) {
        return;
    }

    let url;
    if(e !== true) {
        url = document.querySelector('#fourcat-url').value;
        if(url.length > 0) {
            if (url.indexOf('://') === -1) {
                url = 'http://' + url;
            }
            url = url.split('/').slice(0, 3).join('/');
        }
        await background.browser.storage.local.set({'4cat-url': url});
    } else {
        url = await background.browser.storage.local.get(['4cat-url']);
        if(url['4cat-url']) {
            url = url['4cat-url'];
        } else {
            url = '';
        }
    }

    have_4cat = (url && url.length > 0);
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

        } else if(button.classList.contains('download-ndjson') || button.classList.contains('download-media-zip') || button.classList.contains('reset')) {
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
    e.target.parentNode.parentNode.parentNode.parentNode.setAttribute('data-enabled', updated);

    await background.browser.storage.local.set({[platform]: String(updated)});
}


/**
 * Update favicon depending on whether capture is enabled
 */
function update_icon() {
    const any_enabled = Array.from(document.querySelectorAll('.toggle-switch input')).filter(item => item.checked);
    const path = any_enabled.length > 0 ? '/images/zeeschuimer-icon-active.png' : '/images/zeeschuimer-icon-inactive.png';
    document.querySelector('link[rel~=icon]').setAttribute('href', path);
}

/**
 * Get extension stats
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

    let total_items = 0;
    for (let platform in response) {
        total_items += parseInt(response[platform]);
    }

    for (let platform in response) {
        let row_id = "stats-" + platform.replace(/[^a-zA-Z0-9]/g, "");
        let new_num_items = parseInt(response[platform]);
        if(!document.querySelector("#" + row_id)) {
            let toggle_field = 'zs-enabled-' + platform;
            let enabled = await background.browser.storage.local.get([toggle_field])
            enabled = enabled.hasOwnProperty(toggle_field) && !!parseInt(enabled[toggle_field]);
            let row = createElement("tr", {"id": row_id, 'data-enabled': enabled ? '1' : '0'});

            // checkbox stuff
            let checker = createElement("label", {"for": toggle_field});
            checker.appendChild(createElement('input', {"id": toggle_field, "name": toggle_field, "type": "checkbox"}))
            checker.appendChild(createElement('span', {"class": "toggle"}));
            if(enabled) { checker.firstChild.setAttribute('checked', 'checked'); }
            checker.addEventListener('change', toggle_listening);

            row.appendChild(createElement("td", {'class': 'platform-icon'}, createElement('img', {'src': '/images/platform-icons/' + platform.split('.')[0].split('-')[0] + '.png', 'alt': ''})));
            row.appendChild(createElement("td", {}, createElement('div', {'class': 'toggle-switch'}, checker)));
            
            // Create module name cell with optional override tooltip
            const module_cell = createElement("td", {});
            const module_link = createElement('a', {'href': 'https://' + background.zeeschuimer.modules[platform]['domain']}, platform_map[platform]);
            module_cell.appendChild(module_link);
            
            // Add override message tooltip if module has overwrite_partial logic
            const module = background.zeeschuimer.modules[platform];
            if (module.overwrite_partial) {
                // Add space before tooltip
                module_cell.appendChild(document.createTextNode(' '));
                
                // Use custom message or provide default explanation
                const override_tooltip = module.override_message || 
                    "This module may collect partial records that can be updated by navigating to individual item pages.";
                const tooltip_span = createElement('span', {'class': 'tooltippable', 'title': override_tooltip}, '?');
                module_cell.appendChild(tooltip_span);
            }
            
            row.appendChild(module_cell);
            row.appendChild(createElement("td", {"class": "num-items"}, new Intl.NumberFormat().format(response[platform])));

            let actions = createElement("td");
            let clear_button = createElement("button", {"data-platform": platform, "class": "reset"}, "Delete");
            let download_button = createElement("button", {
                "data-platform": platform,
                "class": "download-ndjson"
            }, ".ndjson");
            let media_button = createElement("button", {
                "data-platform": platform,
                "class": "download-media-zip"
            }, ".zip", "photo-film");
            let fourcat_button = createElement("button", {
                "data-platform": platform,
                "class": "upload-to-4cat",
            }, "to 4CAT");

            actions.appendChild(clear_button);
            actions.appendChild(download_button);
            if (mediaDownloadPlatforms.includes(platform)) {
                actions.appendChild(media_button);
            }
            actions.appendChild(fourcat_button);

            row.appendChild(actions);
            document.querySelector("#item-table tbody").appendChild(row);
        } else if(new_num_items !== parseInt(document.querySelector("#" + row_id + " .num-items").innerText)) {
            document.querySelector("#" + row_id + " .num-items").innerText = new Intl.NumberFormat().format(new_num_items);
        }
    }

    let uploads = await background.db.uploads.orderBy("id").reverse().limit(10);
    let num_uploads = parseInt(await background.db.uploads.orderBy("id").limit(10).count());

    if(num_uploads > 0 && !document.querySelector('#clear-history')) {
        document.querySelector('#upload-table').parentNode.appendChild(createElement('button', {id: 'clear-history'}, 'Clear history'));
    } else if (num_uploads === 0 && !document.querySelector('#upload-table .empty-table-notice')) {
        document.querySelector('#upload-table tbody').appendChild(createElement('tr', {class: 'empty-table-notice'},
            createElement('td', {colspan: 4}, 'No datasets uploaded so far.')));
    }

    await uploads.each(upload => {
        let row_id = "upload-" + upload.id;
        if(!document.querySelector("#" + row_id)) {
            if(document.querySelector('#upload-table .empty-table-notice')) {
                document.querySelector('#upload-table .empty-table-notice').remove();
            }
            let row = createElement("tr", {"id": row_id});
            row.appendChild(createElement("td", {}, background.zeeschuimer.modules[upload.platform]["name"]));
            row.appendChild(createElement("td", {}, new Intl.NumberFormat().format(upload.items)));
            row.appendChild(createElement("td", {}, (new Date(upload.timestamp)).toLocaleString('en-us', {
                weekday: "long",
                year: "numeric",
                month: "short",
                day: "numeric"
            })));
            row.appendChild(createElement("td", {}, createElement("a", {"href": upload.url, "target": "_blank"}, upload.url.split("/")[2])));
            document.querySelector("#upload-table tbody").append(row);
        }
    });

    set_4cat_url(true);
    activate_buttons();
    update_icon();
    init_tooltips();

    const duplicate_select = document.querySelector('#duplicate-behavior');
    const duplicate_tooltip = document.querySelector('#duplicate-behavior-tooltip');
    if (duplicate_select) {
        if (duplicate_tooltip) {
            const base_title = 'Keep duplicates stores every item. Skip duplicates ignores items already stored (keep first seen). Update replaces the stored record (keep latest).';
            const tooltip_text = base_title + ' Changing this setting only affects behavior for future captures and is not retroactive.';
            duplicate_tooltip.setAttribute('title', tooltip_text);
        }
    }
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
        const downloadUrl = window.URL.createObjectURL(blob);
        const downloadId = await browser.downloads.download({
            url: window.URL.createObjectURL(blob),
            filename: filename,
            conflictAction: 'uniquify'
        });
        downloadUrls.set(downloadId, downloadUrl);

        event.target.classList.remove('loading');

    } else if (event.target.matches('.download-media-zip')) {
        let platform = event.target.getAttribute('data-platform');
        let date = new Date();
        event.target.classList.add('loading');
        status.innerText = 'Creating media ZIP...';

        try {
            let blob = await get_media_zip_blob(platform, function (current, total) {
                status.innerText = 'Downloading media: ' + current + '/' + total;
            });
            let filename = 'zeeschuimer-media-' + platform + '-' + date.toISOString().split(".")[0].replace(/:/g, "") + '.zip';
            const downloadUrl = window.URL.createObjectURL(blob);
            const downloadId = await browser.downloads.download({
                url: downloadUrl,
                filename: filename,
                conflictAction: 'uniquify'
            });
            downloadUrls.set(downloadId, downloadUrl);
            status.innerText = '';
        } catch (e) {
            status.innerText = 'Could not create media ZIP: ' + e.message;
        }

        event.target.classList.remove('loading');

    } else if (event.target.matches('.upload-to-4cat')) {
        let platform = event.target.getAttribute('data-platform');
        status.innerText = 'Creating data file for uploading...';
        is_uploading = true;
        let blob = await get_blob(platform);

        document.querySelectorAll('.upload-to-4cat').forEach(x => x.setAttribute('disabled', true));

        xhr = new XMLHttpRequest();
        xhr.aborted = false;
        let upload_url = await get_4cat_url();

        xhr.open("POST", upload_url.trim() + "/api/import-dataset/", true);
        xhr.setRequestHeader("X-Zeeschuimer-Platform", platform)
        xhr.onloadstart = function () {
            status.innerText = 'Starting upload...';
        }
        xhr.upload.onprogress = function (event) {
            let pct = event.total === 0 ? '???' : Math.round(event.loaded / event.total * 100);
            status.innerHTML = '';
            status.appendChild(createElement('p', {}, pct + '% uploaded'));
            status.appendChild(createElement('button', {id: 'cancel-upload'}, 'Cancel upload'));
        }
        xhr.onreadystatechange = function() {
            let response = xhr.responseText.replace(/\n/g, '');
            if(xhr.readyState === xhr.DONE) {
                if(xhr.status === 200) {
                    status.innerText = 'File uploaded. Waiting for processing to finish.'
                    if (xhr.responseURL.indexOf('/login/') >= 0) {
                        is_uploading = false;
                        status.innerText = 'You are not logged in to this 4CAT server! Open it in a separate tab, log in and try again.'
                        return;
                    }

                    try {
                        response = JSON.parse(response);
                    } catch (e) {
                        is_uploading = false;
                        status.innerText = 'Error during upload: malformed response from 4CAT server.';
                        return;
                    }
                    upload_poll.init(response);
                } else if(xhr.status === 429) {
                    status.innerText = '4CAT server refused upload, too soon after previous one. Try again in a minute.'
                } else if(xhr.status === 403) {
                    status.innerText = 'Could not log in to 4CAT server. Make sure to log in to 4CAT in this browser.';
                } else if(xhr.status === 404 && xhr.responseText.indexOf('Unknown platform or source format') >= 0) {
                    status.innerText = 'The 4CAT server does not accept ' + platform + ' datasets. The 4CAT ' +
                        'administrator may need to enable the data source or upgrade 4CAT.';
                } else if(xhr.status === 0) {
                    if(!xhr.aborted) {
                        status.innerText = 'Could not connect to 4CAT server. Is the URL correct?';
                    }
                } else {
                    status.innerText = 'Error ' + xhr.status + ' ' + xhr.statusText + ' during upload. Is the URL correct?';
                }

                is_uploading = false;
            }
        }
        xhr.send(blob);

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

                    // is this original format or 4CAT-ified? in the latter case, convert back
                    if ('__import_meta' in imported) {
                        let reformatted_import = imported['__import_meta'];
                        reformatted_import['data'] = {};
                        for (const field in imported) {
                            if(field === '__import_meta') {
                                continue;
                            }
                            reformatted_import['data'][field] = imported[field];
                        }
                        imported = reformatted_import;
                    }

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
        event.preventDefault();
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
        let poll_url = upload_url.trim() + '/api/check-query/?key=' + response["key"];
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
     * Add dataset to upload history
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
 * Get a ZIP with all downloadable media for a platform.
 *
 * The ZIP contains a manifest.json file mapping each downloaded file back to
 * the stored item and platform post it was extracted from.
 *
 * @param platform
 * @param progress_callback
 * @returns {Promise<Blob>}
 */
async function get_media_zip_blob(platform, progress_callback=function(){}) {
    let media_items = [];

    await iterate_items(platform, function(item) {
        const urls = extract_media_urls(item);
        urls.forEach((media, index) => {
            media_items.push(Object.assign({}, media, {
                item: item,
                index: index + 1
            }));
        });
    });

    if (media_items.length === 0) {
        throw new Error('no media URLs found for this platform');
    }

    let zip_entries = [];
    let manifest = [];
    let seen_filenames = new Set();

    for (let index = 0; index < media_items.length; index++) {
        const media = media_items[index];
        progress_callback(index + 1, media_items.length);

        let response = null;
        let media_url = media.url;
        let last_error = null;
        const candidate_urls = media.alternate_urls && media.alternate_urls.length > 0 ? media.alternate_urls : [media.url];
        for (const candidate_url of candidate_urls) {
            try {
                response = await fetch(candidate_url, {credentials: 'include'});
            } catch (e) {
                last_error = 'fetch failed: ' + e.message;
                continue;
            }

            if (response.ok) {
                const candidate_content_type = response.headers.get('content-type') || '';
                if (media.type === 'video' && candidate_content_type.toLowerCase().indexOf('image/') === 0) {
                    last_error = 'unexpected image response for video URL';
                    response = null;
                    continue;
                }
                media_url = candidate_url;
                break;
            }

            last_error = 'HTTP ' + response.status;
            response = null;
        }

        if (!response) {
            manifest.push(media_manifest_entry(media, null, last_error));
            continue;
        }

        const blob = await response.blob();
        const array_buffer = await blob.arrayBuffer();
        const content_type = response.headers.get('content-type') || blob.type || media.content_type || '';
        media.url = media_url;
        let filename = media_filename(media, content_type);
        filename = uniquify_filename(filename, seen_filenames);
        seen_filenames.add(filename);

        zip_entries.push({
            filename: filename,
            data: new Uint8Array(array_buffer)
        });
        manifest.push(media_manifest_entry(media, filename, null, content_type));
    }

    zip_entries.unshift({
        filename: 'manifest.json',
        data: new TextEncoder().encode(JSON.stringify(manifest, null, 2))
    });

    return create_zip_blob(zip_entries);
}

/**
 * Extract media URLs from platform item data.
 *
 * @param item
 * @returns {Array}
 */
function extract_media_urls(item) {
    if (!item || !item.data) {
        return [];
    }

    if (item.source_platform === 'tiktok.com') {
        return extract_tiktok_media_urls(item);
    }

    if (item.source_platform === 'instagram.com') {
        return extract_instagram_media_urls(item);
    }

    if (item.source_platform === 'twitter.com') {
        return extract_twitter_media_urls(item);
    }

    return [];
}

function extract_tiktok_media_urls(item) {
    const data = item.data;
    let urls = [];

    const add_url_list = function (url_list, type, content_type) {
        if (typeof url_list === 'string' && url_list.length > 0) {
            urls.push({
                url: url_list,
                alternate_urls: [url_list],
                type: type,
                content_type: content_type,
                post_id: data.id || item.item_id
            });
            return;
        }

        if (!Array.isArray(url_list) || url_list.length === 0) {
            return;
        }
        urls.push({
            url: url_list[0],
            alternate_urls: url_list,
            type: type,
            content_type: content_type,
            post_id: data.id || item.item_id
        });
    };

    const add_best_bitrate_video = function () {
        if (!Array.isArray(data.video.bitrateInfo)) {
            return;
        }

        const bitrate = data.video.bitrateInfo
            .filter(info => info.PlayAddr && Array.isArray(info.PlayAddr.UrlList) && info.PlayAddr.UrlList.length > 0)
            .sort((a, b) => (b.Bitrate || 0) - (a.Bitrate || 0))[0];
        if (bitrate) {
            const url_list = preferred_tiktok_video_urls(bitrate.PlayAddr.UrlList);
            add_url_list(url_list, 'video', 'video/mp4');
        }
    };

    if (data.video) {
        add_best_bitrate_video();
        if (urls.length === 0) {
            const play_addr = data.video.playAddr && (data.video.playAddr.urlList || data.video.playAddr);
            add_url_list(preferred_tiktok_video_urls(play_addr), 'video', 'video/mp4');
        }
        if (urls.length === 0) {
            const download_addr = data.video.downloadAddr && (data.video.downloadAddr.urlList || data.video.downloadAddr);
            add_url_list(preferred_tiktok_video_urls(download_addr), 'video', 'video/mp4');
        }
    }

    if (urls.length === 0 && data.imagePost && Array.isArray(data.imagePost.images)) {
        data.imagePost.images.forEach(image => {
            add_url_list(image.imageURL && image.imageURL.urlList, 'image', 'image/jpeg');
        });
    }

    return dedupe_media_urls(urls);
}

function preferred_tiktok_video_urls(urls) {
    if (typeof urls === 'string') {
        return urls;
    }

    if (!Array.isArray(urls)) {
        return urls;
    }

    const tiktok_play_urls = urls.filter(url => {
        return typeof url === 'string' && url.indexOf('www.tiktok.com/aweme/v1/play') >= 0;
    });
    return tiktok_play_urls.length > 0 ? tiktok_play_urls.concat(urls.filter(url => !tiktok_play_urls.includes(url))) : urls;
}

function extract_instagram_media_urls(item) {
    const data = item.data;
    let urls = [];

    const add_instagram_media = function (media, fallback_post_id) {
        const post_id = media.id || fallback_post_id || data.id || item.item_id;

        if (Array.isArray(media.video_versions) && media.video_versions.length > 0) {
            const best_video = media.video_versions
                .filter(version => version.url)
                .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
            if (best_video) {
                urls.push({
                    url: best_video.url,
                    type: 'video',
                    content_type: 'video/mp4',
                    post_id: post_id
                });
            }
        }

        const candidates = media.image_versions2 && Array.isArray(media.image_versions2.candidates)
            ? media.image_versions2.candidates
            : [];
        const best_image = candidates
            .filter(candidate => candidate.url)
            .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
        if (best_image) {
            urls.push({
                url: best_image.url,
                type: 'image',
                content_type: 'image/jpeg',
                post_id: post_id
            });
        }
    };

    add_instagram_media(data);
    if (Array.isArray(data.carousel_media)) {
        data.carousel_media.forEach(media => add_instagram_media(media, data.id || item.item_id));
    }

    return dedupe_media_urls(urls);
}

function extract_twitter_media_urls(item) {
    const data = item.data;
    const legacy = data.legacy || {};
    const entities = legacy.extended_entities || legacy.entities || {};
    let urls = [];

    if (!Array.isArray(entities.media)) {
        return [];
    }

    entities.media.forEach(media => {
        const post_id = data.id || data.rest_id || legacy.id_str || item.item_id;
        if (media.video_info && Array.isArray(media.video_info.variants)) {
            const best_video = media.video_info.variants
                .filter(variant => variant.url && (!variant.content_type || variant.content_type.indexOf('video/') === 0))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            if (best_video) {
                urls.push({
                    url: best_video.url,
                    type: 'video',
                    content_type: best_video.content_type || 'video/mp4',
                    post_id: post_id
                });
                return;
            }
        }

        const image_url = media.media_url_https || media.media_url;
        if (image_url) {
            urls.push({
                url: image_url + (image_url.indexOf('?') >= 0 ? '&' : '?') + 'name=orig',
                type: 'image',
                content_type: 'image/jpeg',
                post_id: post_id
            });
        }
    });

    return dedupe_media_urls(urls);
}

function dedupe_media_urls(media_urls) {
    let seen = new Set();
    return media_urls.filter(media => {
        if (!media.url || seen.has(media.url)) {
            return false;
        }
        seen.add(media.url);
        return true;
    });
}

function media_manifest_entry(media, filename, error=null, content_type=null) {
    const data = media.item.data || {};
    const post_id = String(media.post_id || data.id || data.rest_id || media.item.item_id);
    const post_author = media_post_author(media.item);
    return {
        filename: filename,
        error: error,
        source_platform: media.item.source_platform,
        item_id: media.item.item_id,
        post_id: post_id,
        post_url: media_post_url(media.item, post_id),
        captured_page_url: media.item.source_platform_url,
        post_author: post_author,
        media_type: media.type,
        media_url: media.url,
        content_type: content_type || media.content_type || null
    };
}

function media_post_url(item, post_id) {
    const data = item.data || {};

    if (item.source_platform === 'tiktok.com') {
        const author = data.author || {};
        const username = author.uniqueId || author.unique_id || author.nickname;
        if (username && post_id) {
            return 'https://www.tiktok.com/@' + username + '/video/' + post_id;
        }
    }

    if (item.source_platform === 'instagram.com') {
        if (data.code) {
            const product_type = data.product_type || '';
            const media_type = data.media_type;
            const path = product_type === 'clips' || media_type === 2 ? 'reel' : 'p';
            return 'https://www.instagram.com/' + path + '/' + data.code + '/';
        }
        if (data.post_url) {
            return data.post_url;
        }
    }

    if (item.source_platform === 'twitter.com') {
        if (post_id) {
            return 'https://x.com/i/web/status/' + post_id;
        }
        if (data.post_url) {
            return data.post_url;
        }
    }

    return data.post_url || item.source_platform_url;
}

function media_post_author(item) {
    const data = item.data || {};

    if (item.source_platform === 'tiktok.com' && data.author) {
        const author_id = data.author.id || data.author.uid || data.author.secUid || null;
        return {
            id: author_id ? String(author_id) : null,
            unique_id: data.author.uniqueId || data.author.unique_id || null,
            nickname: data.author.nickname || null
        };
    }

    if (item.source_platform === 'instagram.com' && data.user) {
        const author_id = data.user.pk || data.user.pk_id || data.user.id || null;
        return {
            id: author_id ? String(author_id) : null,
            unique_id: data.user.username || null,
            nickname: data.user.full_name || null
        };
    }

    if (item.source_platform === 'twitter.com') {
        const user = data.core && data.core.user_results && data.core.user_results.result;
        if (user) {
            const author_id = user.rest_id || user.id || null;
            return {
                id: author_id ? String(author_id) : null,
                unique_id: user.core ? user.core.screen_name : null,
                nickname: user.core ? user.core.name : null
            };
        }
    }

    return null;
}

function media_filename(media, content_type) {
    const extension = extension_from_content_type(content_type) || extension_from_url(media.url) || (media.type === 'video' ? 'mp4' : 'jpg');
    const post_id = safe_filename(media.post_id || media.item.item_id || 'post');
    const media_type = safe_filename(media.type || 'media');
    return post_id + '/' + post_id + '-' + String(media.index).padStart(2, '0') + '-' + media_type + '.' + extension;
}

function extension_from_content_type(content_type) {
    if (!content_type) {
        return '';
    }
    content_type = content_type.split(';')[0].trim().toLowerCase();
    return {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov'
    }[content_type] || '';
}

function extension_from_url(url) {
    try {
        const pathname = new URL(url).pathname;
        const match = pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
        return match ? match[1].toLowerCase() : '';
    } catch (e) {
        return '';
    }
}

function safe_filename(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

function uniquify_filename(filename, seen_filenames) {
    if (!seen_filenames.has(filename)) {
        return filename;
    }

    const dot = filename.lastIndexOf('.');
    const base = dot >= 0 ? filename.slice(0, dot) : filename;
    const extension = dot >= 0 ? filename.slice(dot) : '';
    let counter = 2;
    let candidate = base + '-' + counter + extension;
    while (seen_filenames.has(candidate)) {
        counter += 1;
        candidate = base + '-' + counter + extension;
    }
    return candidate;
}

/**
 * Create an uncompressed ZIP file.
 *
 * @param entries Array of {filename, data}
 * @returns {Blob}
 */
function create_zip_blob(entries) {
    let chunks = [];
    let central_directory = [];
    let offset = 0;

    entries.forEach(entry => {
        const filename = new TextEncoder().encode(entry.filename);
        const data = entry.data;
        const crc = crc32(data);
        const local_header = zip_header(0x04034b50, [
            20, 0, 0, 0, 0, crc, data.length, data.length, filename.length, 0
        ], [2, 2, 2, 2, 2, 4, 4, 4, 2, 2]);

        chunks.push(local_header, filename, data);

        const central_header = zip_header(0x02014b50, [
            20, 20, 0, 0, 0, 0, crc, data.length, data.length, filename.length, 0, 0, 0, 0, 0, offset
        ], [2, 2, 2, 2, 2, 2, 4, 4, 4, 2, 2, 2, 2, 2, 4, 4]);
        central_directory.push(central_header, filename);
        offset += local_header.length + filename.length + data.length;
    });

    const central_start = offset;
    let central_size = 0;
    central_directory.forEach(chunk => {
        central_size += chunk.length;
    });

    const end_header = zip_header(0x06054b50, [
        0, 0, entries.length, entries.length, central_size, central_start, 0
    ], [2, 2, 2, 2, 4, 4, 2]);

    return new Blob([...chunks, ...central_directory, end_header], {type: 'application/zip'});
}

function zip_header(signature, values, sizes) {
    const length = 4 + sizes.reduce((sum, size) => sum + size, 0);
    let buffer = new ArrayBuffer(length);
    let view = new DataView(buffer);
    let offset = 0;
    view.setUint32(offset, signature, true);
    offset += 4;
    values.forEach((value, index) => {
        if (sizes[index] === 2) {
            view.setUint16(offset, value, true);
        } else {
            view.setUint32(offset, value >>> 0, true);
        }
        offset += sizes[index];
    });
    return new Uint8Array(buffer);
}

function crc32(data) {
    if (!crc32.table) {
        crc32.table = [];
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
            }
            crc32.table[n] = c >>> 0;
        }
    }

    let crc = 0 ^ (-1);
    for (let i = 0; i < data.length; i++) {
        crc = (crc >>> 8) ^ crc32.table[(crc ^ data[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
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
 * Listen for completed downloads, and if the download that has completed
 * was one of our object URLs, then revoke it.
 * @param delta object representing the changes that caused this event to fire.
 */
function downloadListener(delta) {
    if(delta.state && delta.state.current === "complete") {
        const url = downloadUrls.get(delta.id);
        if(url) {
            window.URL.revokeObjectURL(url);
            downloadUrls.delete(delta.id);
        }
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
    document.addEventListener('keyup', set_4cat_url);
    document.addEventListener('change', set_4cat_url);

    const version_container = document.querySelector('.version a');
    const current_version = version_container.innerText;
    const known_version = await background.browser.storage.local.get('zs-version');
    if(!known_version || current_version !== known_version['zs-version']) {
        const version_alert = createElement('span', {'class': 'popup new-version'}, 'Pesquisa Social has been updated to a new version! You can read the release notes via this link.');
        const ok_button = createElement('button', {'class': 'close-popup'}, 'OK');
        ok_button.addEventListener('click', async function(e) {
            await background.browser.storage.local.set({'zs-version': current_version});
            document.querySelector('.new-version').remove();
        });
        version_alert.appendChild(ok_button);
        document.querySelector('header').appendChild(version_alert);
    }

    const fourcat_url = await background.browser.storage.local.get('4cat-url');
    document.querySelector('#fourcat-url').value = fourcat_url['4cat-url'] ? fourcat_url['4cat-url'] : '';

    const duplicate_behavior = await background.browser.storage.local.get(duplicateBehaviorKey);
    const duplicate_select = document.querySelector('#duplicate-behavior');
    if (duplicate_select) {
        const stored_value = duplicate_behavior[duplicateBehaviorKey];
        const allowed = ['insert', 'skip', 'update'];
        duplicate_select.value = allowed.includes(stored_value) ? stored_value : 'insert';
        duplicate_select.addEventListener('change', async function (event) {
            await background.browser.storage.local.set({[duplicateBehaviorKey]: event.target.value});
        });
    }

    browser.downloads.onChanged.addListener(downloadListener);
});
