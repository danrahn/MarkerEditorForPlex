import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const buildDir = import.meta.dirname;
const packageJson = JSON.parse(readFileSync(resolve(buildDir, '../package.json')).toString('utf-8'));
const { version } = packageJson;

const appName = 'Marker Editor for Plex';
const binaryName = 'MarkerEditor';
const legalCopyright =
    'MarkerEditor.exe copyright Daniel Rahn. MIT license. node.exe copyright Node.js contributors. MIT license.';
const rcVersion = version.replace(/-(?:alpha|beta|rc)(?:\.\d+)?$/, '');
const windowsVersion = normalizeWindowsVersion(rcVersion);

const iconPath = resolve(buildDir, 'app.ico');
const defaultLanguage = 1033; // en-US
const unicodeCodePage = 1200; // UTF-16 LE

/**
 * Ensure versions match Windows resource format: x.x.x.x
 * @param {string} versionString */
function normalizeWindowsVersion(versionString) {
    const parts = versionString
        .split('.')
        .map(part => Number.parseInt(part, 10))
        .map(part => Number.isFinite(part) && part >= 0 ? part : 0);

    while (parts.length < 4) {
        parts.push(0);
    }

    return parts.slice(0, 4).join('.');
}

/**
 * @param {string} exePath */
function stampWindowsResources(exePath) {
    const baseExeData = readFileSync(exePath);
    const exe = NtExecutable.from(baseExeData, { ignoreCert : true });
    const resources = NtExecutableResource.from(exe);

    const iconFile = Data.IconFile.from(readFileSync(iconPath));
    const iconGroups = Resource.IconGroupEntry.fromEntries(resources.entries);
    const iconGroupId = iconGroups[0]?.id ?? 1;
    const iconLang = iconGroups[0]?.lang ?? defaultLanguage;

    Resource.IconGroupEntry.replaceIconsForResource(
        resources.entries,
        iconGroupId,
        iconLang,
        iconFile.icons.map(icon => icon.data));

    const versionInfoList = Resource.VersionInfo.fromEntries(resources.entries);
    const versionInfo = versionInfoList.length > 0 ?
        versionInfoList[0] :
        Resource.VersionInfo.createEmpty();
    versionInfo.lang = defaultLanguage;
    versionInfo.setFileVersion(windowsVersion, defaultLanguage);
    versionInfo.setProductVersion(windowsVersion, defaultLanguage);
    versionInfo.setStringValues(
        { lang : defaultLanguage, codepage : unicodeCodePage },
        {
            CompanyName : appName,
            ProductName : appName,
            FileDescription : appName,
            FileVersion : windowsVersion,
            ProductVersion : windowsVersion,
            InternalName : `${binaryName}.exe`,
            LegalCopyright : legalCopyright,
        });
    versionInfo.outputToResourceEntries(resources.entries);

    resources.outputResource(exe);
    writeFileSync(exePath, Buffer.from(exe.generate()));
}

/**
 * Apply Windows icon/version resources to an executable.
 * @param {string} exePath
 * @param {{ verbose?: boolean }} [options] */
export function applyWindowsResources(exePath, options={}) {
    if (process.platform !== 'win32') {
        return;
    }

    const verbose = !!options.verbose;

    if (!existsSync(exePath)) {
        throw new Error(`Binary not found: ${exePath}`);
    }

    if (!existsSync(iconPath)) {
        throw new Error(`Icon file not found: ${iconPath}`);
    }

    if (verbose) {
        console.log(`Applying Windows resources to ${exePath} with resedit backend...`);
    }

    stampWindowsResources(exePath);
    if (verbose) {
        console.log('Windows resource stamping complete.');
    }
}
