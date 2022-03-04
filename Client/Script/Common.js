
/**
 * Removes all children from the given element.
 * @param {HTMLElement} ele The element to clear.
 */
 function clearEle(ele) {
    while (ele.firstChild) {
        ele.removeChild(ele.firstChild);
    }
}

/**
 * Generic method to make a request to the given endpoint that expects a JSON response.
 * @param {string} endpoint The URL to query.
 * @param {Object<string, any>} parameters URL parameters.
 * @param {Function<Object>} successFunc Callback function to invoke on success.
 * @param {Function<Object>} failureFunc Callback function to invoke on failure.
 */
function jsonRequest(endpoint, parameters, successFunc, failureFunc) {
    let url = new URL(endpoint, window.location.href);
    for (const [key, value] of Object.entries(parameters)) {
        url.searchParams.append(key, value);
    }

    fetch(url, { method : 'POST', headers : { accept : 'application/json' } }).then(r => r.json()).then(response => {
        Log.verbose(response);
        if (!response || response.Error) {
            if (failureFunc) {
                failureFunc(response);
            } else {
                console.error('Request failed: %o', response);
            }

            return;
        }

        successFunc(response);
    }).catch(err => {
        failureFunc(err);
    });
}

/**
 * Custom jQuery-like selector method.
 * If the selector starts with '#' and contains no spaces, return the result of `querySelector`,
 * otherwise return the result of `querySelectorAll`.
 * @param {DOMString} selector The selector to match.
 * @param {HTMLElement} ele The scope of the query. Defaults to `document`.
 */
function $(selector, ele=document) {
    if (selector.indexOf("#") === 0 && selector.indexOf(" ") === -1) {
        return $$(selector, ele);
    }

    return ele.querySelectorAll(selector);
}

/**
 * Like $, but forces a single element to be returned. i.e. querySelector.
 * @param {string} selector The query selector.
 * @param {HTMLElement} [ele=document] The scope of the query. Defaults to `document`.
 */
function $$(selector, ele=document) {
    return ele.querySelector(selector);
}

/**
 * Helper method to create DOM elements.
 * @param {string} type The TAG to create.
 * @param {Object<string, string>} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement} [content] The inner content of the element, either a string or an element.
 * @param {Object<string, EventListener>} [events] Map of events (click/keyup/etc) to attach to the element.
 */
function buildNode(type, attrs, content, events) {
    let ele = document.createElement(type);
    return _buildNode(ele, attrs, content, events);
}

/**
 * Helper method to create DOM elements with the given namespace (e.g. SVGs).
 * @param {string} ns The namespace to create the element under.
 * @param {string} type The type of element to create.
 * @param {Object<string, string>} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement} [content] The inner content of the element, either a string or an element.
 * @param {Object<string, EventListener>} [events] Event listeners to add to the element.
 */
function buildNodeNS(ns, type, attrs, content, events) {
    let ele = document.createElementNS(ns, type);
    return _buildNode(ele, attrs, content, events);
}

/**
 * "Private" core method for buildNode and buildNodeNS, that handles both namespaced and non-namespaced elements.
 * @param {HTMLElement} ele The HTMLElement to attach the given properties to.
 * @param {Object<string, string>} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement} [content] The inner content of the element, either a string or an element.
 * @param {Object<string, EventListener>} [events] Event listeners to add to the element.
 */
function _buildNode(ele, attrs, content, events) {
    if (attrs) {
        for (let [key, value] of Object.entries(attrs)) {
            ele.setAttribute(key, value);
        }
    }

    if (events) {
        for (let [event, func] of Object.entries(events)) {
            ele.addEventListener(event, func);
        }
    }

    if (content) {
        if (content instanceof HTMLElement) {
            ele.appendChild(content);
        } else {
            ele.innerHTML = content;
        }
    }

    return ele;
}

/**
 * Helper to append multiple children to a single element at once.
 * @param {HTMLElement} parent Parent element to append children to.
 * @param {...HTMLElement} elements Elements to append this this `HTMLElement`
 * @returns {Element} `parent`
 */
 function appendChildren(parent, ...elements) {
    for (let element of elements) {
        if (element) {
            parent.appendChild(element);
        }
    }

    return parent;
};


// Hack for VSCode intellisense.
if (typeof __dontEverDefineThis !== 'undefined') {
    const { Log } = require('../../Shared/ConsoleLog');
    module.exports = { clearEle, jsonRequest, $, $$, buildNode, buildNodeNS, appendChildren };
}
