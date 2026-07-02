// src/lib/trading/btcc.ts -- SERVER-ONLY BTCC TradeOpenAPI client (spot).
// Spec source: BTCC_EN TradeOpenApi (04-25-2025). Base https://spot-openapi.btcc.com
// Auth: MD5 signature -- add secret_key to params, sort keys ASCII, join k=v with &,
// md5 hex -> send as `sign` (the secret itself is NEVER sent). Login yields token+accountid;
// authed calls sign {accountid, token}. First (and so far only) consumer of decryptSecret.
// Never import in a client component. Never return keys/token/secret to callers beyond this module.
import crypto from 'crypto';
import { getPrimaryDb } from '@/lib/db';
import { decryptSecret } from '@/lib/integrations/crypto';

const BASE = 'https://api1.btloginc.com:9081';

export interface BtccCreds { apiKey: string; apiSecret: string; }

// Reads the active encrypted BTCC rows the operator saved via Settings -> BTCC Exchange.
export async function getBtccCreds(): Promise<BtccCreds | null> {
  const sql = getPrimaryDb();
  const rows = await sql`
    SELECT env_key, value_encrypted FROM mastermind_integrations
    WHERE provider_id = 'btcc' AND is_active = true AND value_encrypted IS NOT NULL` as any[];
  const enc = (k: string) => rows.find(r => r.env_key === k)?.value_encrypted;
  const key = enc('BTCC_API_KEY'), sec = enc('BTCC_API_SECRET');
  if (!key || !sec) return null;
  return { apiKey: decryptSecret(key), apiSecret: decryptSecret(sec) };
}

// Doc's signature rule, verbatim: params + secret_key, ASCII-sorted, k=v joined by &, md5 hex.
export function btccSign(params: Record<string, string | number>, apiSecret: string): string {
  const all: Record<string, string> = { ...Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, String(v)])), secret_key: apiSecret };
  const str = Object.keys(all).sort().map(k => `${k}=${all[k]}`).join('&');
  return crypto.createHash('md5').update(str).digest('hex');
}

async function btccGet(path: string, params: Record<string, string | number>, apiSecret: string) {
  const sign = btccSign(params, apiSecret);
  const qs = new URLSearchParams(
    { ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), sign });
  const r = await fetch(`${BASE}${path}?${qs.toString()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`BTCC HTTP ${r.status} on ${path}`);
  return r.json();
}

export interface BtccSession { token: string; accountid: number; }

export async function btccLogin(creds: BtccCreds): Promise<BtccSession> {
  const j = await btccGet('/btcc_api_trade/user/login', { api_key: creds.apiKey }, creds.apiSecret);
  if (j.code !== 0) throw new Error(`BTCC login code ${j.code}: ${j.msg ?? ''}`);
  return { token: j.token, accountid: j.accountid };
}

// Connectivity rung: login + getAccountInfo. Returns the raw account object (owner-gated caller only).
export async function btccGetAccountInfo(creds: BtccCreds): Promise<any> {
  const s = await btccLogin(creds);
  const j = await btccGet('/btcc_api_trade/account/getAccountInfo',
    { accountid: s.accountid, token: s.token }, creds.apiSecret);
  if (j.code !== 0) throw new Error(`BTCC getAccountInfo code ${j.code}: ${j.msg ?? ''}`);
  return j;
}
