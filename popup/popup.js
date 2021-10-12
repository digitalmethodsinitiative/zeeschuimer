const background = browser.extension.getBackgroundPage();

function createElement(html) {
    let element = document.createElement('template');
    element.innerHTML = html;
    return element.content.firstChild;
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
        if(url.indexOf('://') === -1) {
            url = 'http://' + url;
        }
        url = url.split('/').slice(0, 3).join('/');
        localStorage.setItem('4cat-url', url);
    } else {
        url = localStorage.getItem('4cat-url');
    }

    document.querySelectorAll('button.upload-to-4cat').forEach(button => {
        let items = parseInt(button.parentElement.previousSibling.innerHTML);
        button.disabled = !(items > 0 && url.length > 0);
    });
}

async function get_stats() {
    let response = [];
    for(let module in background.zeeschuimer.modules) {
        response[module] = await background.db.items.where("source_platform").equals(module).count();
    }

    let status = document.getElementById('status');
    let buffer = '';

    buffer += '<h2><span>Captured data objects</span></h2><div>';
    buffer += '<table><tr><th>Platform</th><th>Items</th><th>Actions</th></tr>';
    for (let platform in response) {
        let disabled = parseInt(response[platform]) === 0 ? ' disabled' : '';
        buffer += '<tr>';
        buffer += '<td>' + platform + '</td>';
        buffer += '<td class="num-items">' + response[platform] + '</td>';
        buffer += '<td>' +
                ' <button class="reset" data-platform="' + platform + '"' + disabled + '>Clear</button>' +
                ' <button class="download-ndjson" data-platform="' + platform + '"' + disabled + '>.ndjson</button>' +
                ' <button class="upload-to-4cat" data-platform="' + platform + '"' + disabled + '>to 4CAT</button></td>';
        buffer += '</tr>';
    }

    buffer += '</table>';
    buffer += '<button class="reset-all">Delete all items</button></div>';

    buffer += '<h2><span>Uploaded datasets</span></h2>';
    buffer += '<table><tr><th>Platform</th><th>Items</th><th>Date</th><th>4CAT Link</th></tr>';

    let uploads = await background.db.uploads.orderBy("id").limit(10);
    await uploads.each(upload => {
        buffer += '<tr>';
        buffer += '<td>' + upload.platform + '</td>';
        buffer += '<td>' + upload.items + '</td>';
        buffer += '<td>' + (new Date(upload.timestamp)).toLocaleString('en-us', { weekday:"long", year:"numeric", month:"short", day:"numeric"})  + '</td>';
        buffer += '<td><a href="' + upload.url + '">' + upload.url.split("/")[2] + '</a></td>';
        buffer += '</tr>';
    });

    buffer += '</table>';
    status.innerHTML = buffer;
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
            status.innerHTML = 'Starting upload...';
        }
        xhr.onprogress = function (event) {
            let pct = event.total === 0 ? '???' : Math.round(event.loaded / event.total * 100, 1);
            status.innerHTML = pct + '% uploaded';
        }
        xhr.onreadystatechange = function() {
            let response = xhr.responseText.replace(/\n/g, '');
            if(xhr.readyState === xhr.DONE) {
                if(xhr.status === 200) {
                    status.innerHTML = 'File uploaded. Waiting for processing to finish.'
                    try {
                        response = JSON.parse(response);
                    } catch (SyntaxError) {
                        status.innerHTML = 'Error during upload: malformed response from 4CAT server.';
                        return;
                    }
                    upload_poll.init(response);
                } else if(xhr.status === 403) {
                    status.innerHTML = 'Could not log in to 4CAT server. Make sure to log in to 4CAT in this browser.';
                } else if(xhr.status === 0) {
                    status.innerHTML = 'Could not connect to 4CAT server. Is the URL correct?';
                } else {
                    status.innerHTML = 'Error ' + xhr.status + ' ' + xhr.statusText + ' during upload. Is the URL correct?';
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
                status.innerHTML = 'Error while checking for upload status.'
                return;
            }

            let json_response = xhr.responseText.replace(/\n/g, '');
            let progress;
            try {
                progress = JSON.parse(json_response);
            } catch (SyntaxError) {
                status.innerHTML = 'Error during upload: malformed response from 4CAT server.';
                return;
            }

            if (!progress["done"]) {
                status.innerHTML = 'Processing upload: ' + progress["status"];
                setTimeout(() => upload_poll.init(response), 1000);
            } else {
                status.innerHTML = 'Upload completed! <a href="' + progress["url"] + '">View dataset</a>'
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