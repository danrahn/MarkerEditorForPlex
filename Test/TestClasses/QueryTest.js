import { SeasonData, ShowData } from '../../Shared/PlexTypes.js';
import TestBase from '../TestBase.js'
import TestHelpers from '../TestHelpers.js';

/**
 * Tests various query endpoints
 */
class QueryTest extends TestBase {

    constructor() {
        super();
        this.testMethods = [
            this.getSectionsTest,

            this.getSectionTest,
            this.getEmptySectionTest,
            this.getMovieSectionTest,
            this.getInvalidSectionTest,

            this.getSeasonsTest,
            this.getEmptySeasonTest,
            this.getNonShowSeasonTest,
            this.getInvalidSeasonTest,

            this.getEpisodesTest,
            this.getEmptyEpisodesTest,
            this.getNonSeasonEpisodesTest,
            this.getInvalidEpisodesTest,
        ];
    }

    className() { return 'QueryTest'; }


     /////////////////////
    /// get_sections

    /**
     * Ensure the right library data is returned from get_sections. */
    async getSectionsTest() {
        const result = await this.send('get_sections');

        // Currently database only has one section
        TestHelpers.verify(result instanceof Array, `Expected get_sections to return an array.`);
        TestHelpers.verify(result.length == 1, `Only expected 1 library section, found ${result.length}.`);
        const lib = result[0];
        TestHelpers.verify(lib.id == 1, `Expected library section to have an id of 1, found ${lib.id}.`);
        TestHelpers.verify(lib.name == 'TV', `Expected library name to be TV, found ${lib.name}.`);
    }

     /////////////////////
    /// get_section

    /**
     * Ensure shows returned from the first library matches what we expect. */
    async getSectionTest() {
        /** @type {ShowData[]} */
        const result = await this.send('get_section', { id : 1 });

        const shows = TestBase.DefaultMetadata;
        const showCount = Object.keys(shows).length;
        TestHelpers.verify(result.length == showCount, `Expected ${showCount} shows, found ${result.length}`);
        for (const showResult of result) {
            const expectedShow = shows[showResult.title];
            TestHelpers.verify(expectedShow, `get_section returned unknown show "${showResult.title}"`);
            TestHelpers.verify(showResult.metadataId == expectedShow.Id, `Found metadata id ${showResult.metadataId} for ${showResult.title}, expected ${expectedShow.Id}.`);
            const expectedSeasons = this.#expectedCount(expectedShow); // -1 for ID field
            TestHelpers.verify(showResult.seasonCount == expectedSeasons, `Expected ${showResult.title} to have ${expectedSeasons} season(s), found ${showResult.seasonCount}`);
            const expectedEpisodes = this.#expectedEpisodeCount(expectedShow);
            TestHelpers.verify(showResult.episodeCount == expectedEpisodes, `Expected ${showResult.title} to have ${expectedEpisodes} episode(s), found ${expectedEpisodes}`);
        }
    }

    /**
     * Ensure no data is returned when querying for an invalid library section. */
    async getEmptySectionTest() {
        const result = await this.send('get_section', { id : 10 });
        TestHelpers.verify(result instanceof Array, `Expected get_section of a nonexistent library to still return an array.`);
        TestHelpers.verify(result.length == 0, `Expected get_section of nonexistent library to return an empty array.`);
    }

    /**
     * Ensure no data is returned when querying for a movie section. */
    async getMovieSectionTest() {
        const result = await this.send('get_section', { id : 2 });
        TestHelpers.verify(result instanceof Array, `Expected get_section of a movie library to still return an array.`);
        TestHelpers.verify(result.length == 0, `Expected get_section of movie library to return an empty array.`);
    }

    /**
     * Parameter check - ensure invalid query parameters result in failure */
    async getInvalidSectionTest() {
        this.expectFailure();

        // Non-integer
        let response = await this.send('get_section', { id : 'a' }, true /*raw*/);
        TestHelpers.verifyBadRequest(response);

        // No id
        response = await this.send('get_section', {}, true /*raw*/);
        TestHelpers.verifyBadRequest(response);
    }


     /////////////////////
    /// get_seasons

    /**
     * Ensure the right season data is returned for the given show id. */
    async getSeasonsTest() {
        for (const testShow of [TestBase.DefaultMetadata.Show1, TestBase.DefaultMetadata.Show2]) {
            /** @type {SeasonData[]} */
            const seasons = await this.send('get_seasons', { id : testShow.Id });
            TestHelpers.verify(seasons && seasons instanceof Array, `Expected get_seasons to return an array.`);
            const expectedSeasons = this.#expectedCount(testShow);
            TestHelpers.verify(seasons.length == expectedSeasons, `Expected ${expectedSeasons} season(s), found ${seasons.length}`);
            for (const season of seasons) {
                TestHelpers.verify(testShow[season.title], `Got unexpected season "${season.title}" from get_seasons.`);
                const expectedEpisodes = this.#expectedCount(testShow[season.title]);
                TestHelpers.verify(season.episodeCount == expectedEpisodes, `Expected season ${season.title} to have ${expectedEpisodes} episodes, found ${season.episodeCount}.`);
            }
        }
    }

    /**
     * Ensure no data is returned when a nonexistent metadata id is provided. */
    async getEmptySeasonTest() {
        const result = await this.send('get_seasons', { id : 200 });
        TestHelpers.verify(result instanceof Array, `Expected get_seasons of a nonexistent metadata id to still return an array.`);
        TestHelpers.verify(result.length == 0, `Expected get_seasons of a nonexistent metadata id to return an empty array.`);
    }

    /**
     * Ensure not data is returned when a non-show metadata id is provided. */
    async getNonShowSeasonTest() {
        // Pass in a season id
        let result = await this.send('get_seasons', { id : TestBase.DefaultMetadata.Show1.Season1.Id });
        TestHelpers.verify(result instanceof Array, `Expected get_seasons of a season metadata id to still return an array.`);
        TestHelpers.verify(result.length == 0, `Expected get_seasons of a season metadata id to return an empty array.`);

        // Pass in an episode id
        result = await this.send('get_seasons', { id : TestBase.DefaultMetadata.Show1.Season1.Episode1.Id });
        TestHelpers.verify(result instanceof Array, `Expected get_seasons of an episode metadata id to still return an array.`);
        TestHelpers.verify(result.length == 0, `Expected get_seasons of an episode metadata id to return an empty array.`);
    }

    /**
     * Parameter check - ensure invalid query parameters result in failure */
    async getInvalidSeasonTest() {
        this.expectFailure();

        // Non-integer
        let response = await this.send('get_seasons', { id : 'a' }, true /*raw*/);
        TestHelpers.verifyBadRequest(response);

        // No id
        response = await this.send('get_seasons', {}, true /*raw*/);
        TestHelpers.verifyBadRequest(response);
    }


     /////////////////////
    /// get_episodes

    async getEpisodesTest() {
        const testShow = TestBase.DefaultMetadata.Show1;
        for (const testSeason of [testShow.Season1, testShow.Season2]) {
            /** @type {EpisodeData[]} */
            const episodes = await this.send('get_episodes', { id : testSeason.Id });
            TestHelpers.verify(episodes && episodes instanceof Array, `Expected get_seasons to return an array.`);
            const expectedEpisodes = this.#expectedCount(testSeason);
            TestHelpers.verify(episodes.length == expectedEpisodes, `Expected ${expectedEpisodes} season(s), found ${episodes.length}`);
            for (const episode of episodes) {
                TestHelpers.verify(testSeason[episode.title], `Got unexpected episode "${episode.title}" from get_episodes.`);
                TestHelpers.verify(episode.showName == 'Show1', `Expected episode's show name to be Show1, found ${episode.showName}.`);
            }
        }
    }

    /**
     * Ensure no data is returned when a nonexistent metadata id is provided. */
    async getEmptyEpisodesTest() {
        const result = await this.send('get_episodes', { id : 200 });
        TestHelpers.verify(result instanceof Array, `Expected get_episodes of a nonexistent metadata id to still return an array.`);
        TestHelpers.verify(result.length == 0, `Expected get_episodes of a nonexistent metadata id to return an empty array.`);
    }

    /**
     * Ensure not data is returned when a non-season metadata id is provided. */
    async getNonSeasonEpisodesTest() {
        // Pass in a show id
        let result = await this.send('get_episodes', { id : TestBase.DefaultMetadata.Show1.Id });
        TestHelpers.verify(result instanceof Array, `Expected get_episodes of a show metadata id to still return an array.`);
        TestHelpers.verify(result.length == 0, `Expected get_episodes of a show metadata id to return an empty array.`);

        // Pass in an episode id
        result = await this.send('get_episodes', { id : TestBase.DefaultMetadata.Show1.Season1.Episode1.Id });
        TestHelpers.verify(result instanceof Array, `Expected get_episodes of an episode metadata id to still return an array.`);
        TestHelpers.verify(result.length == 0, `Expected get_episodes of an episode metadata id to return an empty array.`);
    }

    /**
     * Parameter check - ensure invalid query parameters result in failure */
    async getInvalidEpisodesTest() {
        this.expectFailure();

        // Non-integer
        let response = await this.send('get_episodes', { id : 'a' }, true /*raw*/);
        TestHelpers.verifyBadRequest(response);

        // No id
        response = await this.send('get_episodes', {}, true /*raw*/);
        TestHelpers.verifyBadRequest(response);
    }

    /**
     * Return the number of episodes in the given test data.
     * @param {*} showData */
    #expectedEpisodeCount(showData) {
        let count = 0;
        for (const [season, data] of Object.entries(showData)) {
            if (season == 'Id') { continue; }
            count += this.#expectedCount(data);
        }

        return count;
    }

    /**
     * Test data is free-form, so have this helper figure out the number of "real"
     * items are inside of the object (i.e. excluding other identifiers like Id).
     * @param {*} obj */
    #expectedCount(obj) {
        return Object.keys(obj).length - 1;
    }
}


export default QueryTest;
