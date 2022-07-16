const background = browser.extension.getBackgroundPage();
var have_4cat = false;

function createElement(tag, attributes={}, content=undefined) {
    let element = document.createElement(tag);
    for(let attribute in attributes) {
        element.setAttribute(attribute, attributes[attribute]);
    }
    if (content && typeof(content) === 'object' && 'tagName' in content) {
        console.log(content);
        element.appendChild(content);
    } else if(content !== undefined) {
        element.textContent = content;
    }

    return element;
}

document.addEventListener('DOMContentLoaded', async function () {
    get_stats();
    setInterval(get_stats, 1000);

    document.addEventListener('click', button_handler);
    document.addEventListener('keyup', set_4cat_url);
    document.addEventListener('change', set_4cat_url);

    let fourcat_url = await background.browser.storage.local.get('4cat-url');
    document.querySelector('#fourcat-url').value = fourcat_url['4cat-url'] ? fourcat_url['4cat-url'] : '';
});


async function get_4cat_url(e) {
    let url = await background.browser.storage.local.get(['4cat-url']);
    if (url['4cat-url']) {
        url = url['4cat-url'];
    } else {
        url = '';
    }

    return url;
}


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

function activate_buttons() {
    document.querySelectorAll("td button").forEach(button => {
        let current = button.disabled;
        let items = parseInt(button.parentNode.parentNode.querySelector('.num-items').innerText);
        let new_status = current;

        if(button.classList.contains('upload-to-4cat')) {
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

async function toggle_listening(e) {
    let platform = e.target.getAttribute('name');
    let now = await background.browser.storage.local.get([platform]);
    let current = !!parseInt(now[platform]);
    let updated = current ? 0 : 1;
    console.log('setting ' + updated)

    await background.browser.storage.local.set({[platform]: String(updated)});
}

async function get_stats() {
    let response = [];
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
            row.appendChild(createElement("td", {}, platform));
            row.appendChild(createElement("td", {"class": "num-items"}, parseInt(response[platform])));

            let actions = createElement("td");
            let clear_button = createElement("button", {"data-platform": platform, "class": "reset"}, "Delete");
            let download_button = createElement("button", {
                "data-platform": platform,
                "class": "download-ndjson"
            }, ".ndjson");
            let fourcat_button = createElement("button", {
                "data-platform": platform,
                "class": "upload-to-4cat",
            }, "to 4CAT");

            actions.appendChild(clear_button);
            actions.appendChild(download_button);
            actions.appendChild(fourcat_button);

            row.appendChild(actions);
            document.querySelector("#item-table tbody").appendChild(row);
        } else if(new_num_items !== parseInt(document.querySelector("#" + row_id + " .num-items").innerText)) {
            document.querySelector("#" + row_id + " .num-items").innerText = new_num_items;
        }
    }

    let uploads = await background.db.uploads.orderBy("id").limit(10);
    await uploads.each(upload => {
        let row_id = "upload-" + upload.id;
        if(!document.querySelector("#" + row_id)) {
            let row = createElement("tr", {"id": row_id});
            row.appendChild(createElement("td", {}, upload.platform));
            row.appendChild(createElement("td", {}, upload.items));
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

    set_4cat_url(true);
    activate_buttons();
    init_tooltips();
}

async function button_handler(event) {
    if (event.target.matches('.reset')) {
        let platform = event.target.getAttribute('data-platform');
        await background.db.items.where("source_platform").equals(platform).delete();
    } else if (event.target.matches('.reset-all')) {
        await background.db.items.clear();
    } else if (event.target.matches('.download-ndjson')) {
        let platform = event.target.getAttribute('data-platform');
        let date = new Date();

        let blob = await get_blob(platform);
        let filename = 'zeeschuimer-export-' + platform + '-' + date.toISOString().split(".")[0].replace(/:/g, "") + '.ndjson';
        await browser.downloads.download({
            url: window.URL.createObjectURL(blob),
            filename: filename,
            conflictAction: 'uniquify'
        });
    } else if (event.target.matches('.upload-to-4cat')) {
        let platform = event.target.getAttribute('data-platform');
        let blob = await get_blob(platform);

        let xhr = new XMLHttpRequest();
        let status = document.getElementById('upload-status');
        let upload_url = await get_4cat_url();
        xhr.open("POST", upload_url + "/api/import-dataset/", true);
        xhr.setRequestHeader("X-Zeeschuimer-Platform", platform)
        xhr.onloadstart = function () {
            status.innerText = 'Starting upload...';
        }
        xhr.onprogress = function (event) {
            let pct = event.total === 0 ? '???' : Math.round(event.loaded / event.total * 100, 1);
            status.innerText = pct + '% uploaded';
        }
        xhr.onreadystatechange = function() {
            let response = xhr.responseText.replace(/\n/g, '');
            if(xhr.readyState === xhr.DONE) {
                if(xhr.status === 200) {
                    status.innerText = 'File uploaded. Waiting for processing to finish.'
                    try {
                        response = JSON.parse(response);
                    } catch (SyntaxError) {
                        status.innerText = 'Error during upload: malformed response from 4CAT server.';
                        return;
                    }
                    upload_poll.init(response);
                } else if(xhr.status === 429) {
                    status.innerText = '4CAT server refused upload, too soon after previous one. Try again in a minute.'
                } else if(xhr.status === 403) {
                    status.innerText = 'Could not log in to 4CAT server. Make sure to log in to 4CAT in this browser.';
                } else if(xhr.status === 0) {
                    status.innerText = 'Could not connect to 4CAT server. Is the URL correct?';
                } else {
                    status.innerText = 'Error ' + xhr.status + ' ' + xhr.statusText + ' during upload. Is the URL correct?';
                }
            }
        }
        xhr.send(blob);
    }

    get_stats();
}

const upload_poll = {
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
            }
        }
        xhr.send();
    },

    add_dataset: async function(progress) {
        await background.db.uploads.add({
            timestamp: (new Date()).getTime(),
            url: progress["url"],
            platform: progress["datasource"],
            items: progress["rows"]
        });
    }
}

async function get_blob(platform) {
    let ndjson = [];
    let items = await background.db.items.where("source_platform").equals(platform).sortBy("id");
    items.forEach(item => {
        ndjson.push(JSON.stringify(item) + "\n");
    })

    return new Blob(ndjson, {type: 'application/x-ndjson'});
}