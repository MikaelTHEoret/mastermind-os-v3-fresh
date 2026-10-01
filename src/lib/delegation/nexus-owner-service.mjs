import {NexusProposalStore} from './nexus-store.mjs';
import {taskRef,canonical,ContributionError} from './contract.mjs';
import {checkedMaterial} from './nexus-owner-workflow.mjs';

// Server-side composition only. An owner-authenticated route must create this
// service with its own owner mapping and pinned host reader, never client proof.
// No public route or worker capability is enabled by importing this module.
export class NexusOwnerService{
 constructor(query,owner,{enabled=false,referenceReader=null}={}){
  this.reader=referenceReader;
  this.store=new NexusProposalStore(query,owner,{enabled,
   verifyReferences:referenceReader&&typeof referenceReader.verify==='function'
    ?record=>referenceReader.verify(structuredClone(record)):null});
 }
 async load(rawRef){
  const ref=taskRef(rawRef);await this.store.assertTask(ref,true);
  if(!this.reader||typeof this.reader.material!=='function')throw new ContributionError('NEXUS_REFERENCE_READER_UNAVAILABLE',503);
  const material=checkedMaterial(await this.reader.material(structuredClone(ref)),ref);
  const artifacts=await this.store.list(ref);
  await this.store.assertTask(ref,true);
  if(canonical(material.taskRef)!==canonical(ref))throw new ContributionError('NEXUS_REFERENCES_UNVERIFIED',409);
  return {material,artifacts,executionAuthorized:false};
 }
 save(record){return this.store.save(record);}
 recover(ref,operationId){return this.store.recover(ref,operationId);}
}
