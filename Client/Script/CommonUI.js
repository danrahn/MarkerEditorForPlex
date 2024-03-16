import { appendChildren, buildNode } from './Common.js';
import { BaseLog } from '/Shared/ConsoleLog.js';

/**
 * Creates a themed checkbox
 * @param {{[attribute: string]: string}} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events to attach to the element.
 * @param {{[property: string]: any}} [labelProps] Properties to apply to the label masquerading as the checkbox. */
export function customCheckbox(attrs={}, events={}, labelProps={}, options={}) {
    BaseLog.assert(!attrs.type, `customCheckbox attributes shouldn't include "type"`);
    const checkedAttr = Object.prototype.hasOwnProperty.call(attrs, 'checked');
    let shouldCheck = false;
    if (checkedAttr) {
        shouldCheck = attrs.checked;
        delete attrs.checked;
    }

    const checkbox = buildNode('input', { type : 'checkbox', ...attrs }, 0, events, options);
    if (shouldCheck) {
        checkbox.checked = true;
    }

    // This is the "real" checkbox that can be styled however we see fit, unlike standard checkboxes.
    const label = buildNode('label', { for : checkbox.getAttribute('id'), class : 'customCheckbox' });
    for (const [key, value] of Object.entries(labelProps)) {
        if (key === 'class') {
            value.split(' ').forEach(c => label.classList.add(c));
        } else {
            label.setAttribute(key, value);
        }
    }

    return appendChildren(
        buildNode('div', { class : 'customCheckboxContainer' }),
        appendChildren(
            buildNode('div', { class : 'customCheckboxInnerContainer noSelect' }),
            checkbox,
            label
        )
    );
}
