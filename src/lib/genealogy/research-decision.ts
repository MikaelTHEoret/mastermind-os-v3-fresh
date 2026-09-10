import { INITIAL_FRONTIERS } from './frontiers';
import { normalizeIdentity } from './gedcom';

export type ResearchPerson = { id:string; label:string; branch:string; proofStrength:number; reviewStatus:string; depth:number; metadata:Record<string,unknown> };
type Features = { lineage:number; evidenceGap:number; informationGain:number; sourceAvailability:number; disambiguation:number; branchInterest:number };
export type ResearchCandidate = { frontierId:string; nodeId:string|null; target:string; branch:string; score:number; attraction:number; cost:number; features:Features; reasons:string[] };
export type ResearchMission = { frontierId:string; nodeId:string|null; target:string; branch:string; objective:string; place:string; yearFrom:number|null; yearTo:number|null; variants:string[]; firstAction:string; actions:string[]; stoppingRules:string[]; rationale:string };

export const RESEARCH_VANTAGE = {
  id:'proof-first-main-lines-v1',
  goal:'Extend the direct paternal and maternal ancestry with original evidence, prioritizing Durocher, Power, Theoret, Charette, and the Baril/Barry question.',
  vector:{lineage:1,evidenceGap:1,informationGain:0.9,sourceAvailability:0.9,disambiguation:0.8,branchInterest:0.85},
  rule:'Relevance is relative to this goal. Imported-tree claims are leads, not proof.',
};

const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const dot=(a:Features,b:Features)=>Object.keys(a).reduce((sum,key)=>sum+a[key as keyof Features]*b[key as keyof Features],0);
const cosine=(a:Features,b:Features)=>{const aa=Math.sqrt(dot(a,a)),bb=Math.sqrt(dot(b,b));return aa&&bb?dot(a,b)/(aa*bb):0;};
const tokens=(value:string)=>new Set(normalizeIdentity(value).split(' ').filter((token)=>token.length>2&&!['dit','line','founder','origin'].includes(token)));
const overlap=(a:Set<string>,b:Set<string>)=>{let n=0;for(const value of a)if(b.has(value))n++;return n/Math.max(1,Math.min(a.size,b.size));};

function matchPerson(target:string,branch:string,people:ResearchPerson[]):ResearchPerson|null{
  const wanted=tokens(`${target} ${branch}`);
  return [...people].map((person)=>({person,similarity:overlap(wanted,tokens(`${person.label} ${person.branch}`))}))
    .filter((item)=>item.similarity>=0.34).sort((a,b)=>b.similarity-a.similarity||b.person.depth-a.person.depth)[0]?.person??null;
}

function branchInterest(branch:string):number{
  const key=normalizeIdentity(branch); if(key.includes('power'))return 1; if(key.includes('baril')||key.includes('barry'))return 0.98;
  if(['durocher','theoret','charette'].some((name)=>key.includes(name)))return 0.95; return 0.65;
}

export function decideResearch(people:ResearchPerson[]):{selected:ResearchCandidate;mission:ResearchMission;candidates:ResearchCandidate[];vantage:typeof RESEARCH_VANTAGE}{
  const goal=RESEARCH_VANTAGE.vector as Features;
  const candidates=INITIAL_FRONTIERS.map((frontier)=>{
    const person=matchPerson(frontier.person,frontier.branch,people); const place=frontier.place??'';
    const priority=frontier.priority==='critical'?1:frontier.priority==='high'?0.84:0.64;
    const imported=person?.reviewStatus==='imported';
    const evidenceGap=person?(imported?Math.max(0.76,1-Math.min(person.proofStrength,0.42)):1-person.proofStrength):0.82;
    const informationGain=person?clamp(0.42+person.depth/18):0.62;
    const knownPlace=Boolean(place&&!/^unknown/i.test(place)); const bounded=frontier.yearFrom!=null&&frontier.yearTo!=null;
    let sourceAvailability=(knownPlace?0.62:0.24)+(bounded?0.35:frontier.yearFrom||frontier.yearTo?0.18:0);
    if((place.match(/\//g)?.length??0)>=2)sourceAvailability-=0.16;
    const disambiguation=clamp(0.46+frontier.variants.length*0.09+(frontier.rationale.toLowerCase().includes('distinguish')?0.14:0));
    const features:Features={lineage:priority,evidenceGap:clamp(evidenceGap),informationGain,sourceAvailability:clamp(sourceAvailability),disambiguation,branchInterest:branchInterest(frontier.branch)};
    const attraction=cosine(features,goal); const utility=features.lineage*0.24+features.evidenceGap*0.22+features.informationGain*0.17+features.sourceAvailability*0.18+features.disambiguation*0.11+features.branchInterest*0.08;
    const cost=(!knownPlace?0.14:0)+(!bounded?0.06:0)+((place.match(/\//g)?.length??0)>=2?0.05:0);
    const score=clamp(attraction*0.48+utility*0.52-cost);
    const reasons=[frontier.priority==='critical'?'critical direct-line frontier':'main-line frontier',imported?'current support is inherited rather than reviewed proof':'evidence gap remains open',knownPlace&&bounded?'bounded place and time window makes a crawl testable':'search space needs narrowing',frontier.rationale];
    return {frontierId:frontier.id,nodeId:person?.id??null,target:frontier.person,branch:frontier.branch,score,attraction,cost,features,reasons};
  }).sort((a,b)=>b.score-a.score);
  const selected=candidates[0]; const frontier=INITIAL_FRONTIERS.find((item)=>item.id===selected.frontierId)!;
  const place=frontier.place??'Unresolved'; const range=frontier.yearFrom&&frontier.yearTo?`${frontier.yearFrom}–${frontier.yearTo}`:'the earliest confirmed event backward';
  const firstAction=`Catalogue the relevant register coverage for ${place}, ${range}, then run a low-cost scan for ${frontier.variants.join(', ')} before ordering high-resolution transcription.`;
  const mission:ResearchMission={frontierId:frontier.id,nodeId:selected.nodeId,target:frontier.person,branch:frontier.branch,objective:frontier.objective,place,yearFrom:frontier.yearFrom??null,yearTo:frontier.yearTo??null,variants:frontier.variants,firstAction,
    actions:[firstAction,'Cluster every matching household and record witnesses, sponsors, occupations, and neighbouring families.','Compare each candidate against dates, spouse, children, migration path, and historical parish boundaries.','Create evidence-backed graph proposals; do not merge or rewrite the tree automatically.'],
    stoppingRules:['Stop promotion when no original image or archival citation supports the relationship.','Stop and branch the hypothesis when two households remain equally plausible.','Complete the mission only when the relationship is supported or the searched register range is documented as exhausted.'],rationale:selected.reasons.join(' · ')};
  return {selected,mission,candidates,vantage:RESEARCH_VANTAGE};
}

