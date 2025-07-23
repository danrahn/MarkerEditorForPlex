import { addLongPressListener } from './LongPressHandler.js';

/**
 * This file contains all the helpers for creating elements. At their core, these methods are essentially wrappers
 * around document.buildNode[NS], making it easier to create large trees of elements and applying arbitrary attributes
 * to them in a single call (because why use a library when you can build it worse yourself?).
 *
 * All externally visible methods here should start with a '$' as an indication that it's specific
 * to Element creation/manipulation. No strong reason why this is the case, I just created a '$' method to
 * poorly mimic jQuery over 10 years ago and I like the consistency.
 */

///
/// Helpers to create specific element types.
///

/**
 * Create a hyperlink (a) element
 * @param {string|HTMLElement} displayText The text to display
 * @param {string} href The link target
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {{[event: string]: function }} [events ={}] A map of event listeners to attach to this element.
 * @returns {HTMLAnchorElement} */
export function $a(displayText, href, attributes={}, events={}) {
    const fullAttributes = { href, ...attributes };
    if (href[0] !== '#') {
        fullAttributes.rel = 'noreferrer';
        fullAttributes.target = '_blank';
    }

    return buildNode('a', fullAttributes, displayText, events);
}

/**
 * Create a bold (b) element.
 * @param {string|HTMLElement} content The content to bold
 * @param {{[attribute: string]: string}} [attributes={}] */
export function $b(content, attributes={}) {
    return buildNode('b', attributes, content);
}

/**
 * Create a line break (br) element.
 * @param {{ [attribute: string]: string }} attributes
 * @returns {HTMLBRElement} */
export function $br(attributes={}) {
    return buildNode('br', attributes);
}

/**
 * Create a checkbox input
 * @param {{ [attribute: string]: string }} attributes
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element.
 * @param {object} [options={}] Additional options
 * @returns {HTMLInputElement} */
export function $checkbox(attributes={}, events={}, options={}) {
    return buildNode('input', { type : 'checkbox', ...attributes }, 0, events, options);
}

/**
 * Create an inline code element
 * @param {string|HTMLElement} content
 * @param {{ [attribute: string]: string }} [attributes={}]
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element. */
export function $code(content, attributes={}, events={}) {
    return buildNode('code', attributes, content, events);
}

/**
 * Create a div element. A very thin wrapper around buildNode.
 * @param {{[attribute: string]: string}} [attributes] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement|SVGElement} [content] The inner content of the element, either a string or an element.
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element.
 * @param {object} [options={}] Additional options
 * @returns {HTMLDivElement} */
export function $div(attributes, content, events, options={}) {
    return buildNode('div', attributes, content, events, options);
}

/**
 * Create a header element.
 * @param {number} n The 'H' level (1-7)
 * @param {string} content
 * @param {{[attribute: string]: string}} [attributes] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element.
 * @returns {HTMLHeadingElement} */
export function $h(n, content, attributes={}, events={}) {
    return buildNode(`h${n}`, attributes, content, events);
}

/**
 * Create a horizontal rule (hr) element.
 * @param {{ [attribute: string]: string }} attributes
 * @returns {HTMLHRElement} */
export function $hr(attributes={}) {
    return buildNode('hr', attributes);
}

/**
 * Create an idiomatic text (i) element.
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {string|HTMLElement} [content=null]
 * @param {{[event: string]: function}} [events={}] */
export function $i(attributes={}, content=null, events={}) {
    return buildNode('i', attributes, content, events);
}

/**
 * Create an image (img) element.
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {{[event: string]: function}} [events={}]
 * @returns {HTMLImageElement} */
export function $img(attributes={}, events={}) {
    return buildNode('img', attributes, 0, events);
}

/**
 * Create a button input element.
 * @param {{[attribute: string]: string}} attributes
 * @returns {HTMLInputElement} */
export function $buttonInput(attributes) {
    return buildNode('input', { type : 'button', ...attributes });
}

/**
 * Create a file input element.
 * @param {{[attribute: string]: string}} attributes
 * @returns {HTMLInputElement} */
export function $fileInput(attributes) {
    return buildNode('input', { type : 'file', ...attributes });
}

/**
 * Create a number input element.
 * @param {{[attribute: string]: string|number}} attributes
 * @returns {HTMLInputElement} */
export function $numberInput(attributes) {
    return buildNode('input', { type : 'number', ...attributes });
}

/**
 * Create a password input element.
 * @param {{[attribute: string]: string|number}} attributes
 * @param {{[event: string]: function}} [events={}]
 * @returns {HTMLInputElement} */
export function $passwordInput(attributes, events={}) {
    return buildNode('input', { type : 'password', ...attributes }, 0, events);
}

/**
 * Create a text input element.
 * @param {{[attribute: string]: string}} [attributes={}] Attributes to add to this input.
 * @param {{[event: string]: EventListener|EventListener[]}} events Map of event listeners to add to this input element.
 * @param {object} [options={}] Additional options
 * @returns {HTMLInputElement} */
export function $textInput(attributes={}, events={}, options={}) {
    return $input('text', attributes, events, options);
}

/**
 * Create an input element.
 * @param {string} type The type of Input to create
 * @param {{ [attribute: string]: any }} attributes Attributes to add to this input, if any.
 * @param {{ [event: string]: function }} events Map of event listeners to add to this input.
 * @param {object} [options={}] Additional options
 * @returns {HTMLInputElement} */
function $input(type, attributes={}, events={}, options={}) {
    return buildNode('input', { type, ...attributes }, 0, events, options);
}

/**
 * Create a label element.
 * @param {string|HTMLElement} displayText The text to display
 * @param {string} forId The ID of the element this label is for
 * @param {Object} attributes Any additional attributes to add to this label.
 * @param {{ [event: string]: function }} events Map of event listeners to add to this input.
 * @returns {HTMLLabelElement} */
export function $label(displayText, forId, attributes={}, events={}) {
    return buildNode('label', { for : forId, ...attributes }, displayText, events);
}

/**
 * Create a list item (li) element
 * @param {string|HTMLElement} content
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {{[event: string]: function}} [events={}]
 * @returns {HTMLLIElement} */
export function $li(attributes={}, content=null, events={}) {
    return buildNode('li', attributes, content, events);
}

/**
 * Create a link element.
 * @param {{[attribute: string]: string}} [attributes={}] Any additional attributes to add to this label.
 * @param {{ [event: string]: function }} [events={}] Map of event listeners to add to this input.
 * @returns {HTMLLinkElement} */
export function $link(attributes={}, events={}) {
    return buildNode('link', attributes, 0, events);
}

/**
 * Returns an appendable form of the given content. I.e. if it's a string, wrap it in a text node.
 * @param {string|HTMLElement} content */
export function $node(content) {
    return typeof content === 'string' ? $text(content) : content;
}

/**
 * Create an option element.
 * @param {string} displayText The text to show to the user.
 * @param {string} value The underlying value associated with this option.
 * @param {Object} attributes Any additional attributes to add to this option.
 * @returns {HTMLOptionElement} */
export function $option(displayText, value, attributes={}) {
    return buildNode('option', { value, ...attributes }, displayText);
}

/**
 * Create a paragraph (p) element.
 * @param {string|HTMLElement} content
 * @param {{[attribute: string]: string}} attributes
 * @returns {HTMLParagraphElement} */
export function $p(content, attributes={}) {
    return buildNode('p', attributes, content);
}

/**
 * Create a Select element with no initial options.
 * @param {string} id
 * @param {(e: Event) => any} onChange
 * @param {Object} attributes Any additional attributes to add to this select element.
 * @returns {HTMLSelectElement} */
export function $select(id, onChange, attributes={}) {
    const changeEvent = onChange ? { change : onChange } : {};
    const attrs = id ? { id, ...attributes } : attributes;
    return buildNode('select', attrs, 0, changeEvent);
}

/**
 * Create a span with the given content.
 * @param {string|HTMLElement} content
 * @returns {HTMLSpanElement} */
export function $span(content, attributes={}, events={}) {
    return buildNode('span', attributes, content, events);
}

/**
 * Create a SUPerscript element.
 * @param {string|HTMLElement} content
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {{[event: string]: function}} [events={}] */
export function $sup(content, attributes={}, events={}) {
    return buildNode('sup', attributes, content, events);
}

/**
 * Create a Table element.
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {{[event: string]: function}} [events={}]
 * @returns {HTMLTableElement} */
export function $table(attributes={}, events={}) {
    return buildNode('table', attributes, 0, events);
}

/**
 * Create a table body element.
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {{[event: string]: function}} [events={}]
 * @returns {HTMLTableSectionElement} */
export function $tbody(attributes={}, events={}) {
    return buildNode('tbody', attributes, 0, events);
}

/**
 * Create a table data (td) element.
 * @param {string|HTMLElement} content
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {{[event: string]: function}} [events={}]
 * @returns {HTMLTableCellElement} */
export function $td(content, attributes={}, events={}) {
    return buildNode('td', attributes, content, events);
}

/**
 * Create a table header (th) element.
 * @param {string|HTMLElement} content
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {{[event: string]: function}} [events={}]
 * @returns {HTMLTableCellElement} */
export function $th(content, attributes={}, events={}) {
    return buildNode('th', attributes, content, events);
}

/**
 * Create a table header section element.
 * @param {HTMLElement} [child=null]
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {{[event: string]: function}} [events={}]
 * @returns {HTMLTableSectionElement} */
export function $thead(child=null, attributes={}, events={}) {
    return buildNode('thead', attributes, child, events);
}

/**
 * Create a table row (tr) element.
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {string?|HTMLElement?} [content=null]
 * @param {{[event: string]: function}} [events={}]
 * @returns {HTMLTableRowElement} */
export function $tr(attributes={}, content=null, events={}) {
    return buildNode('tr', attributes, content, events);
}

/**
 * Create an unordered list (ul) element.
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {string?|HTMLElement?} [content=null]
 * @param {{[event: string]: function}} [events={}]
 * @returns {HTMLUListElement} */
export function $ul(attributes={}, content=null, events={}) {
    return buildNode('ul', attributes, content, events);
}

/**
 * Creates a text node with the given text.
 * @param {string} text */
export function $text(text) {
    return document.createTextNode(text);
}

///
/// SVG elements
///

/**
 * Create an SVG element
 * @param {{[attribute: string]: string}} [attributes={}]
 * @returns {SVGSVGElement} */
export function $svg(attributes={}) {
    return svgElement('svg', attributes);
}

/**
 * Create an SVG circle element
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {{[event: string]: function}} [events={}]
 * @returns {SVGCircleElement} */
export function $svgCircle(attributes={}, events={}) {
    return svgElement('circle', attributes, events);
}

/**
 * Create an SVG path element
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {{[event: string]: function}} [events={}]
 * @returns {SVGPathElement} */
export function $svgPath(attributes={}, events={}) {
    return svgElement('path', attributes, events);
}

/**
 * Create an SVG polyline element
 * @param {{[attribute: string]: string}} [attributes={}]
 * @param {{[event: string]: function}} [events={}]
 * @returns {SVGPolylineElement} */
export function $svgPolyLine(attributes={}, events={}) {
    return svgElement('polyline', attributes, events);
}

/**
 * Create an SVG rectangle element.
 * @param {{[attribute: string]: string}} [attributes={}]
 * @returns {SVGRectElement} */
export function $svgRect(attributes={}) {
    return svgElement('rect', attributes);
}

/**
 * Create an SVG text element.
 * @param {string|HTMLElement} content
 * @param {{[attribute: string]: string}} [attributes={}]
 * @returns {SVGTextElement} */
export function $svgText(content, attributes) {
    return svgElement('text', attributes, content);
}

/**
 * Create an element under the SVG namespace.
 * @param {string} type The SVG element type to create
 * @param {[[attribute: string]: string]} [attributes={}] Any additional attributes to attach to this element.
 * @param {{[event: string]: function}} [events={}]
 * @returns {SVGElement} */
function svgElement(type, attributes={}, events={}) {
    return buildNodeNS('http://www.w3.org/2000/svg', type, attributes, 0, events);
}

///
/// Helpers that append multiple children to a single element
///

/**
 * @param  {(string|HTMLElement)[]} items */
function toAppendableList(items) {
    return items.map(item => typeof item === 'string' ? $text(item) : item);
}

/**
 * Creates a plain div containing all the given items.
 * @param {...(string|HTMLElement)} items
 * @return {HTMLDivElement} */
export function $plainDivHolder(...items) {
    return $append($div(), ...toAppendableList(items));
}

/**
 * Creates a div with the given attributes, and appends all items to it.
 * @param {{[attribute: string]: string}} attributes
 * @param  {...(string|HTMLElement)} items
 * @returns {HTMLDivElement} */
export function $divHolder(attributes, ...items) {
    return $append($div(attributes), ...toAppendableList(items));
}

/**
 * Creates a span to hold multiple text (or other inline) elements
 * @param  {...(string|HTMLElement)} items
 * @returns {HTMLSpanElement} */
export function $textSpan(...items) {
    return $append($span(), ...toAppendableList(items));
}

/**
 * Helper to append multiple children to a single element at once.
 * @param {HTMLElement} parent Parent element to append children to.
 * @param {...HTMLElement} elements Elements to append this this `HTMLElement`
 * @returns {HTMLElement} `parent` */
export function $append(parent, ...elements) {
    for (const element of elements) {
        if (element) {
            parent.appendChild(typeof element === 'string' ? $text(element) : element);
        }
    }

    return parent;
}

///
/// Core build methods
///

/**
 * Helper method to create DOM elements.
 * @param {string} type The TAG to create.
 * @param {{[attribute: string]: string}} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement|SVGElement} [content] The inner content of the element, either a string or an element.
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element.
 * @param {object} [options={}] Additional options */
function buildNode(type, attrs, content, events, options={}) {
    const ele = document.createElement(type);
    return _buildNode(ele, attrs, content, events, options);
}

/**
 * Helper method to create DOM elements with the given namespace (e.g. SVGs).
 * @param {string} ns The namespace to create the element under.
 * @param {string} type The type of element to create.
 * @param {{[attribute: string]: string}} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement|SVGElement} [content] The inner content of the element, either a string or an element.
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element. */
function buildNodeNS(ns, type, attrs, content, events, options={}) {
    const ele = document.createElementNS(ns, type);
    return _buildNode(ele, attrs, content, events, options);
}

/**
 * "Private" core method for buildNode and buildNodeNS, that handles both namespaced and non-namespaced elements.
 * @param {HTMLElement} ele The HTMLElement to attach the given properties to.
 * @param {{[attribute: string]: string}} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement|SVGElement} [content] The inner content of the element, either a string or an element.
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element.
 * @param {object} [options] */
function _buildNode(ele, attrs, content, events, options) {
    if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
            ele.setAttribute(key, value);
        }
    }

    if (events) {
        addEventsToElement(ele, events, options.thisArg);
    }

    if (content) {
        if (content instanceof Element) {
            ele.appendChild(content);
        } else {
            ele.innerHTML = content;
        }
    }

    return ele;
}

/**
 * Map of existing custom events that have additional setup via the specified method.
 * @type {{ [event: string]: (ele: HTMLElement, (target: HTMLElement) => void) => void }} */
const CustomEvents = {
    longpress : addLongPressListener,
};

/**
 * Attach all specified events to the given element, with some custom handling around non-standard events.
 * @param {Element} element The element to add events to
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element.
 * @param {Element?} thisArg */
export function addEventsToElement(element, events, thisArg=null) {
    for (const [event, func] of Object.entries(events)) {
        /** @type {EventListener[]} */
        let handlers = func;
        if (!(func instanceof Array)) {
            handlers = [func];
        }

        const customEvent = CustomEvents[event];

        for (const handler of handlers) {
            if (customEvent) {
                if (thisArg) {
                    customEvent(element, handler.bind(thisArg, element));
                } else {
                    customEvent(element, handler);
                }
            } else if (thisArg) {
                element.addEventListener(event, handler.bind(thisArg, element));
            } else {
                element.addEventListener(event, handler);
            }
        }
    }
}

///
/// Element manipulation/querying.
///

/**
 * Custom jQuery-like selector method.
 * If the selector starts with '#' and contains no spaces, return the result of `querySelector`,
 * otherwise return the result of `querySelectorAll`.
 * @param {DOMString} selector The selector to match.
 * @param {HTMLElement} ele The scope of the query. Defaults to `document`. */
export function $(selector, ele = document) {
    if (selector.indexOf('#') === 0 && selector.indexOf(' ') === -1) {
        return $$(selector, ele);
    }

    return ele?.querySelectorAll(selector);
}

/**
 * Like $, but forces a single element to be returned. i.e. querySelector.
 * @param {string} selector The query selector.
 * @param {HTMLElement} [ele=document] The scope of the query. Defaults to `document`. */
export function $$(selector, ele = document) {
    return ele?.querySelector(selector);
}

/**
 * Helper that returns the element with the given id. Useful for scenarios where the id is statically
 * defined and you want to use the same value to get said element.
 * @param {string} id */
export function $id(id, ele = document) {
    return $$('#' + id, ele);
}

/** @typedef {(target: EventTarget) => void} CustomEventCallback */
/**
 * Removes all children from the given element.
 * @param {HTMLElement} ele The element to clear. */
export function $clear(ele) {
    while (ele.firstChild) {
        ele.removeChild(ele.firstChild);
    }
}

/**
 * Adds/removes a class from the given element based on the given condition.
 * @param {HTMLElement} ele
 * @param {string} className
 * @param {boolean} condition */
export function toggleClass(ele, className, condition) {
    if (condition) {
        ele.classList.add(className);
    } else {
        ele.classList.remove(className);
    }
}

export function $mobileBreak() {
    return $span(null, { class : 'mobileBreak' });
}
