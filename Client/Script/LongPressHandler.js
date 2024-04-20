
/** @typedef {!import('./Common').CustomEventCallback} CustomEventCallback */

/**
 * Data to keep track of touch events.
 */
class TouchData {
    /** @type {EventTarget} */
    target = null;
    /** The screen x/y during the first touch */
    startCoords = { x : 0, y : 0 };
    /** The current touch coordinates, updated after every touchmove. */
    currentCoords = { x : 0, y : 0 };
    /** Timer set after a touchstart */
    timer = 0;
    /** Clear out any existing touch data. */
    clear() {
        this.target = null;
        this.startCoords = { x : 0, y : 0 };
        this.currentCoords = { x : 0, y : 0 };
        if (this.timer) {
            clearTimeout(this.timer);
        }
    }
}

/** List of events we want to listen to. */
const events = [ 'touchstart', 'touchmove', 'touchend' ];

/**
 * Handles a single element's "longpress" listener, triggering a callback if
 * the user has a single press for one second.
 */
class LongPressHandler {
    /** @type {TouchData} */
    #touches;

    /** @type {CustomEventCallback} */
    #callback;

    /**
     * @param {HTMLElement} element
     * @param {CustomEventCallback} callback */
    constructor(element, callback) {
        this.#callback = callback;
        this.#touches = new TouchData();
        for (const event of events) {
            element.addEventListener(event, this.#handleTouch.bind(this), { passive : true });
        }
    }

    /**
     * @param {TouchEvent} e */
    #handleTouch(e) {
        switch (e.type) {
            default:
                return;
            case 'touchstart':
                if (e.touches.length !== 1) {
                    this.#touches.clear();
                    return;
                }

                this.#touches.target = e.target;
                this.#touches.startCoords = { x : e.touches[0].clientX, y : e.touches[0].clientY };
                this.#touches.currentCoords = { x : e.touches[0].clientX, y : e.touches[0].clientY };
                this.#touches.timer = setTimeout(this.#checkCurrentTouch.bind(this), 1000);
                break;
            case 'touchmove':
                if (!this.#touches.timer || e.touches.length !== 1) {
                    this.#touches.clear();
                    return;
                }

                this.#touches.currentCoords = { x : e.touches[0].clientX, y : e.touches[0].clientY };
                break;
            case 'touchend':
                this.#touches.clear();
                break;
        }
    }

    /**
     * Triggered one second after the first touch, if touchend hasn't been fired.
     * If our final touch point isn't too far away from the initial point, trigger the callback. */
    #checkCurrentTouch() {
        const diffX = Math.abs(this.#touches.currentCoords.x - this.#touches.startCoords.x);
        const diffY = Math.abs(this.#touches.currentCoords.y - this.#touches.startCoords.y);

        // Allow a bit more horizontal leeway than vertical.
        if (diffX < 20 && diffY < 10) {
            this.#callback(this.#touches.target);
        }

        this.#touches.clear();
    }
}

/**
 * Add a "longpress" listener to the given element, triggering the callback if a
 * single touch lasts for one second and hasn't moved from the original touch point.
 * @param {HTMLElement} element
 * @param {CustomEventCallback} callback */
export function addLongPressListener(element, callback) {
    new LongPressHandler(element, callback);
}
