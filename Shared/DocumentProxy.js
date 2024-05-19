/**
 * Acts as a proxy for test code, where document isn't always defined because my test infra is bad.
 */

class DocumentMock {
    body = {
        clientWidth : 10000
    };
}

/** @type {Document} */ // Tell intellisense to always treat this like a real document
const DocumentProxy = typeof window === 'undefined' ? new DocumentMock() : document;
export default DocumentProxy;
