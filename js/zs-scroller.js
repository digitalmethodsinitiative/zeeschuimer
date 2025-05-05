let interval = null;

async function handleMessage(request, sender, sendResponse) {
    clearInterval(interval);
    if(request.speed) {
        interval = setInterval(function () {
            if(window.scrollY < window.scrollMaxY) {
                window.scrollBy(0, request.speed * 5);
            }
        }, 5);
    }
}

// Assign handleMessages as listener for messages from the extension.
browser.runtime.onMessage.addListener(handleMessage);