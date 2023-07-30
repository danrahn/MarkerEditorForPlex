/**
 * Acts as a proxy for shared (and test) code that is used in backend (Node.js) and frontend (DOM)
 * environments, where window isn't always defined.
 */


class LocalStorageMock {
    constructor() { this._dict = {}; }
    getItem(item) { return this._dict[item]; }
    setItem(item, value) { this._dict[item] = value; }
}
class WindowMock {
    localStorage = new LocalStorageMock();
    matchMedia() { return false; }
    addEventListener() { }
}

/** @type {Window} */ // Tell intellisense to always treat this like a real window
const WindowProxy = typeof window === 'undefined' ? new WindowMock() : window;
export default WindowProxy;
