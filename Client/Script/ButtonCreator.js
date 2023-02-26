import { $$, appendChildren, buildNode } from './Common.js';
import { Log } from '../../Shared/ConsoleLog.js';

import Tooltip from './inc/Tooltip.js';

import ThemeColors from './ThemeColors.js';

/** @typedef {{[attribute: string]: string}} AttributeMap */

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
            buildNode('img', { src : ThemeColors.getIcon(icon, color), alt : altText, theme : color }),
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
        if (!attributes.title) {
            attributes.title = altText;
        }

        const button = ButtonCreator.#tableButtonHolder('buttonIconOnly', clickHandler, attributes);
        attributes.src = ThemeColors.getIcon(icon, color);
        attributes.alt = altText;
        attributes.theme = color;
        return appendChildren(button,
            buildNode('img', { src : ThemeColors.getIcon(icon, color), alt : altText, theme : color }));
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
     * Returns an empty button with the given class
     * @param {string} className The class name to give this button.
     * @param {EventListener} clickHandler The callback function when the button is clicked.
     * @param {AttributeMap} attributes Additional attributes to set on the button. */
    static #tableButtonHolder(className, clickHandler, attributes) {
        const button = buildNode(
            'div',
            { class : `button noSelect ${className}`, tabindex : '0' },
            0,
            { keyup : ButtonCreator.tableButtonKeyup });

        // Add click handler after initial create, since we want to pass in the button itself.
        // We do this because sometimes we want to act on this button, and e.target might be an
        // inner element of this "button", and it's better to have direct access to it instead of
        // reaching into the internals of the button to grab the right button div.
        button.addEventListener('click', (e) => { clickHandler(e, button); });
        for (const [attribute, value] of Object.entries(attributes)) {
            if (attribute == 'class') { // Don't clash with the other classes set above.
                for (const className of value.split(' ')) {
                    button.classList.add(className);
                }
            } else if (attribute == 'tooltip') {
                Tooltip.setTooltip(button, value);
            } else if (attribute == 'auxclick') {
                button.addEventListener('auxclick', (e) => { clickHandler(e, button); });
            } else {
                button.setAttribute(attribute, value);
            }
        }

        return button;
    }

    /**
     * Treat 'Enter' on a table "button" as a click.
     * @param {KeyboardEvent} e */
    static tableButtonKeyup(e) {
        if (e.key != 'Enter') {
            return;
        }

        e.preventDefault();

        // For now, click target is either the button itself or the inner image/text, if available.
        // Extract the "real" button based on those assumptions.
        let button = e.target;
        if (button.tagName.toLowerCase() != 'div') {
            button = button.parentNode;
        }

        button.click();
    }
}

export default ButtonCreator;
