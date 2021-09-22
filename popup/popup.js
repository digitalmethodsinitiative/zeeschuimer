const background = browser.extension.getBackgroundPage();

function createElement(html) {
    let element = document.createElement('template');
    element.innerHTML = html;
    return element.content.firstChild;
}

document.addEventListener('DOMContentLoaded', function() {
    get_stats();
    setInterval(get_stats, 500);

    document.addEventListener('click', button_handler)
});

async function get_stats() {
    let response = {
        "tiktok.com": await background.db.items.where("source_platform").equals("tiktok.com").count(),
        "instagram.com": await background.db.items.where("source_platform").equals("instagram.com").count(),
    };

    document.getElementById('status').innerHTML = '';
    for(let platform in response) {
        document.getElementById('status').appendChild(
            createElement(
                '<p><b>' + platform + ':</b> ' + response[platform] +
                ' <button class="reset" data-platform="' + platform + '">Clear</button>' +
                ' <button class="download-ndjson" data-platform="' + platform + '">.ndjson</button></p>'
            )
        );
    }
}

async function button_handler(event) {
    if(event.target.matches('.reset')) {
        let platform = event.target.getAttribute('data-platform');
        await background.db.items.where("source_platform").equals(platform).delete();
    }
    else if(event.target.matches('.reset-all')) {
        await background.db.items.clear();
    }
    else if(event.target.matches('.download-ndjson')) {
        let platform = event.target.getAttribute('data-platform');
        let date = new Date();
        let ndjson = [];

        let items = await background.db.items.where("source_platform").equals(platform).toArray();
        items.forEach(item => {
            ndjson.push(JSON.stringify(item) + "\n");
        })

        let filename = 'zeeschuimer-export-' + platform + '-' + date.toISOString().split(".")[0].replace(/:/g, "") + '.ndjson';
        console.log(filename);
        const blob = new Blob(ndjson, {type : 'application/x-ndjson'});
        await browser.downloads.download({
            url : window.URL.createObjectURL(blob),
            filename : filename,
            conflictAction : 'uniquify'
        });
    }
}