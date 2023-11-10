import { ContextualLog } from '../../Shared/ConsoleLog.js';

import { buildNode, buildNodeNS } from './Common.js';

/** @typedef {!import('./Icons').IconKeys} IconKeys */
/** @typedef {!import('./ThemeColors').ThemeColorKeys} ThemeColorKeys */

const Log = new ContextualLog('SVGCache');

/**
 * Subset of attributes that we expect might be set on an SVG
 * TODO: title/desc on icons for a11y. aria labels too, but that's a project-wide issue.
 * @typedef {{
 *      id?: string,
 *      class?: string,
 *      width?: number,
 *      height?: number }} SVGAttributes
 * */

/**
 * Placeholder node to clone and return when we don't have
 * a particular SVG icon cached.
 * @type {SVGElement} */
let staticPlaceholder;

/**
 * Retrieve the placeholder SVG element. It's only a method because
 * adding buildNodeNS to the top-level scope causes my bad test infra
 * to fail attempting to call document.createElementNS */
function getPlaceholder() {
    return staticPlaceholder ??= buildNodeNS(
        'http://www.w3.org/2000/svg',
        'svg',
        {
            viewBox : `0 0 16 16`,
            xmlns : 'http://www.w3.org/2000/svg',
            x : 0,
            y : 0
        }
    );
}

/**
 * Cache of all icon's that we've retrieved to avoid asking the server
 * for the same icon over and over.
 * @type {Map<string, SVGElement} */
const svgCache = new Map();

/**
 * Keeps track of in-progress requests so when we e.g. add 100 expand/collapse arrows
 * at the same time, we only ask the server for it once.
 * @type {Map<string, Promise<void>} */
const svgFetchMap = new Map();

/**
 * Sets the cached SVG element for the given icon, given the raw XML for the icon.
 * @param {string} iconName
 * @param {string} svgString */
function setCache(iconName, svgString) {
    svgCache.set(iconName, buildNode('div', 0, svgString).firstChild);
}

/**
 * Set attributes on the SVG element.
 * @param {SVGElement} svg
 * @param {keyof ThemeColorKeys} color
 * @param {SVGAttributes} attributes */
function setSvgAttributes(svg, color, attributes={}) {
    for (const [attribute, value] of Object.entries(attributes)) {
        switch (attribute) {
            case 'class':
                for (const className of value.split(' ')) {
                    svg.classList.add(className);
                }
                break;
            default:
                svg.setAttribute(attribute, value);
        }
    }

    // Static attributes that we always want to add
    svg.classList.add(`themeIcon${color}`);
    svg.setAttribute('role', 'img');
}

/**
 * Retrieve the raw SVG data, cache it, and replace the placeholder
 * with the real data.
 * @param {keyof Icons} iconName
 * @param {keyof ThemeColorKeys} color
 * @param {SVGAttributes} attributes
 * @param {SVGElement} [placeholder] */
async function getSvgAsync(iconName, color, attributes, placeholder) {
    Log.assert(!svgCache.has(iconName), `We should only be asking the server for data if it's not cached.`);
    if (svgFetchMap.get(iconName)) {
        Log.tmi(`Already requesting data for "${iconName}", waiting...`);
    } else {
        svgFetchMap.set(iconName, new Promise(resolve => {
            fetch(`/i/${iconName}.svg`, { headers : { accept : 'image/svg+xml' } }).then(r => r.text().then(data => {
                Log.verbose(`Got SVG data for "${iconName}", caching it.`);
                setCache(iconName, data);
                resolve();
            }));
        }));
    }

    try {
        await svgFetchMap.get(iconName);
        svgFetchMap.delete(iconName);
    } catch (ex) {
        Log.error(`Failed to get SVG icon for ${iconName}. Keeping placeholder`);
        return;
    }

    const svg = svgCache.get(iconName).cloneNode(true /*deep*/);
    setSvgAttributes(svg, color, attributes);

    placeholder?.replaceWith(svg);
}

/**
 * Retrieves the SVG icon with the given name.
 * If the SVG isn't cached, returns a placeholder icon that
 * will be replaced once the data is retrieved.
 *
 * NOTE: This means that you shouldn't immediately attach any
 *       listeners/additional properties to the element that is
 *       returned. Instead, a wrapper around this element should
 *       be used for any event/dynamic handling.
 * @param {keyof IconKeys} iconName
 * @param {keyof ThemeColorKeys} color
 * @param {SVGAttributes} attributes
 * @returns {SVGElement} */
export function getSvgIcon(iconName, color, attributes={}) {
    if (svgCache.has(iconName)) {
        const svg = svgCache.get(iconName).cloneNode(true /*deep*/);
        setSvgAttributes(svg, color, attributes);
        return svg;
    }

    const placeholder = getPlaceholder().cloneNode();
    setSvgAttributes(placeholder, color, attributes);

    getSvgAsync(iconName, color, attributes, placeholder);
    return placeholder;
}
