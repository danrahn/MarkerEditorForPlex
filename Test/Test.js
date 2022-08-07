import TestRunner from './TestRunner.js'

// Run all available tests. Note that the entire Test folder is something of a
// stream of consciousness proof-of-concept, so is a bit messy and doesn't follow
// the best patterns, but it gets the job done.
await new TestRunner().runAll();
