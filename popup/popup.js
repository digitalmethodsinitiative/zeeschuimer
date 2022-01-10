const background = browser.extension.getBackgroundPage();

function createElement(tag, attributes={}, content=undefined) {
    let element = document.createElement(tag);
    for(let attribute in attributes) {
        element.setAttribute(attribute, attributes[attribute]);
    }
    if (content instanceof HTMLElement) {
        element.appendChild(content);
    } else if(content !== undefined) {
        element.textContent = content;
    }

    return element;
}

document.addEventListener('DOMContentLoaded', function () {
    get_stats();
    setInterval(get_stats, 1000);

    document.addEventListener('click', button_handler);
    document.addEventListener('keyup', set_4cat_url);
    document.addEventListener('change', set_4cat_url);

    document.querySelector('#fourcat-url').value = localStorage.getItem('4cat-url');
});


function set_4cat_url(e) {
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
        localStorage.setItem('4cat-url', url);
    } else {
        url = localStorage.getItem('4cat-url');
    }

    document.querySelectorAll('button.upload-to-4cat').forEach(button => {
        let items = parseInt(button.parentElement.previousSibling.innerText);
        button.disabled = !(items > 0 && url && url.length > 0);
    });
}

async function get_stats() {
    let response = [];
    for(let module in background.zeeschuimer.modules) {
        response[module] = await background.db.items.where("source_platform").equals(module).count();
    }

    for (let platform in response) {
        let disabled = (parseInt(response[platform]) === 0);
        let row_id = "stats-" + platform.replace(/[^a-zA-Z0-9]/g, "");
        if(!document.querySelector("#" + row_id)) {
            let row = createElement("tr", {"id": row_id});
            row.appendChild(createElement("td", {}, platform));
            row.appendChild(createElement("td", {"class": "num-items"}, parseInt(response[platform])));

            let actions = createElement("td");
            let clear_button = createElement("button", {"data-platform": platform, "class": "reset"}, "Clear");
            clear_button.disabled = disabled;
            let download_button = createElement("button", {
                "data-platform": platform,
                "class": "download-ndjson"
            }, ".ndjson");
            download_button.disabled = disabled;
            let fourcat_button = createElement("button", {
                "data-platform": platform,
                "class": "upload-to-4cat"
            }, "to 4CAT");
            fourcat_button.disabled = disabled;

            actions.appendChild(clear_button);
            actions.appendChild(download_button);
            actions.appendChild(fourcat_button);

            row.appendChild(actions);
            document.querySelector("#item-table tbody").appendChild(row);
        } else {
            document.querySelector("#" + row_id + " .num-items").innerText = parseInt(response[platform]);
            document.querySelectorAll("#" + row_id + " button").forEach(button => { button.disabled = disabled; });
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
        xhr.open("POST", localStorage.getItem("4cat-url") + "/api/import-dataset/", true);
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
    init: function(response) {
        let poll_url = localStorage.getItem("4cat-url") + '/api/check-query/?key=' + response["key"];
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