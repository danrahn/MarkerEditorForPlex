import { appendChildren, buildNode } from "./Common.js";
import ThemeColors from "./ThemeColors.js";

/** @typedef {{[attribute: string]: string}} AttributeMap */

/**
 * A static class that creates various buttons used throughout the app.
 */
class ButtonCreator {
    /**
     * Creates a tabbable button in the marker table with an associated icon.
     * @param {string} text The text of the button.
     * @param {string} icon The icon to use.
     * @param {string} altText The alt-text for the button icon.
     * @param {string} color The color of the icon as a hex string (without the leading '#')
     * @param {EventListener} clickHandler The callback to invoke when the button is clicked.
     * @param {AttributeMap} attributes Additional attributes to set on the button.
     * @param {*} [thisArg=null] The argument to bind as `this` in `clickHandler`, if any. */
    static fullButton(text, icon, altText, color, clickHandler, attributes={}, thisArg=null) {
        let button = ButtonCreator.#tableButtonHolder('buttonIconAndText', clickHandler, attributes, thisArg);
        return appendChildren(button,
            buildNode('img', { src : ThemeColors.getIcon(icon, color), alt : altText, theme : color }),
            buildNode('span', {}, text));
    }

    /**
     * Creates a button with only an icon, no associated label text.
     * @param {string} icon The name of the icon to add to the button.
     * @param {string} altText The alt text for the icon image.
     * @param {string} color The color of the icon, as a hex string (without the leading '#')
     * @param {EventListener} clickHandler The button callback when its clicked.
     * @param {AttributeMap} attributes Additional attributes to set on the button.
     * @param {*} [thisArg=null] The argument to bind as `this` in `clickHandler`, if any. */
    static iconButton(icon, altText, color, clickHandler, attributes={}, thisArg=null) {
        if (!attributes.title) {
            attributes.title = altText;
        }
        let button = ButtonCreator.#tableButtonHolder('buttonIconOnly', clickHandler, attributes, thisArg);
        attributes.src = ThemeColors.getIcon(icon, color);
        attributes.alt = altText;
        attributes.theme = color;
        return appendChildren(button,
            buildNode('img', { src : ThemeColors.getIcon(icon, color), alt : altText, theme : color }));
    }
    /**
     * Creates a tabbable button in the marker table that doesn't have an icon.
     * @param {string} text The text of the button.
     * @param {EventListener} clickHandler The button callback when its clicked.
     * @param {AttributeMap} [attributes={}] Additional attributes to set on the button.
     * @param {*} [thisArg=null] The argument to bind as `this` in `clickHandler`, if any. */
    static textButton(text, clickHandler, attributes={}, thisArg=null) {
        let button = ButtonCreator.#tableButtonHolder('buttonTextOnly', clickHandler, attributes, thisArg);
        return appendChildren(button, buildNode('span', {}, text));
    }


    /**
     * Returns an empty button with the given class
     * @param {string} className The class name to give this button.
     * @param {EventListener} clickHandler The callback function when the button is clicked.
     * @param {AttributeMap} attributes Additional attributes to set on the button.
     * @param {*} [thisArg=null] The argument to bind as `this` in `clickHandler`, if any. */
    static #tableButtonHolder(className, clickHandler, attributes, thisArg) {
        let button = buildNode(
            'div',
            { class : `button noSelect ${className}`, tabindex : '0' },
            0,
            { click : clickHandler, keyup : ButtonCreator.tableButtonKeyup },
            { thisArg : thisArg });
        for (const [attribute, value] of Object.entries(attributes)) {
            if (attribute == 'class') { // Don't clash with the other classes set above.
                for (const className of value.split(' ')) {
                    button.classList.add(className);
                }
            } else {
                button.setAttribute(attribute, value);
            }
        }

        return button;
    }

    /**
     * Treat 'Enter' on a table "button" as a click.
     * @param {HTMLElement} button
     * @param {KeyboardEvent} e */
    static tableButtonKeyup(button, e) {
        if (e.key == 'Enter') {
            e.preventDefault();
            button.click();
        }
    }
}

export default ButtonCreator
