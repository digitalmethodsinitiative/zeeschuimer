const background = browser.extension.getBackgroundPage();

function createElement(html) {
    let element = document.createElement('template');
    element.innerHTML = html;
    return element.content.firstChild;
}

document.addEventListener('DOMContentLoaded', function () {
    get_stats();
    setInterval(get_stats, 500);

    document.addEventListener('click', button_handler)
});

async function get_stats() {
    let response = [];
    for(let module in background.zeeschuimer.modules) {
        response[module] = await background.db.items.where("source_platform").equals(module).count();
    }

    document.getElementById('status').innerHTML = '';
    for (let platform in response) {
        document.getElementById('status').appendChild(
            createElement(
                '<p><b>' + platform + ':</b> ' + response[platform] +
                ' <button class="reset" data-platform="' + platform + '">Clear</button>' +
                ' <button class="download-ndjson" data-platform="' + platform + '">.ndjson</button>' +
                ' <button class="upload-to-4cat" data-platform="' + platform + '">to 4CAT</button></p>'
            )
        );
    }
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
        xhr.open("POST", "http://4cat.local:5000/api/import-dataset/", true);
        xhr.setRequestHeader("X-Zeeschuimer-Platform", platform)
        xhr.onloadstart = function () {
            document.getElementById('upload-status').innerHTML = 'starting upload...';
        }
        xhr.onprogress = function (event) {
            let pct = event.total === 0 ? '???' : Math.round(event.loaded / event.total * 100, 1);
            document.getElementById('upload-status').innerHTML = pct + '% uploaded';
        }
        xhr.onload = function () {
            document.getElementById('upload-status').innerHTML = 'upload complete';
        }
        xhr.send(blob);
    }
    get_stats();
}

async function get_blob(platform) {
    let ndjson = [];
    let items = await background.db.items.where("source_platform").equals(platform).sortBy("id");
    items.forEach(item => {
        ndjson.push(JSON.stringify(item) + "\n");
    })

    return new Blob(ndjson, {type: 'application/x-ndjson'});
}