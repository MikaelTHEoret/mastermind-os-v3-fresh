// lib/db.ts — Neon connection for the command center
import { neon } from '@neondatabase/serverless';

// Primary DB (Minecraft data)
export const sqlPrimary = neon(process.env.NEON_PRIMARY_URL!);

// Memory DB (sessions, chat, patterns)
export const sqlMemory = neon(process.env.NEON_MEMORY_URL!);

export type PacketStat = {
    packet_type: string;
    direction: string;
    n: number;
    category: string | null;
};

export type ACCorrection = {
    ts: string;
    ac_response: Record<string, unknown>;
    delta_ms: number;
};

export type ChatMessage = {
    ts: string;
    username: string;
    message: string;
    is_bot_response: boolean | null;
    account_type: string | null;
    response_latency_ms: number | null;
};

export type TPSTick = {
    ts: string;
    tps: number;
    game_time: number;
};

export type PingEntry = {
    ts: string;
    ping_ms: number;
    tps_local: number;
};

export type SessionInfo = {
    id: string;
    context: Record<string, unknown>;
    state: Record<string, unknown>;
    created_at: string;
    updated_at: string;
};

export type ChunkEvent = {
    ts: string;
    event_type: string;
    chunk_x: number;
    chunk_z: number;
    world_x: number;
    world_z: number;
};
