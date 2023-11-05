import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';

/** @typedef {!import('../../Shared/PlexTypes.js').ChapterData} ChapterData */
/** @typedef {!import('../../Shared/PlexTypes.js').ChapterMap} ChapterMap */

/**
 * Verifies the behavior of querying for chapter data for media items.
 */
class ChapterTest extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.testNoChapters,
            this.testNamedChapters,
            this.testUnnamedChapters,
            this.testMultipleParts,
            this.testSeasonChapters,
            this.testShowChapters,
        ];
    }

    className() { return 'ChapterTest'; }

    async testNoChapters() {
        // Show2, S01E01 has no chapters (see setupPlexDbTestTables)
        const id = TestBase.DefaultMetadata.Show2.Season1.Episode1.Id;
        /** @type {ChapterMap} */
        const data = await this.send('get_chapters', { id });
        this.#verifyResultKeys(data, [id]);
        TestHelpers.verify(data[id].length === 0, `Expected an empty chapter array, found ${data[id].length}.`);
    }

    async testNamedChapters() {
        const id = TestBase.DefaultMetadata.Show1.Season2.Episode1.Id;
        /** @type {ChapterMap} */
        const data = await this.send('get_chapters', { id });
        this.#verifyResultKeys(data, [id]);

        // Based on setupPlexDbTestTables's testChapters
        const chapters = data[id];
        this.#verifyChapters(chapters, 7, 'PART');
    }

    async testUnnamedChapters() {
        const id = TestBase.DefaultMetadata.Show1.Season1.Episode3.Id;
        /** @type {ChapterMap} */
        const data = await this.send('get_chapters', { id });
        this.#verifyResultKeys(data, [id]);
        this.#verifyChapters(data[id], 6);
    }

    async testMultipleParts() {
        // Test two scenarios - one where the first part is empty and the second has chapters,
        // and where the first part has chapters and the second doesn't. Ensure in both cases that
        // we pick up the item with chapters.
        let id = TestBase.DefaultMetadata.Show1.Season1.Episode1.Id;
        /** @type {ChapterMap} */
        let data = await this.send('get_chapters', { id });
        this.#verifyResultKeys(data, [id]);
        this.#verifyChapters(data[id], 4, 'ch');

        id = TestBase.DefaultMetadata.Show1.Season1.Episode2.Id;
        data = await this.send('get_chapters', { id });
        this.#verifyResultKeys(data, [id]);
        this.#verifyChapters(data[id], 5, 'part');
    }

    async testSeasonChapters() {
        const season = TestBase.DefaultMetadata.Show1.Season1;
        const id = season.Id;
        /** @type {ChapterMap} */
        const data = await this.send('get_chapters', { id });
        this.#verifyResultKeys(data, [season.Episode1.Id, season.Episode2.Id, season.Episode3.Id]);
        this.#verifyChapters(data[season.Episode1.Id], 4, 'ch');
        this.#verifyChapters(data[season.Episode2.Id], 5, 'part');
        this.#verifyChapters(data[season.Episode3.Id], 6);
    }

    async testShowChapters() {
        const show = TestBase.DefaultMetadata.Show1;
        const id = show.Id;
        /** @type {ChapterMap} */
        const data = await this.send('get_chapters', { id });
        this.#verifyResultKeys(data, [
            show.Season1.Episode1.Id,
            show.Season1.Episode2.Id,
            show.Season1.Episode3.Id,
            show.Season2.Episode1.Id]
        );

        this.#verifyChapters(data[show.Season1.Episode1.Id], 4, 'ch');
        this.#verifyChapters(data[show.Season1.Episode2.Id], 5, 'part');
        this.#verifyChapters(data[show.Season1.Episode3.Id], 6);
        this.#verifyChapters(data[show.Season2.Episode1.Id], 7, 'PART');
    }

    /**
     * Verify that the ChapterMap returned has data for the given ids, and only the given ids.
     * @param {ChapterMap} data
     * @param {number[]} ids */
    #verifyResultKeys(data, ids) {
        TestHelpers.verify(data, `Unexpected response from chapter query.`);
        const keyLen = Object.keys(data).length;
        TestHelpers.verify(keyLen === ids.length,
            `Expected chapter query to return data for ${ids.length} items, found ${keyLen}`);
        for (const id of ids) {
            TestHelpers.verify(data[id], `Expected chapter query to return data for ${id}, but it wasn't found.`);
        }
    }

    /**
     * Verify chapter data is the expected length and has the expected fields.
     * @param {ChapterData[]} chapters
     * @param {number} count Expected chapter count
     * @param {string} prefix Expected chapter name prefix */
    #verifyChapters(chapters, count, prefix) {
        TestHelpers.verify(chapters.length === count, `Expected chapters to have ${count} items, found ${chapters.length}.`);
        for (const chapter of chapters) {
            const keyLen = Object.keys(chapter).length;
            TestHelpers.verify(keyLen === 3, `Each chapter should have 3 values, found ${keyLen}`);
            TestHelpers.verify(chapter.name !== undefined, `Each chapter should have a name (even if empty), but none was found`);
            if (prefix) {
                TestHelpers.verify(chapter.name.startsWith(prefix), `Unexpected chapter name`);
            } else {
                TestHelpers.verify(chapter.name.length === 0, `Expected unnamed chapter, found a name`);
            }

            TestHelpers.verify(chapter.start !== undefined, `Each chapter should have a start timestamp, but none was found.`);
            TestHelpers.verify(chapter.end !== undefined, `Each chapter should have an end timestamp, but none was found.`);
        }
    }
}

export default ChapterTest;
