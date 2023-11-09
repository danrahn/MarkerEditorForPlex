import { $$, appendChildren, buildNode } from './Common.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

import { Theme, ThemeColors } from './ThemeColors.js';
import Tooltip from './Tooltip.js';

/** @typedef {{[attribute: string]: string}} AttributeMap */

const Log = new ContextualLog('ButtonCreator');

/**
 * A static class that creates various buttons used throughout the app.
 */
class ButtonCreator {
    /**
     * Creates a tabbable button with an associated icon.
     * @param {string} text The text of the button.
     * @param {string} icon The icon to use.
     * @param {string} altText The alt-text for the button icon.
     * @param {string} color The color of the icon as a hex string (without the leading '#')
     * @param {EventListener} clickHandler The callback to invoke when the button is clicked.
     * @param {AttributeMap} attributes Additional attributes to set on the button. */
    static fullButton(text, icon, altText, color, clickHandler, attributes={}) {
        const button = ButtonCreator.#tableButtonHolder('buttonIconAndText', clickHandler, attributes);
        return appendChildren(button,
            buildNode('img', { src : Theme.getIcon(icon, color), alt : altText, theme : color }),
            buildNode('span', { class : 'buttonText' }, text));
    }

    /**
     * Creates a button with only an icon, no associated label text.
     * @param {string} icon The name of the icon to add to the button.
     * @param {string} altText The alt text for the icon image.
     * @param {string} color The color of the icon, as a hex string (without the leading '#')
     * @param {EventListener} clickHandler The button callback when its clicked.
     * @param {AttributeMap} attributes Additional attributes to set on the button. */
    static iconButton(icon, altText, color, clickHandler, attributes={}) {
        if (!attributes.title && !attributes.tooltip) { // Don't let title and custom tooltip clash
            attributes.tooltip = altText;
        }

        const button = ButtonCreator.#tableButtonHolder('buttonIconOnly', clickHandler, attributes);
        attributes.src = Theme.getIcon(icon, color);
        attributes.alt = altText;
        attributes.theme = color;
        return appendChildren(button,
            buildNode('img', { src : Theme.getIcon(icon, color), alt : altText, theme : color }));
    }

    /**
     * Creates a tabbable button that doesn't have an icon.
     * @param {string} text The text of the button.
     * @param {EventListener} clickHandler The button callback when its clicked.
     * @param {AttributeMap} [attributes={}] Additional attributes to set on the button. */
    static textButton(text, clickHandler, attributes={}) {
        const button = ButtonCreator.#tableButtonHolder('buttonTextOnly', clickHandler, attributes);
        return appendChildren(button, buildNode('span', { class : 'buttonText' }, text));
    }

    /**
     * Return a loading icon animation. Doesn't belong here, since we don't wrap
     * this in our button logic, returning a "raw" image.
     * @param {number} size
     * @param {string} color */
    static loadingIcon(size=20, attributes={}, color=ThemeColors.Primary) {
        return buildNode('img', {
            width : size,
            height : size,
            theme : color,
            src : Theme.getIcon('loading', color),
            alt : 'Loading',
            ...attributes
        });
    }

    /**
     * Sets the text of the given button.
     * @param {HTMLElement} button
     * @param {string} newText */
    static setText(button, newText) {
        const span = $$('.buttonText', button);
        if (!span) {
            Log.warn('Called setText on non-text button!');
        }

        span.innerText = newText;
    }

    /**
     * Sets the icon of the given button.
     * @param {HTMLElement} button
     * @param {string} newIcon
     * @param {string} theme */
    static setIcon(button, newIcon, theme) {
        const img = $$('img', button);
        if (!img) {
            Log.warn('Called setIcon on non-icon button!');
        }

        img.src = Theme.getIcon(newIcon, theme);
    }

    /**
     * Returns an empty button with the given class
     * @param {string} className The class name to give this button.
     * @param {EventListener} clickHandler The callback function when the button is clicked.
     * @param {AttributeMap} attributes Additional attributes to set on the button. */
    static #tableButtonHolder(className, clickHandler, attributes) {
        const button = buildNode(
            'div',
            { class : `button noSelect ${className}`, tabindex : '0' },
            0,
            { keydown : ButtonCreator.#tableButtonKeydown });

        // Add click handler after initial create, since we want to pass in the button itself.
        // We do this because sometimes we want to act on this button, and e.target might be an
        // inner element of this "button", and it's better to have direct access to it instead of
        // reaching into the internals of the button to grab the right button div.
        button.addEventListener('click', (e) => {
            // Disabled buttons don't do anything.
            if (!button.classList.contains('disabled')) {
                clickHandler(e, button);
            }
        });

        for (const [attribute, value] of Object.entries(attributes)) {
            if (attribute === 'class') { // Don't clash with the other classes set above.
                for (const singleClass of value.split(' ')) {
                    button.classList.add(singleClass);
                }
            } else if (attribute === 'tooltip') {
                Tooltip.setTooltip(button, value);
            } else if (attribute === 'auxclick') {
                button.addEventListener('auxclick', (e) => {
                    // Disabled buttons don't do anything.
                    if (!button.classList.contains('disabled')) {
                        clickHandler(e, button);
                    }
                });
            } else {
                button.setAttribute(attribute, value);
            }
        }

        return button;
    }

    /**
     * Treat 'Enter' on a table "button" as a click.
     * @param {KeyboardEvent} e */
    static #tableButtonKeydown(e) {
        // Only care about 'Enter', and don't send multiple 'click' events
        // if someone's holding down a key.
        if (e.key !== 'Enter' || e.repeat) {
            return;
        }

        e.preventDefault();

        // For now, click target is either the button itself or the inner image/text, if available.
        // Extract the "real" button based on those assumptions.
        /** @type {HTMLElement} */
        let button = e.target;
        if (button.tagName.toLowerCase() !== 'div') {
            button = button.parentNode;
        }

        // Don't send a raw .click(), but dispatch a new MouseEvent
        // to ensure we properly capture any modifier key states.
        const mouseEvent = new MouseEvent('click', {
            ctrlKey : e.ctrlKey,
            shiftKey : e.shiftKey,
            altKey : e.altKey,
            metaKey : e.metaKey
        });

        button.dispatchEvent(mouseEvent);
    }
}

export default ButtonCreator;
