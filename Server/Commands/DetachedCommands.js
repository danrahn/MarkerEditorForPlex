import { Config, MarkerEditorConfig } from '../Config/MarkerEditorConfig.js';
import { GetServerState, ServerState } from '../ServerState.js';
import { ServerEvents, waitForServerEvent } from '../ServerEvents.js';

import { BackupManager, MarkerOp } from '../MarkerBackupManager.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';
import { DetachedSession } from '../DetachedSession.js';
import { PlexQueries } from '../PlexQueryManager.js';
import { PostCommands } from '../../Shared/PostCommands.js';
import { registerCommand } from './PostCommand.js';

import ServerError from '../ServerError.js';
import SqliteDatabase from '../SqliteDatabase.js';

/** @typedef {!import('express').Response} ExpressResponse */
/** @typedef {!import('../DetachedSession').PendingActionSnapshot} PendingActionSnapshot */
/** @typedef {!import('../../Shared/PlexTypes').DetachedPendingChange} DetachedPendingChange */
/** @typedef {!import('../../Shared/PlexTypes').DetachedPendingSectionGroup} DetachedPendingSectionGroup */
/** @typedef {!import('../../Shared/PlexTypes').MarkerAction} MarkerAction */

const Log = ContextualLog.Create('DetachedCommands');

const SelectForkMarkersForParent = `
SELECT id,
       \`index\` AS marker_index,
       text,
       time_offset,
       end_time_offset,
       thumb_url,
       created_at,
       extra_data
FROM taggings
WHERE metadata_item_id=? AND tag_id=?
ORDER BY \`index\`, time_offset, id;`;

const SelectMarkersForParent = `
SELECT id,
       \`index\` AS marker_index,
       text,
       time_offset,
       end_time_offset,
       thumb_url,
       created_at,
       extra_data
FROM taggings
WHERE metadata_item_id=? AND tag_id=?
ORDER BY id;`;

const DeleteLiveMarkersForParent = `
DELETE FROM taggings
WHERE metadata_item_id=? AND tag_id=?;`;

const InsertLiveMarkerWithId = `
INSERT INTO taggings
    (id, metadata_item_id, tag_id, \`index\`, text, time_offset, end_time_offset, thumb_url, created_at, extra_data)
VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;

const InsertLiveMarkerWithoutId = `
INSERT INTO taggings
    (metadata_item_id, tag_id, \`index\`, text, time_offset, end_time_offset, thumb_url, created_at, extra_data)
VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?);`;

const SelectLiveMarkerOwnerById = `
SELECT metadata_item_id,
       tag_id
FROM taggings
WHERE id=?;`;

const DeleteForkMarkerById = `
DELETE FROM taggings WHERE id=? AND tag_id=?;`;

const UpdateForkMarkerTimings = `
UPDATE taggings
   SET time_offset=?, end_time_offset=?
 WHERE id=? AND tag_id=?;`;

const UpdateForkMarkerFromBaseline = `
UPDATE taggings
   SET text=?, time_offset=?, end_time_offset=?, extra_data=?
 WHERE id=? AND tag_id=?;`;

const SelectForkMarkerIdsByParent = `
SELECT id
  FROM taggings
 WHERE metadata_item_id=? AND tag_id=?
 ORDER BY time_offset, id;`;

const SelectPendingItemContextByParentId = `
SELECT base.id AS parent_id,
       base.title AS base_title,
       base.metadata_type AS metadata_type,
       base.year AS movie_year,
       base.\`index\` AS episode_index,
       season.\`index\` AS season_index,
       season.title AS season_title,
       show.id AS show_id,
       show.title AS show_title,
       section.id AS section_id,
       section.name AS section_name,
       section.section_type AS section_type
FROM metadata_items base
LEFT JOIN metadata_items season ON base.parent_id=season.id
LEFT JOIN metadata_items show ON season.parent_id=show.id
LEFT JOIN library_sections section ON section.id=base.library_section_id
WHERE base.id=?;`;

function assertRunningState(action) {
    if (GetServerState() !== ServerState.Running) {
        throw new ServerError(`Server must be running to ${action}.`, 400);
    }
}

function assertDetachedActive(action) {
    if (!DetachedSession.active()) {
        throw new ServerError(`Detached mode is not active, cannot ${action}.`, 400);
    }
}

function isBusyError(err) {
    return err?.code === 'SQLITE_BUSY' || err?.code === 'SQLITE_BUSY_SNAPSHOT';
}

function isUniqueMarkerIdError(err) {
    return err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || err?.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/**
 * @param {MarkerAction|null} action */
function pendingStateFromAction(action) {
    if (!action || action.op === MarkerOp.Delete) {
        return null;
    }

    return {
        markerType : action.marker_type,
        start : action.start,
        end : action.end,
        final : action.final,
        parentId : action.parent_id,
        seasonId : action.season_id,
        showId : action.show_id,
    };
}

function pendingStatesEqual(left, right) {
    return left.markerType === right.markerType
        && left.start === right.start
        && left.end === right.end
        && left.final === right.final
        && left.parentId === right.parentId
        && left.seasonId === right.seasonId
        && left.showId === right.showId;
}

/**
 * Did the marker exist at the start of the detached session?
 * - With a non-delete baseline action: yes.
 * - With a delete baseline: no (it was already gone at checkpoint).
 * - Without any baseline action: infer from the first in-session action. An Add means the marker was
 *   created during the session; anything else (Edit/Delete) implies the marker existed prior - it was a
 *   Plex-generated marker that simply had no prior entry in the backup actions table.
 * @param {PendingActionSnapshot} snapshot */
function markerExistedBeforeSession(snapshot) {
    if (snapshot.baselineAction) {
        return snapshot.baselineAction.op !== MarkerOp.Delete;
    }

    const firstSessionAction = snapshot.actions?.[0];
    if (!firstSessionAction) {
        return false;
    }

    return firstSessionAction.op !== MarkerOp.Add && firstSessionAction.op !== MarkerOp.Restore;
}

/**
 * Determine the pending operation for a marker based on its action history
 * during a detached session.
 * @param {PendingActionSnapshot} snapshot */
function operationFromSnapshot(snapshot) {
    const latest = snapshot.latestAction;
    if (!latest) {
        return null;
    }

    const existedBefore = markerExistedBeforeSession(snapshot);
    const existsNow = latest.op !== MarkerOp.Delete;

    if (!existedBefore && !existsNow) {
        // Created and removed in the same session - net no-op.
        return null;
    }

    if (!existedBefore) {
        return 'add';
    }

    if (!existsNow) {
        return 'delete';
    }

    const baselineState = pendingStateFromAction(snapshot.baselineAction);
    const currentState = pendingStateFromAction(latest);
    if (!baselineState) {
        // Marker existed before the session but has no recorded baseline (Plex-generated, untouched
        // before this session). We don't have prior state to compare against, but we know the user
        // adjusted it during the session, so call it an edit.
        return 'edit';
    }

    return pendingStatesEqual(baselineState, currentState) ? null : 'edit';
}

/**
 * @param {{ [parentId: number]: any }} contextCache
 * @param {SqliteDatabase|null} contextDb
 * @param {number} parentId */
function pendingContextForParent(contextCache, contextDb, parentId) {
    if (!Object.prototype.hasOwnProperty.call(contextCache, parentId)) {
        contextCache[parentId] = contextDb?.get(SelectPendingItemContextByParentId, [parentId]);
    }

    return contextCache[parentId];
}

/**
 * @param {MarkerAction} displayAction
 * @param {any} context
 * @returns {{sectionType: number, mediaId: number, mediaTitle: string, mediaYear: number|null, episodeTitle: string|null}} */
function mediaFieldsForRow(displayAction, context) {
    const sectionType = typeof context?.section_type === 'number' ?
        context.section_type :
        (displayAction.show_id === -1 ? 1 : 2);
    const isTv = sectionType === 2;
    if (isTv) {
        return {
            sectionType : sectionType,
            mediaId : displayAction.show_id,
            mediaTitle : context?.show_title || `Show ${displayAction.show_id}`,
            mediaYear : null,
            episodeTitle : context?.base_title || null,
        };
    }

    return {
        sectionType : sectionType,
        mediaId : displayAction.parent_id,
        mediaTitle : context?.base_title || `Item ${displayAction.parent_id}`,
        mediaYear : context?.movie_year ?? null,
        episodeTitle : null,
    };
}

/**
 * @param {PendingActionSnapshot} snapshot
 * @param {string} operation
 * @param {MarkerAction} displayAction
 * @param {any} context
 * @returns {DetachedPendingChange} */
function pendingRowFromSnapshot(snapshot, operation, displayAction, context) {
    const media = mediaFieldsForRow(displayAction, context);
    return {
        actionId : snapshot.latestAction.id,
        markerId : snapshot.markerId,
        operation : operation,
        markerType : displayAction.marker_type,
        start : displayAction.start,
        end : displayAction.end,
        createdAt : displayAction.created_at,
        sectionId : displayAction.section_id,
        sectionName : context?.section_name || `Library ${displayAction.section_id}`,
        sectionType : media.sectionType,
        mediaId : media.mediaId,
        mediaTitle : media.mediaTitle,
        mediaYear : media.mediaYear,
        parentId : displayAction.parent_id,
        episodeIndex : context?.episode_index ?? null,
        seasonIndex : context?.season_index ?? null,
        episodeTitle : media.episodeTitle,
    };
}

/**
 * @param {DetachedPendingChange[]} rows */
function groupPendingChangeRows(rows) {
    /**
     * @type {{
     *      [sectionId: number]: {
     *          sectionId: number,
     *          sectionName: string,
     *          sectionType: number,
     *          media: { [mediaId: number]: {
     *              mediaId: number,
     *              mediaTitle: string,
     *              mediaYear: number|null,
     *              rows: DetachedPendingChange[]
     *          } }
     *      }
     * }}
     */
    const sectionMap = {};

    for (const row of rows) {
        const section = sectionMap[row.sectionId] ??= {
            sectionId : row.sectionId,
            sectionName : row.sectionName,
            sectionType : row.sectionType,
            media : {},
        };

        const media = section.media[row.mediaId] ??= {
            mediaId : row.mediaId,
            mediaTitle : row.mediaTitle,
            mediaYear : row.mediaYear,
            rows : [],
        };

        media.rows.push(row);
    }

    return Object.values(sectionMap)
        .sort((left, right) => left.sectionName.localeCompare(right.sectionName, 'en', { sensitivity : 'base' }))
        .map(section => {
            const media = Object.values(section.media)
                .sort((left, right) => left.mediaTitle.localeCompare(right.mediaTitle, 'en', { sensitivity : 'base' }))
                .map(group => {
                    group.rows.sort((left, right) => left.actionId - right.actionId);
                    return group;
                });

            return {
                sectionId : section.sectionId,
                sectionName : section.sectionName,
                sectionType : section.sectionType,
                media : media,
            };
        });
}

/**
 * @param {number} checkpointActionId
 * @param {boolean} [includeSections=true] */
function pendingChangesForCheckpoint(checkpointActionId, includeSections=true) {
    const snapshots = BackupManager.pendingActionSnapshotsSince(checkpointActionId);
    if (snapshots.length === 0) {
        return { sections : [], byMarkerId : {} };
    }

    // Pending context should be resolved from the detached fork to avoid touching live DB
    // for status/undo flows while detached mode is active.
    const forkPath = includeSections ? DetachedSession.forkDatabasePath() : null;
    const contextDb = forkPath ? SqliteDatabase.OpenDatabase(forkPath, false /*allowCreate*/) : null;
    /** @type {{ [parentId: number]: any }} */
    const contextCache = {};

    /** @type {DetachedPendingChange[]} */
    const rows = [];
    /**
     * @type {{
     *     [markerId: number]: {
     *         operation: string,
     *         sectionId: number,
     *         baselineAction: MarkerAction|null,
     *         latestAction: MarkerAction
     *     }
     * }}
     */
    const byMarkerId = {};

    try {
        for (const snapshot of snapshots) {
            const operation = operationFromSnapshot(snapshot);
            if (!operation) {
                continue;
            }

            byMarkerId[snapshot.markerId] = {
                operation : operation,
                sectionId : snapshot.sectionId,
                baselineAction : snapshot.baselineAction,
                latestAction : snapshot.latestAction,
            };

            if (!includeSections) {
                continue;
            }

            // For deletes, the baseline carries the marker info to show; otherwise the latest action does.
            const displayAction = (operation === 'delete' && snapshot.baselineAction) ?
                snapshot.baselineAction :
                snapshot.latestAction;
            const context = pendingContextForParent(contextCache, contextDb, displayAction.parent_id);
            rows.push(pendingRowFromSnapshot(snapshot, operation, displayAction, context));
        }
    } finally {
        contextDb?.close();
    }

    return {
        sections : includeSections ? groupPendingChangeRows(rows) : [],
        byMarkerId : byMarkerId,
    };
}

/**
 * Open the fork database for direct manipulation. Used by undo so we can rewrite the fork
 * without going through PlexQueries (which would either auto-increment ids or record new
 * backup actions - both of which we want to avoid here).
 *
 * Intentionally does NOT open the live database: detached mode's contract is that we only
 * touch the live Plex DB when the user explicitly opts in (e.g. via "Refresh Preview"), and
 * undo should be a fork-local operation.
 *
 * @template T
 * @param {string} unavailableMessage
 * @param {string} busyMessage
 * @param {(forkDb: SqliteDatabase, tagId: number) => T} operation */
function withForkDatabase(unavailableMessage, busyMessage, operation) {
    const forkPath = DetachedSession.forkDatabasePath();
    if (!forkPath) {
        throw new ServerError(unavailableMessage, 500);
    }

    const forkDb = SqliteDatabase.OpenDatabase(forkPath, false /*allowCreate*/);

    try {
        const tagId = PlexQueries.markerTagId();
        return operation(forkDb, tagId);
    } catch (err) {
        if (isBusyError(err)) {
            throw new ServerError(busyMessage, 503);
        }

        throw err;
    } finally {
        forkDb.close();
    }
}

/**
 * Renumber marker `index` values for the given parent so they're contiguous and ordered by
 * start time - mirrors what PlexQueries.reindex does, but on the fork DB connection.
 * @param {SqliteDatabase} forkDb
 * @param {number} tagId
 * @param {number} parentId */
function reindexForkMarkersInParent(forkDb, tagId, parentId) {
    const rows = forkDb.all(SelectForkMarkerIdsByParent, [parentId, tagId]);
    for (let i = 0; i < rows.length; ++i) {
        forkDb.run('UPDATE taggings SET `index`=? WHERE id=?;', [i, rows[i].id]);
    }
}

/**
 * Revert the fork DB so the marker matches its session-start state, using only the backup
 * action history. The live Plex DB is intentionally NOT consulted (see withForkDatabase).
 *
 * Trade-off forced by reading from backup actions alone:
 *  - For an `edit` undo without a baseline action, only `old_start`/`old_end` are recorded -
 *    not `old_marker_type` / `old_final`. We revert timings; any marker_type/final change made
 *    in the same session can't be reconstructed and stays at the edited value. The user can
 *    discard the session to get a full reset.
 *
 * @param {number} markerId
 * @param {{operation: string, sectionId: number, baselineAction: any, latestAction: any}} target */
function revertForkMarkerFromActions(markerId, target) {
    withForkDatabase(
        'Detached mode state is invalid, cannot undo change.',
        'Could not write to the detached database. Ensure no other process holds it open.',
        (forkDb, tagId) => {
            const op = target.operation;
            const latest = target.latestAction;

            switch (op) {
                case 'add':
                    forkDb.run(DeleteForkMarkerById, [markerId, tagId]);
                    reindexForkMarkersInParent(forkDb, tagId, latest.parent_id);
                    break;
                case 'delete':
                    if (!latest || latest.op !== MarkerOp.Delete) {
                        throw new ServerError(`Cannot undo: no delete action found for marker ${markerId}.`, 500);
                    }

                    // Re-insert with the original id, reconstructed from the delete action's snapshot
                    // of the marker's state at deletion (== its session-start state).
                    forkDb.run(InsertLiveMarkerWithId, [
                        markerId,
                        latest.parent_id,
                        tagId,
                        0, /* index - fixed by reindex below */
                        latest.marker_type,
                        latest.start,
                        latest.end,
                        '', /* thumb_url: always blank for markers */
                        latest.created_at,
                        latest.extra_data || '',
                    ]);
                    reindexForkMarkersInParent(forkDb, tagId, latest.parent_id);
                    break;
                case 'edit': {
                    if (!latest || latest.op !== MarkerOp.Edit) {
                        throw new ServerError(`Cannot undo: no edit action found for marker ${markerId}.`, 500);
                    }

                    const baseline = target.baselineAction;
                    if (baseline && baseline.op !== MarkerOp.Delete) {
                        // We have a pre-session snapshot for this marker; fully revert to it.
                        forkDb.run(UpdateForkMarkerFromBaseline, [
                            baseline.marker_type,
                            baseline.start,
                            baseline.end,
                            baseline.extra_data || '',
                            markerId,
                            tagId,
                        ]);
                    } else {
                        if (latest.old_start === null || latest.old_end === null) {
                            throw new ServerError(
                                `Cannot undo edit: marker ${markerId} has no recorded pre-edit timings.`, 500);
                        }

                        // No baseline - revert timings only; see header for the marker_type/caveat.
                        forkDb.run(UpdateForkMarkerTimings, [
                            latest.old_start,
                            latest.old_end,
                            markerId,
                            tagId,
                        ]);
                    }

                    reindexForkMarkersInParent(forkDb, tagId, latest.parent_id);
                    break;
                }
                default:
                    throw new ServerError(`Unsupported pending operation '${op}' for marker ${markerId}.`, 500);
            }
        }
    );
}

/**
 * @param {number} markerId */
function detachedUndoChange(markerId) {
    assertRunningState('undo detached change');
    assertDetachedActive('undo detached change');

    if (isNaN(markerId) || markerId <= 0) {
        throw new ServerError(`Invalid marker id '${markerId}'.`, 400);
    }

    const checkpoint = DetachedSession.actionCheckpoint();
    const pending = pendingChangesForCheckpoint(checkpoint, false /*includeSections*/);
    const target = pending.byMarkerId[markerId];
    if (!target) {
        throw new ServerError(`Marker ${markerId} is not a pending detached-mode change.`, 404);
    }

    if (target.operation !== 'add' && target.operation !== 'delete' && target.operation !== 'edit') {
        throw new ServerError(`Unsupported pending operation '${target.operation}' for marker ${markerId}.`, 500);
    }

    revertForkMarkerFromActions(markerId, target);
    // Wipe every in-session action for this marker so the pending list reflects the new state
    // (the original 'add'/'edit'/'delete' row simply disappears, plus any sibling edits stacked
    // on the same marker - e.g. add-then-edit collapses to nothing on undo).
    BackupManager.clearSessionActionsForMarker(markerId, target.sectionId, checkpoint);

    return {
        markerId : markerId,
        operation : target.operation,
    };
}

/**
 * Compare marker rows for a parent between two databases.
 * Returns true when both databases have an identical set of marker rows (same ids and content).
 * @param {SqliteDatabase} liveDb
 * @param {SqliteDatabase} forkDb
 * @param {number} parentId
 * @param {number} tagId
 * @returns {boolean} */
function markersAreIdentical(liveDb, forkDb, parentId, tagId) {
    const liveRows = liveDb.all(SelectMarkersForParent, [parentId, tagId]);
    const forkRows = forkDb.all(SelectMarkersForParent, [parentId, tagId]);
    if (liveRows.length !== forkRows.length) {
        return false;
    }

    for (let i = 0; i < liveRows.length; ++i) {
        const left = liveRows[i];
        const right = forkRows[i];
        if (left.id !== right.id
            || left.marker_index !== right.marker_index
            || left.text !== right.text
            || left.time_offset !== right.time_offset
            || left.end_time_offset !== right.end_time_offset
            || (left.thumb_url || '') !== (right.thumb_url || '')
            || left.created_at !== right.created_at
            || (left.extra_data || '') !== (right.extra_data || '')) {
            return false;
        }
    }

    return true;
}

/**
 * @template T
 * @param {string} unavailableMessage
 * @param {string} busyMessage
 * @param {(liveDb: SqliteDatabase, forkDb: SqliteDatabase, tagId: number) => T} operation
 * @returns {T} */
function withDetachedDatabases(unavailableMessage, busyMessage, operation) {
    const livePath = DetachedSession.liveDatabasePath();
    const forkPath = DetachedSession.forkDatabasePath();
    if (!livePath || !forkPath) {
        throw new ServerError(unavailableMessage, 500);
    }

    const forkDb = SqliteDatabase.OpenDatabase(forkPath, false /*allowCreate*/);
    const liveDb = SqliteDatabase.OpenDatabase(livePath, false /*allowCreate*/);

    try {
        const tagId = PlexQueries.markerTagId();
        return operation(liveDb, forkDb, tagId);
    } catch (err) {
        if (isBusyError(err)) {
            throw new ServerError(busyMessage, 503);
        }

        throw err;
    } finally {
        forkDb.close();
        liveDb.close();
    }
}

/**
 * @param {number[]} parentIds
 * @param {SqliteDatabase} liveDb
 * @param {SqliteDatabase} forkDb
 * @param {number} tagId
 * @param {(parentId: number) => void} onChangedParent
 * @returns {number} */
function forEachChangedParent(parentIds, liveDb, forkDb, tagId, onChangedParent) {
    let changedParentCount = 0;
    for (const parentId of parentIds) {
        if (markersAreIdentical(liveDb, forkDb, parentId, tagId)) {
            continue;
        }

        ++changedParentCount;
        onChangedParent(parentId);
    }

    return changedParentCount;
}

/**
 * Replace marker rows in the live database for the given parent ids using marker data from the fork database.
 * @param {number[]} parentIds
 * @returns {{
 *   parentCount: number,
 *   deletedMarkers: number,
 *   insertedMarkers: number,
 *   remappedMarkerIds: number,
 *   markerIdMap: {[oldId: number]: number}
 * }}
 */
function commitForkToLive(parentIds) {
    return withDetachedDatabases(
        'Detached mode state is invalid, cannot commit.',
        'Could not write to the Plex database. Ensure PMS is fully shut down and try again.',
        (liveDb, forkDb, tagId) => {
            /** @type {{[oldId: number]: number}} */
            const markerIdMap = {};
            let parentCount = 0;
            let deletedMarkers = 0;
            let insertedMarkers = 0;
            let remappedMarkerIds = 0;

            liveDb.exec('BEGIN TRANSACTION;');
            try {
                parentCount = forEachChangedParent(parentIds, liveDb, forkDb, tagId, parentId => {
                    const forkMarkers = forkDb.all(SelectForkMarkersForParent, [parentId, tagId]);
                    const beforeDelete = liveDb.all(SelectMarkersForParent, [parentId, tagId]);
                    deletedMarkers += beforeDelete.length;

                    liveDb.run(DeleteLiveMarkersForParent, [parentId, tagId]);

                    for (const marker of forkMarkers) {
                        const withIdParams = [
                            marker.id,
                            parentId,
                            tagId,
                            marker.marker_index,
                            marker.text,
                            marker.time_offset,
                            marker.end_time_offset,
                            marker.thumb_url || '',
                            marker.created_at,
                            marker.extra_data,
                        ];

                        try {
                            liveDb.run(InsertLiveMarkerWithId, withIdParams);
                        } catch (err) {
                            if (!isUniqueMarkerIdError(err)) {
                                throw err;
                            }

                            liveDb.run(InsertLiveMarkerWithoutId, withIdParams.slice(1));
                            const inserted = liveDb.get('SELECT last_insert_rowid() AS id;');
                            if (!inserted?.id) {
                                throw new ServerError('Could not determine newly inserted marker id.', 500);
                            }

                            markerIdMap[marker.id] = inserted.id;
                            ++remappedMarkerIds;
                        }

                        ++insertedMarkers;
                    }
                });

                liveDb.exec('COMMIT TRANSACTION;');
            } catch (err) {
                liveDb.exec('ROLLBACK TRANSACTION;');
                throw err;
            }

            return {
                parentCount,
                deletedMarkers,
                insertedMarkers,
                remappedMarkerIds,
                markerIdMap,
            };
        });
}

/**
 * Preview marker rows that would be changed by committing detached mode.
 * @param {number[]} parentIds
 * @returns {{
 *   parentCount: number,
 *   deletedMarkers: number,
 *   insertedMarkers: number,
 *   potentialRemappedMarkerIds: number
 * }}
 */
function previewCommitToLive(parentIds) {
    return withDetachedDatabases(
        'Detached mode state is invalid, cannot run commit preview.',
        'Could not read the Plex database. Ensure PMS is fully shut down and try again.',
        (liveDb, forkDb, tagId) => {
            let parentCount = 0;
            let deletedMarkers = 0;
            let insertedMarkers = 0;
            let potentialRemappedMarkerIds = 0;
            const touchedParents = new Set(parentIds);

            parentCount = forEachChangedParent(parentIds, liveDb, forkDb, tagId, parentId => {
                const liveRows = liveDb.all(SelectMarkersForParent, [parentId, tagId]);
                const forkRows = forkDb.all(SelectMarkersForParent, [parentId, tagId]);
                const liveIds = new Set(liveRows.map(row => row.id));
                const forkIds = new Set(forkRows.map(row => row.id));

                for (const liveId of liveIds) {
                    if (!forkIds.has(liveId)) {
                        ++deletedMarkers;
                    }
                }

                for (const forkId of forkIds) {
                    if (liveIds.has(forkId)) {
                        continue;
                    }

                    ++insertedMarkers;
                    const owner = liveDb.get(SelectLiveMarkerOwnerById, [forkId]);
                    if (!owner) {
                        continue;
                    }

                    const replacedByCommitDelete = touchedParents.has(owner.metadata_item_id)
                        && owner.tag_id === tagId;
                    if (!replacedByCommitDelete) {
                        ++potentialRemappedMarkerIds;
                    }
                }
            });

            return {
                parentCount,
                deletedMarkers,
                insertedMarkers,
                potentialRemappedMarkerIds,
            };
        });
}

/**
 * @param {boolean} [includeLiveImpact] */
function detachedCommitPreview(includeLiveImpact) {
    assertRunningState('preview detached commit');
    assertDetachedActive('preview detached commit');

    const checkpoint = DetachedSession.actionCheckpoint();
    const touchedParentIds = BackupManager.touchedParentIdsSince(checkpoint);
    const pendingChanges = pendingChangesForCheckpoint(checkpoint);
    const commit = includeLiveImpact && touchedParentIds.length > 0 ?
        previewCommitToLive(touchedParentIds) :
        {
            parentCount : 0,
            deletedMarkers : 0,
            insertedMarkers : 0,
            potentialRemappedMarkerIds : 0,
        };

    return {
        checkpointActionId : checkpoint,
        touchedParentIds : touchedParentIds,
        pendingChanges : pendingChanges.sections,
        commit : commit,
        detached : DetachedSession.status(),
    };
}

/**
 * @param {ExpressResponse} response */
async function detachedStart(response) {
    assertRunningState('start detached mode');
    if (DetachedSession.active()) {
        throw new ServerError('Detached mode is already active.', 409);
    }

    const checkpoint = BackupManager.latestActionId();
    const status = DetachedSession.start(Config.liveDatabasePath(), checkpoint);
    MarkerEditorConfig.SetRuntimeDatabasePath(DetachedSession.runtimeDatabasePath());
    await waitForServerEvent(ServerEvents.SoftRestart, response, {
        message : 'Detached mode started.',
        detached : status,
    });
}

/**
 * @param {ExpressResponse} response */
async function detachedDiscard(response) {
    assertRunningState('discard detached mode');
    assertDetachedActive('discard detached mode');

    // Read the checkpoint before finish() - finish resets it to 0. We need it to scope
    // the backup-action cleanup to rows added during this detached session, so the
    // discarded fork-only marker ids don't resurface as purged markers later.
    const checkpoint = DetachedSession.actionCheckpoint();
    BackupManager.clearActionsSince(checkpoint);

    const status = DetachedSession.finish();
    MarkerEditorConfig.SetRuntimeDatabasePath(null);
    await waitForServerEvent(ServerEvents.SoftRestart, response, {
        message : 'Detached mode discarded.',
        detached : status,
    });
}

/**
 * @param {ExpressResponse} response */
async function detachedCommit(response) {
    assertRunningState('commit detached mode');
    assertDetachedActive('commit detached mode');

    const checkpoint = DetachedSession.actionCheckpoint();
    const touchedParentIds = BackupManager.touchedParentIdsSince(checkpoint);
    Log.info(`Committing detached mode changes for ${touchedParentIds.length} item(s).`);

    let commitResult = {
        parentCount : 0,
        deletedMarkers : 0,
        insertedMarkers : 0,
        remappedMarkerIds : 0,
        markerIdMap : {},
    };

    if (touchedParentIds.length > 0) {
        commitResult = commitForkToLive(touchedParentIds);
        if (Object.keys(commitResult.markerIdMap).length > 0) {
            BackupManager.remapMarkerIdsSince(checkpoint, commitResult.markerIdMap);
        }
    }

    const status = DetachedSession.finish();
    MarkerEditorConfig.SetRuntimeDatabasePath(null);
    await waitForServerEvent(ServerEvents.SoftRestart, response, {
        message : 'Detached mode committed.',
        detached : status,
        commit : {
            parentCount : commitResult.parentCount,
            deletedMarkers : commitResult.deletedMarkers,
            insertedMarkers : commitResult.insertedMarkers,
            remappedMarkerIds : commitResult.remappedMarkerIds,
        },
    });
}

export function registerDetachedCommands() {
    registerCommand(PostCommands.DetachedStatus, _ => DetachedSession.status());
    registerCommand(PostCommands.DetachedStart, q => detachedStart(q.response()), true /*ownsResponse*/);
    registerCommand(PostCommands.DetachedUndoChange, q => detachedUndoChange(q.i('markerId')));
    registerCommand(PostCommands.DetachedDiscard, q => detachedDiscard(q.response()), true /*ownsResponse*/);
    registerCommand(PostCommands.DetachedCommit, q => detachedCommit(q.response()), true /*ownsResponse*/);
    registerCommand(PostCommands.DetachedCommitPreview, q => detachedCommitPreview(q.i('includeLive') === 1));
}
