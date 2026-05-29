// lib/db.ts — lazy Neon connections for the command center
// Connections are created on first call, not at import time
import { neon } from '@neondatabase/serverless';

let _primary: ReturnType<typeof neon> | null = null;
let _memory:  ReturnType<typeof neon> | null = null;

export function getDb() {
    if (!_primary) {
        if (!process.env.NEON_PRIMARY_URL) throw new Error('NEON_PRIMARY_URL not set');
        _primary = neon(process.env.NEON_PRIMARY_URL);
    }
    return _primary;
}

export function getMemoryDb() {
    if (!_memory) {
        if (!process.env.NEON_MEMORY_URL) throw new Error('NEON_MEMORY_URL not set');
        _memory = neon(process.env.NEON_MEMORY_URL);
    }
    return _memory;
}

// Convenience aliases
export const sqlPrimary = (...args: Parameters<ReturnType<typeof neon>>) => getDb()(...args);
export const sqlMemory  = (...args: Parameters<ReturnType<typeof neon>>) => getMemoryDb()(...args);
