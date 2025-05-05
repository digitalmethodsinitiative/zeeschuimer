let platform_map = [];

/**
 * Get Zeeschuimer stats
 *
 * Loads the amount of items collected, etc. This function is called
 * periodically to keep the numbers in the interface updated as items are
 * coming in.
 *
 * @returns {Promise<void>}
 */
async function get_modules() {
    let response = {};
    Object.keys(background.zeeschuimer.modules).forEach(function(platform) { platform_map[platform] = background.zeeschuimer.modules[platform].name; });
    for (let module in background.zeeschuimer.modules) {
        response[module] = await background.db.items.where("source_platform").equals(module).count();
    }
    for (const platform in response) {
        const css_platform = platform.replace(/\./g, '');
        const toggle_field = `zs-enabled-${platform}`;
        const icon_id = `#platform-${css_platform}`;
        const num_items = new Intl.NumberFormat().format(response[platform]);
        let enabled = await background.browser.storage.local.get([toggle_field])
        enabled = enabled.hasOwnProperty(toggle_field) && !!parseInt(enabled[toggle_field]);

        if (document.querySelector(icon_id)) {
            const icon = document.querySelector(icon_id);
            icon.querySelector('.num-badge').innerText = num_items;
            icon.querySelector('.num-badge').setAttribute('data-num', response[platform])
            icon.setAttribute('data-enabled', enabled ? '1': '0');
        } else {
            const icon = createElement('li', {'id': `platform-${css_platform}`, 'class': 'platform-icon'}, createElement('img', {
                'class': 'tooltippable',
                'title': platform_map[platform],
                'src': '/images/platform-icons/' + platform.split('.')[0].split('-')[0] + '.png',
                'alt': platform_map[platform],
                'name': toggle_field,
            }));
            icon.appendChild(createElement('span', {'class': 'num-badge', 'data-num': response[platform]}, num_items));
            icon.addEventListener('click', toggle_listening);
            icon.setAttribute('data-enabled', enabled ? '1' : '0');
            document.querySelector('#platform-list ol').appendChild(icon);
        }
    }

    init_tooltips();
}

async function trigger_scroll() {
    let scroll_speed = await background.browser.storage.local.get(['scroll-speed'])
    scroll_speed = scroll_speed.hasOwnProperty('scroll-speed') ? parseInt(scroll_speed['scroll-speed']) : 0;

    browser.tabs.query({
        currentWindow: true,
        active: true
    }).then(tabs => tabs.forEach(tab => tab && browser.tabs.sendMessage(tab.id
        , {speed: scroll_speed})));
}

async function update_autoscroll(e = null) {
    let scroll_speed = e ? e.target.value : 0;
    await background.browser.storage.local.set({['scroll-speed']: String(scroll_speed)});
    return scroll_speed;
}


document.addEventListener('DOMContentLoaded', async function () {
    get_modules();
    setInterval(get_modules, 1000);

    document.getElementById('interface-opener').onclick = async () => {
        let tab = await background.zeeschuimer.has_tab();
        if (!tab) {
            browser.tabs.create({url: 'interface.html'});
        } else if (!tab.active) {
            browser.tabs.update(tab.id, {active: true});
        }
    };

    const scroll_speed = await update_autoscroll();
    document.querySelector('#autoscroll input').value = scroll_speed;
    document.querySelector('#autoscroll input').addEventListener('change', update_autoscroll);

    setInterval(trigger_scroll, 100);
});