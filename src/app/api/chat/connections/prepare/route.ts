import {requireOwner} from '@/lib/trading/auth';
import {gatewayForAuthenticatedOwner} from '@/lib/mastermind-context/gateway';
import {authorizeOwnerRequest,readNodeJson} from '@/lib/node-exchange/http';
import {enrollmentHandler,resolveEnrollmentOwner} from '@/lib/chat-room/enrollment.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
export const POST=enrollmentHandler({authorizeRequest:authorizeOwnerRequest,authenticate:requireOwner,readJson:readNodeJson,
 enabled:process.env.MASTERMIND_SHARED_ROOMS_ENABLED==='true',
 identityFor:(subject:string)=>resolveEnrollmentOwner(gatewayForAuthenticatedOwner,subject)});
