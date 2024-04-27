import { ServerSettings } from '/Shared/ServerConfig.js';

export const ValidationInputDelay = 500;

/**
 * @enum
 * @type {{ [setting: string]: string }} */
export const SettingTitles = {
    [ServerSettings.DataPath] : 'Data Path',
    [ServerSettings.Database] : 'Database File',
    [ServerSettings.Host] : 'Listen Host',
    [ServerSettings.Port] : 'Listen Port',
    [ServerSettings.LogLevel] : 'Log Level',
    [ServerSettings.AutoOpen] : 'Open Browser on Launch',
    [ServerSettings.ExtendedStats] : 'Extended Marker Statistics',
    [ServerSettings.PreviewThumbnails] : 'Use Preview Thumbnails',
    [ServerSettings.FFmpegThumbnails] : 'Use FFmpeg for Thumbnails',
    [ServerSettings.PathMappings] : 'Path Mappings',
};
