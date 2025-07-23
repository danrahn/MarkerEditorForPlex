/**
 * All available POST commands. */
export const PostCommands = {
    /** @readonly Add a new marker. */
    AddMarker : 'add',
    /** @readonly Edit an existing marker. */
    EditMarker : 'edit',
    /** @readonly Delete an existing marker. */
    DeleteMarker : 'delete',
    /** @readonly Check whether a given shift command is valid. */
    CheckShift : 'check_shift',
    /** @readonly Shift multiple markers. */
    ShiftMarkers : 'shift',

    /** @readonly Bulk delete markers for a show/season. */
    BulkDelete : 'bulk_delete',
    /** @readonly Bulk add markers to a show/season. */
    BulkAdd : 'bulk_add',
    /** @readonly Bulk add markers with customized start/end timestamps. */
    BulkAddCustom : 'add_custom',

    /** @readonly Get marker information for all metadata ids specified. */
    Query : 'query',
    /** @readonly Retrieve all libraries on the server. */
    GetLibraries : 'get_sections',
    /** @readonly Get details for a specific library. */
    GetLibrary : 'get_section',
    /** @readonly Get season information for a single show. */
    GetSeasons : 'get_seasons',
    /** @readonly Get episode information for a single season of a show. */
    GetEpisodes : 'get_episodes',
    /** @readonly Get all episodes for a single show, accepting an episode, season, or show ID. */
    GetShowEpisodes : 'get_show_episodes',
    /** @readonly Check whether thumbnails exist for a single movie/episode. */
    CheckThumbs : 'check_thumbs',
    /** @readonly Get marker statistics for an entire library. */
    GetStats : 'get_stats',
    /** @readonly Get the marker breakdown for a specific metadata id. */
    GetBreakdown : 'get_breakdown',
    /** @readonly  Get chapters associated with the given metadata id. */
    GetChapters : 'get_chapters',
    /** @readonly Get all available information for the given metadata id (markers, thumbnails, chapters) */
    FullQuery : 'query_full',

    /** @readonly Retrieve the current server config. */
    GetConfig : 'get_config',
    /** @readonly Validate an entire config file. */
    ValidateConfig : 'validate_config',
    /** @readonly Validate a single value in the config file. */
    ValidateConfigValue : 'valid_cfg_v',
    /** @readonly Set the server configuration, if possible. */
    SetConfig : 'set_config',

    /** @readonly Checked for purged markers for the given metadata id. */
    PurgeCheck : 'purge_check',
    /** @readonly Find all purged markers for the given library section. */
    AllPurges : 'all_purges',
    /** @readonly Restore purged markers for the given list of purged marker ids. */
    RestorePurges : 'restore_purge',
    /** @readonly Ignore the given purged markers. */
    IgnorePurges : 'ignore_purge',

    /** @readonly Import markers from a previously exported marker database. */
    ImportDb : 'import_db',
    /** @readonly Completely wipe out markers for the given library. */
    Nuke : 'nuke_section',

    /** @readonly Shut down Marker Editor */
    ServerShutdown : 'shutdown',
    /** @readonly Restart Marker Editor, including the HTTP server */
    ServerRestart : 'restart',
    /** @readonly Restart Marker Editor without restarting the HTTP server. */
    ServerReload : 'reload',
    /** @readonly Disconnect from the Plex database. */
    ServerSuspend : 'suspend',
    /** @readonly Reconnect to the Plex database after suspending the connection. */
    ServerResume : 'resume',

    /** @readonly Log in, if auth is enabled. */
    Login : 'login',
    /** @readonly Log out of a session. */
    Logout : 'logout',
    /** @readonly Change the single-user password. */
    ChangePassword : 'change_password',
    /** @readonly Check whether authentication is enabled, but a user password is not set. */
    NeedsPassword : 'check_password',
};

/**
 * Set of commands allowed when the server is suspended. */
export const SuspendedWhitelist = new Set([
    PostCommands.ServerResume,
    PostCommands.ServerShutdown,
    PostCommands.NeedsPassword,
    PostCommands.Login,
    PostCommands.Logout
]);
