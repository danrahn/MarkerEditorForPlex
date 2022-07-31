/**
 * Contains the definitions that make up a complete hierarchical cache of purged markers.
 * Most definitely overkill for its low-level purpose.
 */

/** Enum defining the various states of initialization possible for a PurgedGroup */
const PurgeCacheStatus = {
    Uninitialized : 0,
    PartiallyInitialized : 1,
    Complete : 2,
}

/** A glorified dictionary that maps metadata ids (show/season/episode) to their corresponding PurgedShow/Season/Episode */
class AgnosticPurgeCache {
    /** @type {{[metadataId: number]: PurgedGroup|MarkerAction}} */
    data = {};

    /**
     * @param {number} key
     * @returns {PurgedGroup} */
    get(key) { return this.data[key]; }

    /**
     * Sets the value for the given key if it's not set already
     * @param {number} key
     * @param {PurgedGroup} value */
    lazySet(key, value) {
        if (this.get(key)) {
            return;
        }

        this.data[key] = value;
    }
}

/**
 * Base interface for a group of purged markers at an arbitrary level (server/section/show/season/episode)
 */
class PurgedGroup {
    /** Whether this group has loaded all associated data.
     * Should never be false, but is here to ensure that e.g. we didn't only
     * load data for a single season, leaving the full show data incomplete.
     * @type {number} */
    status = PurgeCacheStatus.Uninitialized;

    /** The number of markers in this group, including subgroups.
     * @type {number} */
    count = 0;

    /** The underlying data. In the case of sections, shows, and seasons, this
     * will be a dictionary of metadataIds to PurgeGroups. For episodes, it's a
     * dictionary of markerIds to MarkerActions.
     * @type {{[metadataId: number]: PurgedGroup|MarkerAction}} */
    data = {};

    parent = null;
    id = -1;

    /**
     * Construct a new group that has the given metadataId key and parent, if any
     * @param {number} key
     * @param {PurgedGroup?} parent */
    constructor(key=-1, parent=null) {
        this.id = key;
        this.parent = parent;
    }

    /** Retrieve the PurgedGroup for the given metadataId */
    get(id) { return this.data[id]; }

    /**
     * Retrieve any MarkerAction in this group, or null if there aren't any
     * @returns {MarkerAction} */
    getAny() { return Object.keys(this.data).length > 0 ? Object.values(this.data)[0].getAny() : null }

    /**
     * Applies the given function to all MarkerActions in this group.
     * @param {(action: MarkerAction) => void} fn */
    forEach(fn) {
        for (const group of Object.values(this.data)) {
            group.forEach(fn);
        }
    }

    /** Retrieve the PurgedGroup for the given metadataId, adding and returning a new entry if it doesn't exist. */
    getOrAdd(id) { return this.data[id] || this.addNewGroup(id); }
    /** Adds a new PurgedGroup to the cache. Should never be called directly from the base class. */
    addNewGroup(_) { Log.error(`PurgedGroup: Cannot call addNewGroup on the base PurgedGroup, must call from derived class.`); }

    /**
     * Base add method that adds the given PurgedGroup at the given metadataId
     * @param {number} key `value`'s metadataId
     * @param {PurgedGroup} value The PurgedGroup to add to the cache
     * @returns {PurgedGroup} `value` */
    addInternal(key, value) {
        this.checkNewKey(key);
        this.data[key] = value;

        // Sometimes we're adding a non-empty value, in which case we should update our count
        this.updateCount(value.count);

        return value;
    }

    /**
     * Return whether it's safe to add the given key (i.e. the key doesn't exist).
     * @param {number} key */
    checkNewKey(key) {
        if (this.data[key]) {
            Log.warn(`PurgedGroup: Overwriting existing data at "${key}"`);
            return false;
        }

        return true;
    }

    /**
     * Adjusts the count of purged markers for this group by `delta`, and adjusts
     * any parents as well.
     * @param {number} delta The change in purged marker count for this group. */
    updateCount(delta) {
        if (delta == 0) {
            return;
        }

        this.count += delta;
        if (this.status == PurgeCacheStatus.Uninitialized) { this.status = PurgeCacheStatus.PartiallyInitialized; }
        if (this.parent) {
            this.parent.updateCount(delta);
            // Sections are special-cased, but we want to delete other entries
            if (!(this instanceof PurgedSection) && this.count <= 0) {
                delete this.parent.data[this.id];
            }
        }
    }

    /**
     * Clones all data in this object into newGroup
     * @param {PurgedGroup} newGroup
     * @returns `newGroup` */
    deepCloneInternal(newGroup) {
        for (const [key, value] of Object.entries(this.data)) {
            newGroup.data[key] = value.deepClone();
            newGroup.data[key].parent = newGroup;
        }

        newGroup.count = this.count;
        return newGroup;
    }
}

/** A PurgedGroup representing an entire server. */
class PurgedServer extends PurgedGroup {
    /** @returns {PurgedSection} */
    addNewGroup(key) { return this.addInternal(key, new PurgedSection(key, this)); }
    /** @returns {PurgedServer} */
    deepClone() { return this.deepCloneInternal(new PurgedServer(this.id)); }

    // The following only exist for intellisense/"TypeScript" safety.
    /** @returns {PurgedSection} */ get(/**@type {number} */id) { return this.data[id]; }
    /** @returns {PurgedSection} */ getOrAdd(/**@type {number} */id) { return this.data[id] || this.addNewGroup(id); }
}

/**
 * A PurgedGroup that represents a single library section of a server.
 * TODO: Really need a better name for this. PurgeSection vs PurgedSection */
class PurgedSection extends PurgedGroup {
    addNewGroup(key) { return this.addInternal(key, new PurgedShow(key, this)); }
    /** @returns {PurgedSection} */
    deepClone() { return this.deepCloneInternal(new PurgedSection(this.id)); }

    // The following only exist for intellisense/"TypeScript" safety.
    /** @returns {PurgedShow} */ get(/**@type {number} */id) { return super.get(id); }
    /** @returns {PurgedShow} */ getOrAdd(/**@type {number} */id) { return super.getOrAdd(id); }
}

/**
 * A PurgedGroup that represents a single show of a library section. */
class PurgedShow extends PurgedGroup {
    addNewGroup(key) { return this.addInternal(key, new PurgedSeason(key, this)); }
    /** @returns {PurgedShow} */
    deepClone() { return this.deepCloneInternal(new PurgedShow(this.id)); }

    // The following only exist for intellisense/"TypeScript" safety.
    /** @returns {PurgedSeason} */ get(/**@type {number} */id) { return super.get(id); }
    /** @returns {PurgedSeason} */ getOrAdd(/**@type {number} */id) { return super.getOrAdd(id); }
}

/**
 * A PurgedGroup that represents a single season of a show. */
class PurgedSeason extends PurgedGroup {
    addNewGroup(key) { return this.addInternal(key, new PurgedEpisode(key, this)); }
    /** @returns {PurgedSeason} */
    deepClone() { return this.deepCloneInternal(new PurgedSeason(this.id)); }

    // The following only exist for intellisense/"TypeScript" safety.
    /** @returns {PurgedEpisode} */ get(/**@type {number} */id) { return super.get(id); }
    /** @returns {PurgedEpisode} */ getOrAdd(/**@type {number} */id) { return super.getOrAdd(id); }
}

/**
 * A PurgedGroup that represents a single episode of a season. */
class PurgedEpisode extends PurgedGroup {
    addNewGroup(_) { Log.error(`PurgedGroup: Cannot call addNewGroup on a purgedEpisode.`); }
    getOrAdd(_) { Log.error(`PurgedGroup: Cannot call getOrAdd on a purgedEpisode.`); }
    /** @returns {PurgedEpisode} */
    deepClone() {
        // Special handling for episodes since data values are not a PurgeGroup, but MarkerActions
        let newEpisode = new PurgedEpisode(this.id);
        for (const [key, value] of Object.entries(this.data)) {
            newEpisode.data[key] = value;
        }

        newEpisode.count = this.count;
        return newEpisode;
    }


    /**
     * Retrieve any MarkerAction in this group, or null if there aren't any
     * @returns {MarkerAction} */
    getAny() { return Object.keys(this.data).length > 0 ? Object.values(this.data)[0] : null }

    /**
     * Applies the given function to all MarkerActions in this group.
     * @param {(action: MarkerAction) => void} fn */
    forEach(fn) {
        for (/** @type {MarkerAction}*/ const marker of Object.values(this.data)) {
            fn(marker);
        }
    }

    /**
     * Remove the purged marker with the given id from the cache (after ignoring/restoring it)
     * @param {number} markerId */
    removeIfPresent(markerId) {
        if (this.data[markerId]) {
            delete this.data[markerId];
            this.updateCount(-1);
        }
    }
    /**
     * Adds the given purged marker to the cache.
     * @param {MarkerAction} marker */
    addNewMarker(marker) {
        if (this.checkNewKey(marker.marker_id)) {
            this.updateCount(1);
        }

        this.data[marker.marker_id] = marker;
    }

    /** @returns {MarkerAction} */
    get(id) { return super.get(id); } // This only exists for intellisense/"TypeScript" safety.
}

export { PurgedGroup, PurgedServer, PurgedSection, PurgedShow, PurgedSeason, PurgedEpisode, AgnosticPurgeCache, PurgeCacheStatus }
