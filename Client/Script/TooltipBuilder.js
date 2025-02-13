import { $append, $br, $span, $text } from './HtmlHelpers.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';

const Log = ContextualLog.Create('TTBuilder');

export default class TooltipBuilder {
    /** @type {HTMLElement[]} */
    #elements = [];

    /** @type {HTMLElement?} */
    #cached = null;

    /**
     * @param {...(string|Element)} lines */
    constructor(...lines) {
        this.addLines(...lines);
    }

    /**
     * @param {(string|Element)[]} lines */
    addLine(line) {
        this.addLines(line);
    }

    /**
     * Adds each item to the tooltip, without inserting breaks between elements.
     * @param  {...(string|Element)} items */
    addRaw(...items) {
        for (const item of items) {
            this.#elements.push(item instanceof Element ? item : $text(item));
        }
    }

    /**
     * Clears out the old content with the new content.
     * @param  {...(string|HTMLElement)} lines */
    set(...lines) {
        this.#elements.length = 0;
        this.addLines(...lines);
    }

    /**
     * Clears out the old content with the new content, without
     * automatic line breaks.
     * @param  {...(string|HTMLElement)} items */
    setRaw(...items) {
        this.#elements.length = 0;
        this.set(...items);
    }

    /**
     * @param {(string|Element)[]} lines */
    addLines(...lines) {
        if (this.#cached) {
            // We already have a cached value. Subsequent get()'s will steal elements from the
            // previous get() unless we clone the existing elements.
            Log.warn(`Adding content after previously retrieving tooltip. Cloning existing nodes`);
            for (let i = 0; i < this.#elements.length; ++i) {
                this.#elements[i] = this.#elements[i].cloneNode(true /*deep*/);
            }

            this.#cached = null;
        }

        for (const line of lines) {
            if (this.#elements.length > 0) {
                this.#elements.push($br());
            }

            this.#elements.push(line instanceof Element ? line : $text(line));
        }
    }

    /** Return whether this tooltip has no content. */
    empty() { return this.#elements.length === 0; }

    /** Retrieve a span containing all tooltip elements. */
    get() {
        if (this.#cached) {
            return this.#cached;
        }

        this.#cached = $append($span(), ...this.#elements);
        return this.#cached;
    }
}
