/**
 * Create DOM element for further manipulation
 *
 * @param html  HTML contents of DOM node
 * @returns DOM node
 */
function createElement(html) {
    var element = document.createElement('template');
    element.innerHTML = html;
    return element.content.firstChild;
}

/**
 * Call a function for each element in array
 *
 * @param elements
 * @param fn
 */
function each(elements, fn) {
    Array.prototype.forEach.call(elements, fn);
}

/**
 * Get all elements matching selector
 *
 * @param selector
 * @returns Element node list
 */
function $$(selector) {
    return document.querySelectorAll(selector);
}

/**
 * Get single element matching selector
 *
 * @param selector
 * @returns Element or NULL if no matches
 */
function $_(selector) {
    return document.querySelector(selector);
}

document.getElementsByTagName('body')[0].append(createElement('<div id="tooltip"><div></div></div>'));
document.getElementById('tooltip').style.display = 'none';

each($$('.tooltippable'), function (element, i) {
    element.addEventListener('mouseover', function (e) {
        e.preventDefault();
        e.stopPropagation();

        var title = this.getAttribute('title');
        if (title && title != '' && title != null && title != 'null') {
            var pos = this.getBoundingClientRect();
            var bpos = document.body.getBoundingClientRect();

            var tooltip = $_('#tooltip')
            var up = this.classList.contains('points-up');
            this.setAttribute('data-title-content', title);
            this.removeAttribute('title');
            tooltip.innerHTML = '<div>' + title + '</div>';
            tooltip.style.visibility = 'hidden';
            tooltip.style.display = 'block';

            var pos_x = pos.left - (tooltip.offsetWidth / 2) + (this.offsetWidth / 2) - 1;
            var pos_y;
            if (up) {
                tooltip.classList.add('up');
                tooltip.classList.remove('down');
                pos_y = pos.top - bpos.top + this.offsetHeight + tooltip.offsetHeight - 15;
            } else {
                tooltip.classList.add('down');
                tooltip.classList.remove('up');
                pos_y = pos.top - bpos.top - tooltip.offsetHeight + 15;
            }

            tooltip.style.top = pos_y + 'px';
            tooltip.style.left = pos_x + 'px';
            tooltip.style.visibility = 'visible';
        }
    });

    element.addEventListener('mouseout', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var old_title = this.getAttribute('data-title-content');
        if (old_title && old_title != null) {
            this.setAttribute('title', old_title);
            document.getElementById('tooltip').style.display = 'none';
        }
    });
});