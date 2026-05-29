// lib/db.ts — Neon connections for the command center
import { neon } from '@neondatabase/serverless';

// Use functions so connections are created at runtime not build time
export function getPrimaryDb() {
    return neon(process.env.NEON_PRIMARY_URL!);
}

export function getMemoryDb() {
    return neon(process.env.NEON_MEMORY_URL!);
}
