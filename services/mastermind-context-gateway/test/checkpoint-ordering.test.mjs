import test from 'node:test';
import assert from 'node:assert/strict';
import {captureCheckpointOrderingQuery} from '../scripts/checkpoint-ordering-fixture.mjs';
test('SQL fixture captures the actual projectState checkpoint query and exact numeric ordering',async()=>{
 const query=await captureCheckpointOrderingQuery();
 assert.match(query.statement,/sequence::text/);
 assert.match(query.statement,/FROM public\.mastermind_context_checkpoints_v1 checkpoints/);
 assert.match(query.statement,/ORDER BY task_id, checkpoints\.sequence DESC/);
 assert.equal(query.parameters[0].length,3);assert.match(query.storeSha256,/^[0-9a-f]{64}$/);
});
