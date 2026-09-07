import { getMemoryDb } from '@/lib/db';
import { captureSecretMatches } from './archive-store.mjs';
import { captureCredentials, captureOrigin } from './capture-policy.mjs';

export async function authenticateCaptureClient(request:Request,approvedOnly=true){
  const credentials=captureCredentials(request),origin=captureOrigin(request);
  if(!credentials || !origin)return null;
  const {clientId,secret}=credentials,sql=getMemoryDb();
  const rows=await sql`SELECT client_id,extension_origin,secret_sha256,status FROM genealogy_capture_clients WHERE client_id=${clientId}::uuid LIMIT 1`;
  const client=rows[0];
  if(!client || !['pending','approved','revoked'].includes(String(client.status)) || (approvedOnly && client.status!=='approved')
    || client.extension_origin!==origin || !captureSecretMatches(secret,client.secret_sha256))return null;
  return{sql,clientId,status:String(client.status)};
}
