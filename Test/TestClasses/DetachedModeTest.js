import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';

import { GetServerState, ServerState } from '../../Server/ServerState.js';
import { ServerEvents, waitForServerEvent } from '../../Server/ServerEvents.js';
import { BackupManager } from '../../Server/MarkerBackupManager.js';
import { PostCommands } from '../../Shared/PostCommands.js';

/**
 * @typedef {!import('../../Shared/PlexTypes').DetachedCommitPreviewResult} DetachedCommitPreviewResult
 * @typedef {!import('../../Shared/PlexTypes').DetachedStatus} DetachedStatus
 */

/**
 * Integration tests for detached mode scenarios.
 */
class DetachedModeTest extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.detachedStatusDefaultsToLive,
            this.detachedStartWhileActiveFails,
            this.detachedSuspendWhileActiveFails,
            this.detachedAutoSuspendWhileActiveIsSkipped,
            this.detachedCommitWhileInactiveFails,
            this.detachedDiscardWhileInactiveFails,
            this.detachedCommitPreviewWhileInactiveFails,
            this.detachedCommitPreviewWithoutChangesReturnsZeroImpact,
            this.detachedCommitPreviewReportsPendingChanges,
            this.detachedCommitPreviewTracksNetChangesAgainstExistingMarkers,
            this.detachedCommitPreviewIgnoresActionsFromOtherServers,
            this.detachedRemapMarkerIdsSkipsOtherServerActions,
            this.detachedStatePersistsAcrossRestart,
            this.detachedMissingForkOnRestartRecoversToLive,
            this.detachedUndoPendingAddChange,
            this.detachedUndoPendingDeleteChange,
            this.detachedUndoPendingEditChange,
            this.detachedDiscardDropsForkChanges,
            this.detachedDiscardClearsBackupActions,
            this.detachedPendingChangesIncludePlexGeneratedDeletes,
            this.detachedPendingChangesIncludePlexGeneratedEdits,
            this.detachedUndoDeleteRemovesPendingEntry,
            this.detachedUndoEditOfPlexMarkerLeavesNoPending,
            this.detachedUndoNestedAddEditCleansSession,
            this.detachedCommitPersistsForkChanges,
        ];
    }

    className() { return 'DetachedModeTest'; }

    async testMethodTeardown() {
        await this.#ensureLiveMode();
        await super.testMethodTeardown();
    }

    /**
     * Validate default detached status when no session is active. */
    async detachedStatusDefaultsToLive() {
        const status = await this.send(PostCommands.DetachedStatus);
        this.#verifyLiveStatus(status);
    }

    /**
     * Validate starting detached mode while already active fails with a conflict. */
    async detachedStartWhileActiveFails() {
        await this.send(PostCommands.DetachedStart);

        this.expectFailure();
        const response = await this.send(PostCommands.DetachedStart, {}, true /*raw*/);
        await this.#verifyErrorStatus(response, 409, 'detached start while already active');

        const activeStatus = await this.send(PostCommands.DetachedStatus);
        TestHelpers.verify(activeStatus.active, 'Expected detached mode to remain active after conflicting start request');
        TestHelpers.verify(
            activeStatus.mode === 'detached',
            `Expected mode='detached' after conflicting start, found '${activeStatus.mode}'`);
    }

    /**
     * Validate suspending while detached mode is active fails with a conflict. */
    async detachedSuspendWhileActiveFails() {
        await this.send(PostCommands.DetachedStart);

        this.expectFailure();
        const response = await this.send(PostCommands.ServerSuspend, {}, true /*raw*/);
        await this.#verifyErrorStatus(response, 409, 'server suspend while detached mode is active');

        const status = await this.send(PostCommands.DetachedStatus);
        TestHelpers.verify(status.active,
            'Expected detached mode to remain active after blocked suspend attempt');
        TestHelpers.verify(
            GetServerState() === ServerState.Running,
            `Expected server state=${ServerState.Running} after blocked suspend, found ${GetServerState()}`);
    }

    /**
     * Validate auto-suspend attempts are ignored while detached mode is active. */
    async detachedAutoSuspendWhileActiveIsSkipped() {
        await this.send(PostCommands.DetachedStart);
        TestHelpers.verify(GetServerState() === ServerState.Running,
            `Expected server state=${ServerState.Running} before auto-suspend event, found ${GetServerState()}`);

        await waitForServerEvent(ServerEvents.AutoSuspend);

        TestHelpers.verify(GetServerState() === ServerState.Running,
            `Expected server state=${ServerState.Running} after auto-suspend event in detached mode, found ${GetServerState()}`);

        const status = await this.send(PostCommands.DetachedStatus);
        TestHelpers.verify(status.active,
            'Expected detached mode to remain active after skipped auto-suspend');
    }

    /**
     * Validate committing while inactive fails with a bad request. */
    async detachedCommitWhileInactiveFails() {
        this.expectFailure();
        const response = await this.send(PostCommands.DetachedCommit, {}, true /*raw*/);
        await this.#verifyErrorStatus(response, 400, 'detached commit while inactive');

        const status = await this.send(PostCommands.DetachedStatus);
        this.#verifyLiveStatus(status);
    }

    /**
     * Validate discarding while inactive fails with a bad request. */
    async detachedDiscardWhileInactiveFails() {
        this.expectFailure();
        const response = await this.send(PostCommands.DetachedDiscard, {}, true /*raw*/);
        await this.#verifyErrorStatus(response, 400, 'detached discard while inactive');

        const status = await this.send(PostCommands.DetachedStatus);
        this.#verifyLiveStatus(status);
    }

    /**
     * Validate previewing a commit while inactive fails with a bad request. */
    async detachedCommitPreviewWhileInactiveFails() {
        this.expectFailure();
        const response = await this.#getPreview(true /*raw*/);
        await this.#verifyErrorStatus(response, 400, 'detached commit preview while inactive');

        const status = await this.send(PostCommands.DetachedStatus);
        this.#verifyLiveStatus(status);
    }

    /**
     * Validate preview response when there are no pending detached-mode edits. */
    async detachedCommitPreviewWithoutChangesReturnsZeroImpact() {
        await this.send(PostCommands.DetachedStart);

        /** @type {DetachedCommitPreviewResult} */
        const preview = await this.#getPreview();
        this.#verifyPreviewResponse(preview);

        TestHelpers.verify(preview.touchedParentIds.length === 0,
            `Expected no touched parent ids for preview with no edits, found ${preview.touchedParentIds.length}`);
        TestHelpers.verify(preview.pendingChanges.length === 0,
            `Expected pendingChanges to be empty for preview with no edits, found ${preview.pendingChanges.length}`);
        TestHelpers.verify(preview.commit.parentCount === 0,
            `Expected parentCount=0 for preview with no edits, found ${preview.commit.parentCount}`);
        TestHelpers.verify(preview.commit.deletedMarkers === 0,
            `Expected deletedMarkers=0 for preview with no edits, found ${preview.commit.deletedMarkers}`);
        TestHelpers.verify(preview.commit.insertedMarkers === 0,
            `Expected insertedMarkers=0 for preview with no edits, found ${preview.commit.insertedMarkers}`);
        TestHelpers.verify(preview.commit.potentialRemappedMarkerIds === 0,
            'Expected potentialRemappedMarkerIds=0 for preview with no edits');

        TestHelpers.verify(preview.detached.active,
            'Expected preview to leave detached mode active when no edits are pending');
        TestHelpers.verify(preview.detached.mode === 'detached',
            `Expected preview detached state='detached', found '${preview.detached.mode}'`);
    }

    /**
     * Validate preview response reflects pending detached-mode changes. */
    async detachedCommitPreviewReportsPendingChanges() {
        const episodeId = TestBase.DefaultMetadata.Show1.Season1.Episode1.Id;

        await this.send(PostCommands.DetachedStart);
        await this.addMarker(episodeId, 2500, 6500, 'intro');

        /** @type {DetachedCommitPreviewResult} */
        const preview = await this.#getPreview();
        this.#verifyPreviewResponse(preview);

        TestHelpers.verify(preview.touchedParentIds.indexOf(episodeId) !== -1,
            `Expected preview touched ids to include ${episodeId}`);
        TestHelpers.verify(preview.commit.parentCount === 1,
            `Expected preview parentCount=1, found ${preview.commit.parentCount}`);
        TestHelpers.verify(preview.commit.deletedMarkers === 0,
            `Expected preview deletedMarkers=0, found ${preview.commit.deletedMarkers}`);
        TestHelpers.verify(preview.commit.insertedMarkers === 1,
            `Expected preview insertedMarkers=1, found ${preview.commit.insertedMarkers}`);
        TestHelpers.verify(
            preview.commit.potentialRemappedMarkerIds >= 0
            && preview.commit.potentialRemappedMarkerIds <= preview.commit.insertedMarkers,
            `Expected potential remap count to be in [0, ${preview.commit.insertedMarkers}], ` +
            `found ${preview.commit.potentialRemappedMarkerIds}`);

        TestHelpers.verify(preview.detached.active,
            'Expected preview to keep detached mode active when pending edits exist');
        TestHelpers.verify(preview.detached.mode === 'detached',
            `Expected preview detached state='detached', found '${preview.detached.mode}'`);

        const pendingRows = preview.pendingChanges.flatMap(section => section.media.flatMap(media => media.rows));
        TestHelpers.verify(pendingRows.length === 1,
            `Expected exactly 1 pending row, found ${pendingRows.length}`);
        TestHelpers.verify(pendingRows[0].operation === 'add',
            `Expected pending row operation='add', found '${pendingRows[0].operation}'`);
        TestHelpers.verify(pendingRows[0].markerType === 'intro',
            `Expected pending row markerType='intro', found '${pendingRows[0].markerType}'`);

        const markerMap = await this.send(PostCommands.Query, { keys : episodeId });
        const markers = markerMap[episodeId] || [];
        TestHelpers.verify(markers.length === 1,
            `Expected marker count in detached workspace to remain 1 after preview, found ${markers.length}`);
    }

    /**
     * Validate preview reports net marker deltas when the touched item already has live markers. */
    async detachedCommitPreviewTracksNetChangesAgainstExistingMarkers() {
        const episodeId = TestBase.DefaultMetadata.Show1.Season1.Episode1.Id;

        await this.addMarker(episodeId, 1000, 5000, 'intro');
        await this.send(PostCommands.DetachedStart);
        await this.addMarker(episodeId, 7000, 9000, 'credits');

        /** @type {DetachedCommitPreviewResult} */
        const preview = await this.#getPreview();
        this.#verifyPreviewResponse(preview);

        TestHelpers.verify(preview.touchedParentIds.indexOf(episodeId) !== -1,
            `Expected touched parent ids to include ${episodeId}`);
        TestHelpers.verify(preview.commit.parentCount === 1,
            `Expected preview parentCount=1, found ${preview.commit.parentCount}`);
        TestHelpers.verify(preview.commit.deletedMarkers === 0,
            `Expected preview deletedMarkers=0, found ${preview.commit.deletedMarkers}`);
        TestHelpers.verify(preview.commit.insertedMarkers === 1,
            `Expected preview insertedMarkers=1, found ${preview.commit.insertedMarkers}`);
    }

    /**
     * Validate preview only includes actions for this server's section UUID set. */
    async detachedCommitPreviewIgnoresActionsFromOtherServers() {
        const episodeId = TestBase.DefaultMetadata.Show1.Season1.Episode1.Id;
        const foreignMarkerId = 7600001;
        const foreignParentId = 7600002;

        await this.send(PostCommands.DetachedStart);
        const status = await this.send(PostCommands.DetachedStatus);
        await this.addMarker(episodeId, 1900, 3900, 'intro');

        const localAction = this.backupDb.get(
            'SELECT section_id FROM actions WHERE id>? ORDER BY id DESC LIMIT 1;',
            [status.actionCheckpoint]);
        TestHelpers.verify(!!localAction,
            'Expected at least one local detached action row before adding foreign action data');

        this.backupDb.run(`
INSERT INTO actions (
    op, marker_id, parent_id, season_id, show_id, section_id,
    start, end, created_at, extra_data, section_uuid, marker_type, final, user_created
) VALUES (
    ?, ?, ?, ?, ?, ?,
    ?, ?, (strftime('%s','now')), ?, ?, ?, ?, ?
);`, [1, foreignMarkerId, foreignParentId, -1, -1, localAction.section_id,
            1000, 2000, '', 'foreign-server-uuid', 'intro', 0, 1]);

        /** @type {DetachedCommitPreviewResult} */
        const preview = await this.#getPreview();
        this.#verifyPreviewResponse(preview);

        TestHelpers.verify(preview.touchedParentIds.indexOf(foreignParentId) === -1,
            `Expected foreign parent ${foreignParentId} to be excluded from touched ids`);

        const pendingRows = preview.pendingChanges.flatMap(section => section.media.flatMap(media => media.rows));
        TestHelpers.verify(!pendingRows.some(row => row.markerId === foreignMarkerId),
            `Expected foreign marker ${foreignMarkerId} to be excluded from pending rows`);
    }

    /**
     * Validate remapping marker ids after commit does not touch rows from another server UUID scope. */
    async detachedRemapMarkerIdsSkipsOtherServerActions() {
        const episodeId = TestBase.DefaultMetadata.Show1.Season1.Episode1.Id;
        const localParentId = 7700001;
        const foreignParentId = 7700002;
        const oldMarkerId = 7700100;
        const newMarkerId = 7700200;

        await this.send(PostCommands.DetachedStart);
        const status = await this.send(PostCommands.DetachedStatus);
        await this.addMarker(episodeId, 4100, 6100, 'intro');

        const localAction = this.backupDb.get(
            'SELECT section_id, section_uuid FROM actions WHERE id>? ORDER BY id DESC LIMIT 1;',
            [status.actionCheckpoint]);
        TestHelpers.verify(!!localAction?.section_uuid,
            'Expected a local detached action to provide section UUID context');

        const insertAction = (parentId, sectionUuid) => this.backupDb.run(`
INSERT INTO actions (
    op, marker_id, parent_id, season_id, show_id, section_id,
    start, end, created_at, extra_data, section_uuid, marker_type, final, user_created
) VALUES (
    ?, ?, ?, ?, ?, ?,
    ?, ?, (strftime('%s','now')), ?, ?, ?, ?, ?
);`, [1, oldMarkerId, parentId, -1, -1, localAction.section_id,
            1200, 2400, '', sectionUuid, 'intro', 0, 1]);

        insertAction(localParentId, localAction.section_uuid);
        insertAction(foreignParentId, 'foreign-server-uuid');

        BackupManager.remapMarkerIdsSince(status.actionCheckpoint, { [oldMarkerId] : newMarkerId });

        const localRow = this.backupDb.get(
            'SELECT marker_id FROM actions WHERE id>? AND parent_id=? AND section_uuid=? ORDER BY id DESC LIMIT 1;',
            [status.actionCheckpoint, localParentId, localAction.section_uuid]);
        const foreignRow = this.backupDb.get(
            'SELECT marker_id FROM actions WHERE id>? AND parent_id=? AND section_uuid=? ORDER BY id DESC LIMIT 1;',
            [status.actionCheckpoint, foreignParentId, 'foreign-server-uuid']);

        TestHelpers.verify(localRow?.marker_id === newMarkerId,
            `Expected local marker id to remap to ${newMarkerId}, found ${localRow?.marker_id}`);
        TestHelpers.verify(foreignRow?.marker_id === oldMarkerId,
            `Expected foreign marker id to remain ${oldMarkerId}, found ${foreignRow?.marker_id}`);
    }

    /**
     * Validate that an active detached session is restored after a server restart. */
    async detachedStatePersistsAcrossRestart() {
        const episodeId = TestBase.DefaultMetadata.Show1.Season1.Episode1.Id;

        await this.send(PostCommands.DetachedStart);
        await this.addMarker(episodeId, 4100, 8200, 'intro');

        /** @type {DetachedCommitPreviewResult} */
        const beforeRestart = await this.#getPreview();
        this.#verifyPreviewResponse(beforeRestart);
        const beforeRows = beforeRestart.pendingChanges.flatMap(section => section.media.flatMap(media => media.rows));
        TestHelpers.verify(beforeRows.length === 1,
            `Expected one pending row before restart, found ${beforeRows.length}`);

        await this.send(PostCommands.ServerRestart);

        const resumedStatus = await this.#waitForDetachedStatus();
        TestHelpers.verify(resumedStatus.active,
            'Expected detached mode to remain active after restart');
        TestHelpers.verify(resumedStatus.mode === 'detached',
            `Expected mode='detached' after restart, found '${resumedStatus.mode}'`);

        /** @type {DetachedCommitPreviewResult} */
        const afterRestart = await this.#getPreview();
        this.#verifyPreviewResponse(afterRestart);
        const afterRows = afterRestart.pendingChanges.flatMap(section => section.media.flatMap(media => media.rows));
        TestHelpers.verify(afterRows.length === 1,
            `Expected one pending row after restart, found ${afterRows.length}`);
        TestHelpers.verify(afterRows[0].markerType === 'intro',
            `Expected pending marker type to remain 'intro', found '${afterRows[0].markerType}'`);
    }

    /**
     * Validate that an incomplete detached session (missing fork DB) recovers to live mode on restart. */
    async detachedMissingForkOnRestartRecoversToLive() {
        const episodeId = TestBase.DefaultMetadata.Show1.Season1.Episode1.Id;

        await this.send(PostCommands.DetachedStart);
        await this.addMarker(episodeId, 5100, 9100, 'intro');

        const activeStatus = await this.send(PostCommands.DetachedStatus);
        TestHelpers.verify(!!activeStatus.forkDatabasePath,
            'Expected an active detached fork path before simulating an incomplete session');

        const detachedSessionFile = join(TestBase.root, 'Backup', 'detachedSession.json');
        const persistedSession = JSON.parse(readFileSync(detachedSessionFile, { encoding : 'utf-8' }));
        persistedSession.forkDatabasePath = `${activeStatus.forkDatabasePath}.missing`;
        writeFileSync(detachedSessionFile, JSON.stringify(persistedSession, null, 2), { encoding : 'utf-8' });

        await this.send(PostCommands.ServerRestart);

        const recoveredStatus = await this.#waitForDetachedStatus();
        this.#verifyLiveStatus(recoveredStatus);
        TestHelpers.verify(
            recoveredStatus.incompleteActionIds > 0,
            `Expected incompleteActionIds > 0 after recovering incomplete detached session, found ${recoveredStatus.incompleteActionIds}`);

        this.expectFailure();
        const previewWhileInactive = await this.#getPreview(true /*raw*/);
        await this.#verifyErrorStatus(previewWhileInactive, 400, 'detached commit preview while inactive after recovery');

        const markerMap = await this.send(PostCommands.Query, { keys : episodeId });
        const markers = markerMap[episodeId] || [];
        TestHelpers.verify(markers.length === 0,
            `Expected detached-only marker edits to be absent after recovery to live mode, found ${markers.length} markers`);
    }

    /**
     * Validate that a single pending add can be undone via detached undo and is removed from preview output. */
    async detachedUndoPendingAddChange() {
        const episodeId = TestBase.DefaultMetadata.Show1.Season1.Episode1.Id;

        await this.send(PostCommands.DetachedStart);
        await this.addMarker(episodeId, 3100, 7400, 'intro');

        /** @type {DetachedCommitPreviewResult} */
        const beforeUndo = await this.#getPreview();
        const beforeRows = beforeUndo.pendingChanges.flatMap(section => section.media.flatMap(media => media.rows));
        TestHelpers.verify(beforeRows.length === 1,
            `Expected one pending change before undo, found ${beforeRows.length}`);

        await this.send(PostCommands.DetachedUndoChange, { markerId : beforeRows[0].markerId });

        /** @type {DetachedCommitPreviewResult} */
        const afterUndo = await this.#getPreview();
        this.#verifyPreviewResponse(afterUndo);

        const afterRows = afterUndo.pendingChanges.flatMap(section => section.media.flatMap(media => media.rows));
        TestHelpers.verify(afterRows.length === 0,
            `Expected no pending rows after undo, found ${afterRows.length}`);
        TestHelpers.verify(afterUndo.commit.deletedMarkers === 0,
            `Expected deletedMarkers=0 after undo, found ${afterUndo.commit.deletedMarkers}`);
        TestHelpers.verify(afterUndo.commit.insertedMarkers === 0,
            `Expected insertedMarkers=0 after undo, found ${afterUndo.commit.insertedMarkers}`);

        const markerMap = await this.send(PostCommands.Query, { keys : episodeId });
        const markers = markerMap[episodeId] || [];
        TestHelpers.verify(markers.length === 0,
            `Expected no markers in detached workspace after undoing add, found ${markers.length}`);
    }

    /**
     * Validate that a pending delete can be undone, restoring the marker in detached mode. */
    async detachedUndoPendingDeleteChange() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const baselineStart = episode.Marker1.Start + 1000;
        const baselineEnd = episode.Marker1.End + 1000;

        await this.editMarker(episode.Marker1.Id, baselineStart, baselineEnd, episode.Marker1.Type, episode.Marker1.Final);

        await this.send(PostCommands.DetachedStart);
        await this.send('delete', { id : episode.Marker1.Id });

        /** @type {DetachedCommitPreviewResult} */
        const beforeUndo = await this.#getPreview();
        const beforeRows = beforeUndo.pendingChanges.flatMap(section => section.media.flatMap(media => media.rows));
        const pendingDelete = beforeRows.find(row => row.markerId === episode.Marker1.Id);
        TestHelpers.verify(!!pendingDelete,
            `Expected marker ${episode.Marker1.Id} to appear in pending detached changes`);
        TestHelpers.verify(pendingDelete.operation === 'delete',
            `Expected marker ${episode.Marker1.Id} pending operation='delete', found '${pendingDelete.operation}'`);

        await this.send(PostCommands.DetachedUndoChange, { markerId : episode.Marker1.Id });

        /** @type {DetachedCommitPreviewResult} */
        const afterUndo = await this.#getPreview();
        const afterRows = afterUndo.pendingChanges.flatMap(section => section.media.flatMap(media => media.rows));
        TestHelpers.verify(!afterRows.some(row => row.markerId === episode.Marker1.Id),
            `Expected marker ${episode.Marker1.Id} to be removed from pending rows after undo`);

        const markerMap = await this.send(PostCommands.Query, { keys : episode.Id });
        const markers = markerMap[episode.Id] || [];
        const restored = markers.find(marker => marker.start === baselineStart
            && marker.end === baselineEnd
            && marker.markerType === episode.Marker1.Type);
        TestHelpers.verify(!!restored,
            `Expected deleted marker timings/type to be restored after undo for marker ${episode.Marker1.Id}`);
    }

    /**
     * Validate that a pending edit can be undone, restoring baseline marker timings. */
    async detachedUndoPendingEditChange() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const baselineStart = episode.Marker1.Start + 1000;
        const baselineEnd = episode.Marker1.End + 1000;
        const editedStart = baselineStart + 1000;
        const editedEnd = baselineEnd + 1000;

        await this.editMarker(episode.Marker1.Id, baselineStart, baselineEnd, episode.Marker1.Type, episode.Marker1.Final);

        await this.send(PostCommands.DetachedStart);
        await this.editMarker(episode.Marker1.Id, editedStart, editedEnd, episode.Marker1.Type, episode.Marker1.Final);

        /** @type {DetachedCommitPreviewResult} */
        const beforeUndo = await this.#getPreview();
        const beforeRows = beforeUndo.pendingChanges.flatMap(section => section.media.flatMap(media => media.rows));
        const pendingEdit = beforeRows.find(row => row.markerId === episode.Marker1.Id);
        TestHelpers.verify(!!pendingEdit,
            `Expected marker ${episode.Marker1.Id} to appear in pending detached changes`);
        TestHelpers.verify(pendingEdit.operation === 'edit',
            `Expected marker ${episode.Marker1.Id} pending operation='edit', found '${pendingEdit.operation}'`);

        await this.send(PostCommands.DetachedUndoChange, { markerId : episode.Marker1.Id });

        /** @type {DetachedCommitPreviewResult} */
        const afterUndo = await this.#getPreview();
        const afterRows = afterUndo.pendingChanges.flatMap(section => section.media.flatMap(media => media.rows));
        TestHelpers.verify(!afterRows.some(row => row.markerId === episode.Marker1.Id),
            `Expected marker ${episode.Marker1.Id} to be removed from pending rows after undo`);

        const markerMap = await this.send(PostCommands.Query, { keys : episode.Id });
        const markers = markerMap[episode.Id] || [];
        const restored = markers.find(marker => marker.id === episode.Marker1.Id);
        TestHelpers.verify(!!restored,
            `Expected edited marker ${episode.Marker1.Id} to exist after undo`);
        TestHelpers.verify(restored.start === baselineStart,
            `Expected marker ${episode.Marker1.Id} start=${baselineStart} after undo, found ${restored.start}`);
        TestHelpers.verify(restored.end === baselineEnd,
            `Expected marker ${episode.Marker1.Id} end=${baselineEnd} after undo, found ${restored.end}`);
    }

    /**
     * Validate that discard removes all uncommitted changes made while in detached mode. */
    async detachedDiscardDropsForkChanges() {
        const episodeId = TestBase.DefaultMetadata.Show1.Season1.Episode1.Id;

        await this.send(PostCommands.DetachedStart);
        const startedStatus = await this.send(PostCommands.DetachedStatus);
        TestHelpers.verify(startedStatus.active, `Expected detached mode to be active after ${PostCommands.DetachedStart}`);
        TestHelpers.verify(
            startedStatus.mode === 'detached',
            `Expected detached mode state to be 'detached', found '${startedStatus.mode}'`);
        TestHelpers.verify(!!startedStatus.forkDatabasePath, 'Expected detached mode to have a fork database path');

        await this.addMarker(episodeId, 1000, 5000, 'intro');
        let markerMap = await this.send(PostCommands.Query, { keys : episodeId });
        let markers = markerMap[episodeId] || [];
        TestHelpers.verify(markers.length === 1, `Expected 1 marker in detached workspace, found ${markers.length}`);

        await this.send(PostCommands.DetachedDiscard);
        const discardedStatus = await this.send(PostCommands.DetachedStatus);
        this.#verifyLiveStatus(discardedStatus);

        markerMap = await this.send(PostCommands.Query, { keys : episodeId });
        markers = markerMap[episodeId] || [];
        TestHelpers.verify(markers.length === 0, `Expected 0 markers after discard, found ${markers.length}`);
    }

    /**
     * Validate that discarding detached mode removes its backup action rows so that the
     * fork-only marker ids don't masquerade as purged markers in the live database. */
    async detachedDiscardClearsBackupActions() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const episodeId = episode.Id;

        await this.send(PostCommands.DetachedStart);
        const startedStatus = await this.send(PostCommands.DetachedStatus);
        const checkpoint = startedStatus.actionCheckpoint;

        // Mix of operations to make sure none survive the discard: an add of a brand-new
        // (fork-only) marker, plus an edit against an existing live marker.
        await this.addMarker(episodeId, 60000, 75000, 'credits');
        await this.editMarker(
            episode.Marker1.Id,
            episode.Marker1.Start + 250,
            episode.Marker1.End + 250,
            episode.Marker1.Type,
            episode.Marker1.Final);

        const recordedActions = this.backupDb.all(
            'SELECT id FROM actions WHERE id>?;',
            [checkpoint]);
        TestHelpers.verify(recordedActions.length >= 2,
            `Expected at least two backup actions during detached session, found ${recordedActions.length}`);

        await this.send(PostCommands.DetachedDiscard);
        const discardedStatus = await this.send(PostCommands.DetachedStatus);
        this.#verifyLiveStatus(discardedStatus);

        const leftoverActions = this.backupDb.all(
            'SELECT id, op, marker_id FROM actions WHERE id>?;',
            [checkpoint]);
        TestHelpers.verify(leftoverActions.length === 0,
            `Expected detached backup actions to be cleared after discard, found ${leftoverActions.length}` +
            (leftoverActions.length > 0 ?
                ` (${leftoverActions.map(a => `id=${a.id} op=${a.op} marker_id=${a.marker_id}`).join('; ')})` :
                ''));

        const purged = await this.send(PostCommands.PurgeCheck, { id : episodeId });
        TestHelpers.verify(Array.isArray(purged) && purged.length === 0,
            `Expected no purged markers for episode ${episodeId} after discard, found ${purged?.length}`);
    }

    /**
     * Validate that deleting a marker which has no prior backup action (i.e. a Plex-generated marker
     * untouched before detached mode started) still surfaces as a 'delete' row in the pending changes
     * table, not just in the aggregate "Markers Deleted" count. */
    async detachedPendingChangesIncludePlexGeneratedDeletes() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const markerId = episode.Marker1.Id;

        await this.send(PostCommands.DetachedStart);
        await this.send('delete', { id : markerId });

        /** @type {DetachedCommitPreviewResult} */
        const preview = await this.#getPreview();
        this.#verifyPreviewResponse(preview);

        TestHelpers.verify(preview.commit.deletedMarkers === 1,
            `Expected aggregate deletedMarkers=1, found ${preview.commit.deletedMarkers}`);

        const rows = preview.pendingChanges.flatMap(section => section.media.flatMap(media => media.rows));
        const deleteRow = rows.find(row => row.markerId === markerId);
        TestHelpers.verify(!!deleteRow,
            `Expected pending changes table to include a row for deleted marker ${markerId}`);
        TestHelpers.verify(deleteRow.operation === 'delete',
            `Expected pending row operation='delete' for marker ${markerId}, found '${deleteRow?.operation}'`);
    }

    /**
     * Validate that editing a marker with no prior backup action surfaces as an 'edit' row
     * in the pending changes table (rather than misreporting it as an 'add'). */
    async detachedPendingChangesIncludePlexGeneratedEdits() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const marker = episode.Marker1;
        const newStart = marker.Start + 500;
        const newEnd = marker.End + 500;

        await this.send(PostCommands.DetachedStart);
        await this.editMarker(marker.Id, newStart, newEnd, marker.Type, marker.Final);

        /** @type {DetachedCommitPreviewResult} */
        const preview = await this.#getPreview();
        this.#verifyPreviewResponse(preview);

        const rows = preview.pendingChanges.flatMap(section => section.media.flatMap(media => media.rows));
        const editRow = rows.find(row => row.markerId === marker.Id);
        TestHelpers.verify(!!editRow,
            `Expected pending changes table to include a row for edited marker ${marker.Id}`);
        TestHelpers.verify(editRow.operation === 'edit',
            `Expected pending row operation='edit' for marker ${marker.Id}, found '${editRow?.operation}'`);
    }

    /**
     * Validate that undoing a delete leaves the pending changes table empty and the marker
     * keeps its original id (rather than reappearing as a brand-new 'add' from a Restore action). */
    async detachedUndoDeleteRemovesPendingEntry() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const markerId = episode.Marker1.Id;

        await this.send(PostCommands.DetachedStart);
        const startedStatus = await this.send(PostCommands.DetachedStatus);
        const checkpoint = startedStatus.actionCheckpoint;

        await this.send('delete', { id : markerId });

        /** @type {DetachedCommitPreviewResult} */
        const beforeUndo = await this.#getPreview();
        const beforeRows = beforeUndo.pendingChanges.flatMap(s => s.media.flatMap(m => m.rows));
        TestHelpers.verify(beforeRows.length === 1 && beforeRows[0].operation === 'delete',
            `Expected a single pending 'delete' row before undo, found ${beforeRows.length} rows`);

        await this.send(PostCommands.DetachedUndoChange, { markerId });

        /** @type {DetachedCommitPreviewResult} */
        const afterUndo = await this.#getPreview();
        const afterRows = afterUndo.pendingChanges.flatMap(s => s.media.flatMap(m => m.rows));
        TestHelpers.verify(afterRows.length === 0,
            `Expected pending changes to be empty after undo, found ${afterRows.length} rows ` +
            `(operations: ${afterRows.map(r => r.operation).join(', ')})`);
        TestHelpers.verify(afterUndo.commit.deletedMarkers === 0,
            `Expected deletedMarkers=0 after undo, found ${afterUndo.commit.deletedMarkers}`);
        TestHelpers.verify(afterUndo.commit.insertedMarkers === 0,
            `Expected insertedMarkers=0 after undo, found ${afterUndo.commit.insertedMarkers}`);

        const markerMap = await this.send(PostCommands.Query, { keys : episode.Id });
        const markers = markerMap[episode.Id] || [];
        const restored = markers.find(m => m.id === markerId);
        TestHelpers.verify(!!restored,
            `Expected marker ${markerId} to be re-inserted into the fork with its original id, ` +
            `found ids [${markers.map(m => m.id).join(', ')}]`);

        const leftover = this.backupDb.all(
            'SELECT id, op, marker_id FROM actions WHERE id>?;',
            [checkpoint]);
        TestHelpers.verify(leftover.length === 0,
            `Expected no leftover session actions after undo, found ${leftover.length}` +
            (leftover.length > 0 ?
                ` (${leftover.map(a => `id=${a.id} op=${a.op} marker_id=${a.marker_id}`).join('; ')})` :
                ''));
    }

    /**
     * Validate that undoing an edit on a Plex-generated marker (no prior backup action) succeeds
     * and leaves the marker at its live-DB timings instead of throwing for a missing baseline. */
    async detachedUndoEditOfPlexMarkerLeavesNoPending() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const marker = episode.Marker1;
        const editedStart = marker.Start + 750;
        const editedEnd = marker.End + 750;

        await this.send(PostCommands.DetachedStart);
        await this.editMarker(marker.Id, editedStart, editedEnd, marker.Type, marker.Final);

        await this.send(PostCommands.DetachedUndoChange, { markerId : marker.Id });

        /** @type {DetachedCommitPreviewResult} */
        const afterUndo = await this.#getPreview();
        const afterRows = afterUndo.pendingChanges.flatMap(s => s.media.flatMap(m => m.rows));
        TestHelpers.verify(afterRows.length === 0,
            `Expected pending changes to be empty after undoing edit, found ${afterRows.length}`);

        const markerMap = await this.send(PostCommands.Query, { keys : episode.Id });
        const markers = markerMap[episode.Id] || [];
        const restored = markers.find(m => m.id === marker.Id);
        TestHelpers.verify(!!restored, `Expected marker ${marker.Id} to remain in the fork after undo`);
        TestHelpers.verify(restored.start === marker.Start,
            `Expected marker ${marker.Id} start=${marker.Start} after undo, found ${restored.start}`);
        TestHelpers.verify(restored.end === marker.End,
            `Expected marker ${marker.Id} end=${marker.End} after undo, found ${restored.end}`);
    }

    /**
     * Validate nested undo: an in-session add followed by an in-session edit collapses to a single
     * 'add' row, and undoing it removes the marker entirely along with both backup actions. */
    async detachedUndoNestedAddEditCleansSession() {
        const episodeId = TestBase.DefaultMetadata.Show1.Season1.Episode1.Id;

        await this.send(PostCommands.DetachedStart);
        const startedStatus = await this.send(PostCommands.DetachedStatus);
        const checkpoint = startedStatus.actionCheckpoint;

        const added = await this.addMarker(episodeId, 2000, 6000, 'intro');
        const newMarkerId = added.id;
        await this.editMarker(newMarkerId, 3000, 7000, 'intro', false);

        const beforeActions = this.backupDb.all(
            'SELECT id FROM actions WHERE marker_id=? AND id>?;',
            [newMarkerId, checkpoint]);
        TestHelpers.verify(beforeActions.length === 2,
            `Expected two backup actions (add+edit) for marker ${newMarkerId}, found ${beforeActions.length}`);

        /** @type {DetachedCommitPreviewResult} */
        const beforeUndo = await this.#getPreview();
        const beforeRows = beforeUndo.pendingChanges.flatMap(s => s.media.flatMap(m => m.rows));
        const beforeRow = beforeRows.find(r => r.markerId === newMarkerId);
        TestHelpers.verify(beforeRow?.operation === 'add',
            `Expected nested add+edit to surface as a single 'add' row, found '${beforeRow?.operation}'`);

        await this.send(PostCommands.DetachedUndoChange, { markerId : newMarkerId });

        /** @type {DetachedCommitPreviewResult} */
        const afterUndo = await this.#getPreview();
        const afterRows = afterUndo.pendingChanges.flatMap(s => s.media.flatMap(m => m.rows));
        TestHelpers.verify(afterRows.length === 0,
            `Expected pending changes to be empty after undoing nested add+edit, found ${afterRows.length}`);

        const leftover = this.backupDb.all(
            'SELECT id FROM actions WHERE marker_id=? AND id>?;',
            [newMarkerId, checkpoint]);
        TestHelpers.verify(leftover.length === 0,
            `Expected both backup actions for marker ${newMarkerId} to be cleared after undo, found ${leftover.length}`);

        const markerMap = await this.send(PostCommands.Query, { keys : episodeId });
        const markers = markerMap[episodeId] || [];
        TestHelpers.verify(!markers.some(m => m.id === newMarkerId),
            `Expected marker ${newMarkerId} to be removed from the fork after undo`);
    }

    /**
     * Validate that commit persists detached-mode changes to the live database. */
    async detachedCommitPersistsForkChanges() {
        const episodeId = TestBase.DefaultMetadata.Show1.Season1.Episode1.Id;

        await this.send(PostCommands.DetachedStart);
        await this.addMarker(episodeId, 2000, 7000, 'intro');
        await this.send(PostCommands.DetachedCommit);

        const committedStatus = await this.send(PostCommands.DetachedStatus);
        this.#verifyLiveStatus(committedStatus);

        const markerMap = await this.send(PostCommands.Query, { keys : episodeId });
        const markers = markerMap[episodeId] || [];
        TestHelpers.verify(markers.length === 1, `Expected 1 marker after commit, found ${markers.length}`);
        TestHelpers.verify(markers[0].start === 2000, `Expected committed marker start=2000, found ${markers[0].start}`);
        TestHelpers.verify(markers[0].end === 7000, `Expected committed marker end=7000, found ${markers[0].end}`);
        TestHelpers.verify(markers[0].markerType === 'intro', `Expected committed marker type='intro', found '${markers[0].markerType}'`);
    }

    /**
     * Ensure no detached session remains active after a test, even on failures. */
    async #ensureLiveMode() {
        const status = await this.#waitForDetachedStatus();
        if (status.active) {
            await this.send(PostCommands.DetachedDiscard);
        }
    }

    /**
     * Poll detached status while waiting for restart transitions to settle.
     * @param {number} [attempts=50]
     * @param {number} [delayMs=100]
     * @returns {Promise<DetachedStatus>} */
    async #waitForDetachedStatus(attempts=50, delayMs=100) {
        for (let i = 0; i < attempts; ++i) {
            const state = GetServerState();
            if ([ServerState.FirstBoot, ServerState.ReInit, ServerState.ShuttingDown].includes(state)) {
                await new Promise(resolve => {
                    setTimeout(resolve, delayMs);
                });
                continue;
            }

            const status = await this.send(PostCommands.DetachedStatus);
            if (status && typeof status.active === 'boolean') {
                return status;
            }

            await new Promise(resolve => {
                setTimeout(resolve, delayMs);
            });
        }

        throw new Error('Timed out waiting for detached status to become available.');
    }

    /**
     * Validate expected failure response status and payload shape.
     * @param {Response} response
     * @param {number} expectedStatus
     * @param {string} testCase */
    async #verifyErrorStatus(response, expectedStatus, testCase) {
        TestHelpers.verify(response.status === expectedStatus,
            `Expected ${testCase} to return ${expectedStatus}, found ${response.status}`);

        const payload = await response.json();
        TestHelpers.verify(!!payload.Error,
            `Expected ${testCase} response to include an Error field`);
    }

    /**
     * Validate preview response payload shape.
     * @param {DetachedCommitPreviewResult} preview */
    #verifyPreviewResponse(preview) {
        TestHelpers.verify(!!preview && typeof preview === 'object', 'Expected preview response object');
        TestHelpers.verify(typeof preview.checkpointActionId === 'number' && preview.checkpointActionId >= 0,
            `Expected non-negative checkpointActionId, found ${preview.checkpointActionId}`);
        TestHelpers.verify(preview.touchedParentIds instanceof Array,
            'Expected preview touchedParentIds to be an array');
        TestHelpers.verify(preview.pendingChanges instanceof Array,
            'Expected preview pendingChanges to be an array');
        TestHelpers.verify(!!preview.commit && typeof preview.commit === 'object',
            'Expected preview commit payload');
        TestHelpers.verify(!!preview.detached && typeof preview.detached === 'object',
            'Expected preview detached payload');
    }

    /**
     * @param {DetachedStatus} status */
    #verifyLiveStatus(status) {
        TestHelpers.verify(!status.active, `Expected detached mode to be inactive, found active=${status.active}`);
        TestHelpers.verify(status.mode === 'live', `Expected mode='live', found '${status.mode}'`);
        TestHelpers.verify(status.forkDatabasePath === null, `Expected no fork database in live mode, found '${status.forkDatabasePath}'`);
    }

    /** @returns {Promise<DetachedCommitPreviewResult>} */
    #getPreview(raw=false) {
        return this.send(PostCommands.DetachedCommitPreview, { includeLive : 1 }, raw);
    }
}

export default DetachedModeTest;
