const background = browser.extension.getBackgroundPage();

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

    closest_parent(e.target, '*[data-enabled]').setAttribute('data-enabled', updated);
}



function closest_parent(node, selector) {
    while(node && node.parentNode) {
        if(node.matches(selector)) {
            return node;
        }
        node = node.parentNode;
    }
    return null;
}