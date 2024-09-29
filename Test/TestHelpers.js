/* eslint-disable max-len */
/** @typedef {!import('../Server/SqliteDatabase').default} SqliteDatabase */
/** @typedef {!import('../Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */

/**
 * Class that contains helper methods used by various tests.
 */
class TestHelpers {

    /**
     * Validate an added/edited/deleted marker to ensure it matches both what is expected,
     * and what is actually in the database. If an expected value is null, then it is not validated.
     * @param {SerializedMarkerData} markerData The marker to validate. May also be a Failure response ({ Error : string })
     * @param {string?} expectedType
     * @param {number?} expectedEpisodeId
     * @param {number?} expectedSeasonId
     * @param {number?} expectedShowId
     * @param {number?} expectedStart
     * @param {number?} expectedEnd
     * @param {number?} expectedIndex
     * @param {boolean?} expectedFinal
     * @param {SqliteDatabase?} database The test database
     * @param {boolean} isDeleted Whether markerData is a deleted marker (i.e. we should verify it doesn't exist in the database)
     * @throws if the marker is not valid.
     * TODO: indexRemove: replace index with order for all callers.
     */
    static async validateMarker(
        markerData,
        expectedType=null,
        expectedEpisodeId=null,
        expectedSeasonId=null,
        expectedShowId=null,
        expectedStart=null,
        expectedEnd=null,
        expectedIndex=null,
        expectedFinal=null,
        database=null,
        isDeleted=false) {

        if (!markerData) {
            throw Error('MarkerData not returned!');
        }

        TestHelpers.checkError(markerData);

        let allIssues = '';
        const addIssue = (issue) => {
            if (allIssues.length !== 0) { allIssues += '\n'; }

            allIssues += issue;
        };

        const checkField = (field, expectedField, message) => {
            if (expectedField !== null && field !== expectedField) {
                addIssue(`${message} does not match! Expected ${expectedField}, found ${field}.`);
            }
        };

        checkField(markerData.markerType, expectedType, 'Marker type');
        checkField(markerData.parentId, expectedEpisodeId, 'Episode id');
        checkField(markerData.seasonId, expectedSeasonId, 'Season id');
        checkField(markerData.showId, expectedShowId, 'Show id');
        checkField(markerData.start, expectedStart, 'Marker start');
        checkField(markerData.end, expectedEnd, 'Marker end');
        checkField(markerData.index, expectedIndex, 'Marker index'); // TODO: indexRemove: order
        checkField(markerData.isFinal, expectedFinal, 'Final credits');


        // Verified returned fields, make sure it's in the db as well
        TestHelpers.verify(allIssues.length === 0, allIssues);
        if (!database) {
            return;
        }

        const rows = await database.all(`SELECT * FROM taggings WHERE id=${markerData.id};`);

        if (isDeleted) {
            TestHelpers.verify(rows.length === 0, `Found a marker with id ${markerData.id} that should be deleted!`);
            return;
        }

        TestHelpers.verify(rows.length === 1, `Found ${rows.length} rows with id ${markerData.id}, that's not right!`);

        const row = rows[0];
        checkField(row.metadata_item_id, expectedEpisodeId, 'DB episode id');
        checkField(row.time_offset, expectedStart, 'DB marker start');
        checkField(row.end_time_offset, expectedEnd, 'DB marker end');
        checkField(row.index, expectedIndex, 'DB marker index'); // TODO: indexRemove: order
        checkField(row.text, expectedType, 'DB marker type');
        checkField(row.extra_data === null ? false : row.extra_data.indexOf('final=1') !== -1, expectedFinal, 'Final credits');
        TestHelpers.verify(allIssues.length === 0, allIssues);
    }

    /**
     * Checks whether the given object is an error response from the server. Useful when a
     * test doesn't check the response code and uses the Error field to check for an error.
     * @throws {Error} If the response is undefined or indicates a failed request. */
    static checkError(response) {
        if (!response) {
            throw Error('Invalid response');
        }

        if (response.Error) {
            throw Error(`Operation failed: ${response.Error}`);
        }
    }

    /**
     * Verifies that the given condition is true. If it's not, throws an error with the specified message.
     * @param {boolean} condition
     * @param {string} message
     * @throws {Error} If `condition` is false */
    static verify(condition, message) {
        if (!condition) {
            throw Error(message);
        }
    }

    /**
     * Check whether the given response is a bad request (400), and container an Error field in the payload,
     * throwing if it's not the case.
     * @param {Response} response The response from the server
     * @param {string} testCase The test case that we expect to fail */
    static async verifyBadRequest(response, testCase, json=true) {
        TestHelpers.verify(response.status === 400, `Expected ${testCase} to return 400, got ${response.status}.`);

        // No JSON response for GET requests, the status code itself is enough
        if (!json) { return; }

        const message = await response.json();
        TestHelpers.verify(message.Error, `Expected an error message for ${testCase}, found nothing.`);
    }

    /**
     * Verifies that the header of the given response is what we expect.
     * @param {Headers} headers
     * @param {string} header
     * @param {string} expected
     * @param {string} endpoint */
    static verifyHeader(headers, header, expected, endpoint) {
        let value = headers.get(header);
        if (value === null) {
            value = 'null';
        } else {
            value = `"${value}"`;
        }

        TestHelpers.verify(value !== null, `Expected header "${header}" of "${endpoint}" to be "${expected}", found ${value}`);
    }

    /**
     * @returns The CREATE TABLE statements for the minimal Plex database recreation. */
    static getCreateTables() {

        // Tables created below based on .schema [table]. Indexes probably aren't necessary.

        // .schema taggings
        const taggings = `
        CREATE TABLE IF NOT EXISTS "taggings" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            "metadata_item_id" integer,
            "tag_id" integer,
            "index" integer,
            "text" varchar(255),
            "time_offset" integer,
            "end_time_offset" integer,
            "thumb_url" varchar(255),
            "created_at" dt_integer(8),
            'extra_data' varchar(255));
        CREATE INDEX "index_taggings_on_metadata_item_id" ON "taggings" ("metadata_item_id" );
        CREATE INDEX "index_taggings_on_tag_id" ON "taggings" ("tag_id" );`;

        // .schema tags, minus triggers
        const tags = `
        CREATE TABLE IF NOT EXISTS "tags" ("id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, "metadata_item_id" integer, "tag" varchar(255) COLLATE NOCASE, "tag_type" integer, "user_thumb_url" varchar(255), "user_art_url" varchar(255), "user_music_url" varchar(255), "created_at" datetime, "updated_at" datetime, "tag_value" integer, 'extra_data' varchar(255), 'key' varchar(255), 'parent_id' integer);
        CREATE INDEX "index_tags_on_tag" ON "tags" ("tag" );
        CREATE INDEX "index_tags_on_tag_type" ON "tags" ("tag_type" );
        CREATE INDEX 'index_tags_on_tag_type_and_tag' ON 'tags' ('tag_type', 'tag');
        CREATE INDEX 'index_tags_on_key' ON 'tags' ('key');
        CREATE INDEX 'index_tags_on_parent_id' ON 'tags' ('parent_id');`;

        // .schema library_sections
        const sections = `
        CREATE TABLE IF NOT EXISTS "library_sections" ("id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, "library_id" integer, "name" varchar(255), "name_sort" varchar(255) COLLATE NOCASE, "section_type" integer, "language" varchar(255), "agent" varchar(255), "scanner" varchar(255), "user_thumb_url" varchar(255), "user_art_url" varchar(255), "user_theme_music_url" varchar(255), "public" boolean, "created_at" datetime, "updated_at" datetime, "scanned_at" datetime, "display_secondary_level" boolean, "user_fields" varchar(255), "query_xml" text, "query_type" integer, "uuid" varchar(255), 'changed_at' integer(8) default '0', 'content_changed_at' integer(8) default '0');
        CREATE INDEX "index_library_sections_on_name_sort" ON "library_sections" ("name_sort" collate nocase);
        CREATE INDEX "index_library_sections_on_name" ON "library_sections" ("name" );
        CREATE INDEX 'index_library_sections_on_changed_at' ON 'library_sections' ('changed_at' );`;

        // .schema metadata_items, minus triggers, minus nonstandard collate
        const metadataItems = `
        CREATE TABLE IF NOT EXISTS "metadata_items" ("id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, "library_section_id" integer, "parent_id" integer, "metadata_type" integer, "guid" varchar(255), "media_item_count" integer, "title" varchar(255), "title_sort" varchar(255) COLLATE NOCASE, "original_title" varchar(255), "studio" varchar(255), "rating" float, "rating_count" integer, "tagline" varchar(255), "summary" text, "trivia" text, "quotes" text, "content_rating" varchar(255), "content_rating_age" integer, "index" integer, "absolute_index" integer, "duration" integer, "user_thumb_url" varchar(255), "user_art_url" varchar(255), "user_banner_url" varchar(255), "user_music_url" varchar(255), "user_fields" varchar(255), "tags_genre" varchar(255), "tags_collection" varchar(255), "tags_director" varchar(255), "tags_writer" varchar(255), "tags_star" varchar(255), "originally_available_at" dt_integer(8), "available_at" dt_integer(8), "expires_at" dt_integer(8), "refreshed_at" dt_integer(8), "year" integer, "added_at" dt_integer(8), "created_at" dt_integer(8), "updated_at" dt_integer(8), "deleted_at" dt_integer(8), "tags_country" varchar(255), "extra_data" varchar(255), "hash" varchar(255), 'audience_rating' float, 'changed_at' integer(8) default '0', 'resources_changed_at' integer(8) default '0', 'remote' integer, 'edition_title' varchar(255));
        CREATE INDEX "index_metadata_items_on_library_section_id" ON "metadata_items" ("library_section_id" );
        CREATE INDEX "index_metadata_items_on_parent_id" ON "metadata_items" ("parent_id" );
        CREATE INDEX "index_metadata_items_on_created_at" ON "metadata_items" ("created_at" );
        CREATE INDEX "index_metadata_items_on_index" ON "metadata_items" ("index" );
        CREATE INDEX "index_metadata_items_on_title" ON "metadata_items" ("title" );
        CREATE INDEX "index_metadata_items_on_title_sort" ON "metadata_items" ("title_sort" );
        CREATE INDEX "index_metadata_items_on_guid" ON "metadata_items" ("guid" );
        CREATE INDEX "index_metadata_items_on_metadata_type" ON "metadata_items" ("metadata_type" );
        CREATE INDEX "index_metadata_items_on_deleted_at" ON "metadata_items" ("deleted_at" );
        CREATE INDEX "index_metadata_items_on_library_section_id_and_metadata_type_and_added_at" ON "metadata_items" ("library_section_id", "metadata_type", "added_at" );
        CREATE INDEX "index_metadata_items_on_hash" ON "metadata_items" ("hash" );
        CREATE INDEX "index_metadata_items_on_added_at" ON "metadata_items" ("added_at" );
        CREATE INDEX 'index_metadata_items_on_originally_available_at' ON 'metadata_items' ('originally_available_at' );
        CREATE INDEX 'index_metadata_items_on_changed_at' ON 'metadata_items' ('changed_at' );
        CREATE INDEX 'index_metadata_items_on_resources_changed_at' ON 'metadata_items' ('resources_changed_at' );
        CREATE INDEX 'index_metadata_items_on_original_title' ON 'metadata_items' ('original_title');
        CREATE INDEX 'index_metadata_items_on_absolute_index' ON 'metadata_items' ('absolute_index');
        CREATE INDEX 'index_metadata_items_on_remote' ON 'metadata_items' ('remote');
        CREATE INDEX 'index_metadata_items_on_edition_title' ON 'metadata_items' ('edition_title');`;

        // .schema media_items
        const mediaItems = `
        CREATE TABLE IF NOT EXISTS "media_items" ("id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, "library_section_id" integer, "section_location_id" integer, "metadata_item_id" integer, "type_id" integer, "width" integer, "height" integer, "size" integer(8), "duration" integer, "bitrate" integer, "container" varchar(255), "video_codec" varchar(255), "audio_codec" varchar(255), "display_aspect_ratio" float, "frames_per_second" float, "audio_channels" integer, "interlaced" boolean, "source" varchar(255), "hints" varchar(255), "display_offset" integer, "settings" varchar(255), "created_at" dt_integer(8), "updated_at" dt_integer(8), "optimized_for_streaming" boolean, "deleted_at" dt_integer(8), "media_analysis_version" integer DEFAULT 0, "sample_aspect_ratio" float, "extra_data" varchar(255), 'proxy_type' integer, 'channel_id' integer, 'begins_at' dt_integer(8), 'ends_at' dt_integer(8), 'color_trc' varchar(255));
        CREATE INDEX "index_media_items_on_library_section_id" ON "media_items" ("library_section_id" );
        CREATE INDEX "index_media_items_on_metadata_item_id" ON "media_items" ("metadata_item_id" );
        CREATE INDEX "index_media_items_on_deleted_at" ON "media_items" ("deleted_at" );
        CREATE INDEX "index_media_items_on_media_analysis_version" ON "media_items" ("media_analysis_version" );
        CREATE INDEX 'index_media_items_on_begins_at' ON 'media_items' ('begins_at');
        CREATE INDEX 'index_media_items_on_ends_at' ON 'media_items' ('ends_at');
        CREATE INDEX 'index_media_items_on_channel_id' ON 'media_items' ('channel_id');
        CREATE INDEX 'index_media_items_on_channel_id_and_begins_at' ON 'media_items' ('channel_id','begins_at');`;

        // .schema media_parts
        const mediaParts = `
        CREATE TABLE IF NOT EXISTS "media_parts" ("id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, "media_item_id" integer, "directory_id" integer, "hash" varchar(255), "open_subtitle_hash" varchar(255), "file" varchar(255), "index" integer, "size" integer(8), "duration" integer, "created_at" dt_integer(8), "updated_at" dt_integer(8), "deleted_at" dt_integer(8), "extra_data" varchar(255));
        CREATE INDEX "index_media_parts_on_directory_id" ON "media_parts" ("directory_id" );
        CREATE INDEX "index_media_parts_on_media_item_id" ON "media_parts" ("media_item_id" );
        CREATE INDEX "index_media_parts_on_hash" ON "media_parts" ("hash" );
        CREATE INDEX "index_media_parts_on_file" ON "media_parts" ("file" );
        CREATE INDEX "index_media_parts_on_deleted_at" ON "media_parts" ("deleted_at" );
        CREATE INDEX "index_media_parts_on_size" ON "media_parts" ("size" );`;

        return taggings + tags + sections + metadataItems + mediaItems + mediaParts;
    }
}

export default TestHelpers;
