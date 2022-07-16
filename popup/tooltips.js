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

let tooltip_div = document.createElement("div");
tooltip_div.id = "tooltip";
tooltip_div.style.display = 'none';
tooltip_div.appendChild(document.createElement("div"))
document.getElementsByTagName('body')[0].append(tooltip_div);

const init_tooltips = function() {
    each($$('.tooltippable'), function (element, i) {
        if(element.hasAttribute('data-tooltip-init')) {
            return;
        }

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

                let tooltip_text = document.createElement("div");
                tooltip_text.textContent = title;
                tooltip.innerHTML = '';
                tooltip.appendChild(tooltip_text);
                tooltip.style.visibility = 'hidden';
                tooltip.style.display = 'block';

                var pos_x = pos.left - (tooltip.offsetWidth / 2) + (this.offsetWidth / 2) - 1;
                var pos_y;
                if (up) {
                    tooltip.classList.add('up');
                    tooltip.classList.remove('down');
                    pos_y = pos.top - bpos.top + this.offsetHeight + tooltip.offsetHeight + 7;
                } else {
                    tooltip.classList.add('down');
                    tooltip.classList.remove('up');
                    pos_y = pos.top - bpos.top - tooltip.offsetHeight - 7;
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

        element.setAttribute('data-tooltip-init', 'yes');
    });
}

init_tooltips();