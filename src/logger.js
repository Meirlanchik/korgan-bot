import { addSyncLog } from './db.js';

export function logRuntime(type, status, message, details = null) {
    const prefix = `[${type}] ${status.toUpperCase()}`;
    if (details) {
        console.log(prefix, message, details);
    } else {
        console.log(prefix, message);
    }

    try {
        addSyncLog(type, status, message, details);
    } catch {
        // Database logging is best-effort during early startup.
    }
}