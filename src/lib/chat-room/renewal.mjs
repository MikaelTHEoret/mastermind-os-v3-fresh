import {CATALOG_VERSION,MODELS,providerConfiguration} from './providers.mjs';
import {digest,RoomError} from './contract.mjs';

// Renewal cannot carry the October price/availability review forward indefinitely.
export const CATALOG_REVIEW_UNTIL=Date.parse('2026-10-31T00:00:00Z');
export const RENEWAL_DURATION=86400000;
const fail=code=>{throw new RoomError(code,409);};
function basis(env,owner,participants,now){
 if(env.MASTERMIND_ROOM_RENEWAL_ENABLED!=='true'||now>=CATALOG_REVIEW_UNTIL)return null;
 let base;try{base=JSON.parse(env.MASTERMIND_ROOM_API_POLICY);}catch{return null;}
 if(!base||base.catalogVersion!==CATALOG_VERSION||base.allowPaid!==false)return null;
 const start=Date.parse(base.reviewedAt),end=Date.parse(base.expiresAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<=start||end-start>RENEWAL_DURATION)return null;
 const models=[...new Set(participants.filter(p=>p.transport==='api').map(p=>p.model))].sort();
 if(!models.length||models.some(id=>!MODELS.some(m=>m.id===id&&!m.paid)))return null;
 // Ignore only the old expiry for eligibility. All owner/key/provider/kill-switch checks remain.
 const fresh={...base,reviewedAt:new Date(now).toISOString(),expiresAt:new Date(now+RENEWAL_DURATION).toISOString()};
 const config=providerConfiguration({...env,MASTERMIND_ROOM_API_POLICY:JSON.stringify(fresh)},owner,now);
 if(models.some(id=>!config.entries.find(m=>m.id===id)?.ready))return null;
 const providers=[...new Set(models.map(id=>MODELS.find(m=>m.id===id).provider))].sort();
 return {base,baseDigest:digest(base),models,providers,scopeDigest:digest({base,models})};
}
export function renewalOffer(env,owner,participants,now=Date.now()){
 const b=basis(env,owner,participants,now);
 return b?{scopeDigest:b.scopeDigest,providers:b.providers,models:b.models,geminiFreeTierRequired:b.providers.includes('gemini'),
  durationHours:24,catalogVersion:CATALOG_VERSION,catalogReviewUntil:new Date(CATALOG_REVIEW_UNTIL).toISOString()}:null;
}
export function prepareRoomRenewal(env,owner,participants,input,now=Date.now()){
 const b=basis(env,owner,participants,now);
 if(!b||input.scopeDigest!==b.scopeDigest)fail('ROOM_RENEWAL_UNAVAILABLE');
 if(input.reviewConfirmed!==true||input.geminiFreeTierConfirmed!==b.providers.includes('gemini'))fail('ROOM_RENEWAL_REVIEW_REQUIRED');
 return {baseDigest:b.baseDigest,scopeDigest:b.scopeDigest,providers:b.providers,reviewConfirmed:true,
  geminiFreeTierConfirmed:input.geminiFreeTierConfirmed,reviewedAt:new Date(now).toISOString(),
  expiresAt:new Date(Math.min(now+RENEWAL_DURATION,CATALOG_REVIEW_UNTIL)).toISOString()};
}
export function roomEnvironment(env,owner,participants,renewal,now=Date.now()){
 if(!renewal)return env;
 const b=basis(env,owner,participants,now),start=Date.parse(renewal.reviewedAt),end=Date.parse(renewal.expiresAt);
 const valid=b&&renewal.baseDigest===b.baseDigest&&renewal.scopeDigest===b.scopeDigest&&renewal.reviewConfirmed===true
  &&JSON.stringify(renewal.providers)===JSON.stringify(b.providers)&&renewal.geminiFreeTierConfirmed===b.providers.includes('gemini')
  &&Number.isFinite(start)&&Number.isFinite(end)&&start<=now&&end>now&&end>start&&end-start<=RENEWAL_DURATION&&end<=CATALOG_REVIEW_UNTIL;
 // An invalid saved renewal never falls back to an older environment approval.
 if(!valid)return {...env,MASTERMIND_ROOM_API_POLICY:''};
 const policy={...b.base,reviewedAt:renewal.reviewedAt,expiresAt:renewal.expiresAt,allowPaid:false,
  providers:Object.fromEntries(b.providers.map(name=>[name,b.base.providers[name]]))};
 return {...env,MASTERMIND_ROOM_API_POLICY:JSON.stringify(policy)};
}
