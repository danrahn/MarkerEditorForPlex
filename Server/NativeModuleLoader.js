import { dirname, join } from 'path';
import { createRequire } from 'module';
import { existsSync } from 'fs';

const sourceRequire = createRequire(import.meta.url);

/**
 * Load a module in source builds, or prefer executable-adjacent sidecar modules
 * when running as a packaged binary.
 * @param {string} moduleName
 * @returns {*} */
export function loadRuntimeModule(moduleName) {
    if (!process.pkg) {
        return sourceRequire(moduleName);
    }

    const executableDir = dirname(process.execPath);
    const sidecarPackagePath = join(executableDir, 'node_modules', moduleName, 'package.json');
    if (existsSync(sidecarPackagePath)) {
        return createRequire(sidecarPackagePath)(moduleName);
    }

    return sourceRequire(moduleName);
}
