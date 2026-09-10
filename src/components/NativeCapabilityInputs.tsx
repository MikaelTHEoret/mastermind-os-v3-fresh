'use client';

import {useEffect,useId,useRef,useState} from 'react';

export type NativeJson=string|number|boolean|null|NativeJson[]|{[key:string]:NativeJson};
export type NativeSchema={type?:string|string[];title?:string;description?:string;enum?:NativeJson[];
  properties?:Record<string,NativeSchema>;required?:string[];items?:NativeSchema;additionalProperties?:boolean;
  minItems?:number;maxItems?:number;minimum?:number;maximum?:number;maxLength?:number};
export type NativeContract={name:string;description?:string;inputSchema:NativeSchema};
const field:React.CSSProperties={width:'100%',boxSizing:'border-box',padding:8,border:'1px solid #38616d',borderRadius:5,background:'#0a222d',color:'#fff',font:'inherit'};
const button:React.CSSProperties={padding:'7px 10px',border:'1px solid #377888',borderRadius:5,background:'#143744',color:'#eaffff',cursor:'pointer'};
const label=(name:string)=>name==='sha256'?'SHA-256':name.replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
const object=(value:NativeJson|undefined):value is Record<string,NativeJson>=>!!value && typeof value==='object' && !Array.isArray(value);
const owns=(value:object,key:string)=>Object.prototype.hasOwnProperty.call(value,key);

function initial(schema:NativeSchema):NativeJson {
  if(schema.enum?.length)return schema.enum[0];
  if(schema.type==='array')return [];
  if(schema.type==='object' || schema.properties)return Object.fromEntries((schema.required ?? []).filter(key=>schema.properties?.[key]).map(key=>[key,initial(schema.properties![key])]));
  if(schema.type==='integer' || schema.type==='number')return schema.minimum ?? 0;
  if(schema.type==='boolean')return false;
  return schema.type==='string'?'':null;
}

function manifestRows(value:NativeJson,schema:NativeSchema):NativeJson[] {
  let rows:NativeJson[];
  if(Array.isArray(value))rows=value;
  else if(object(value) && Array.isArray(value.files))rows=value.files;
  else if(object(value) && Array.isArray(value.artifacts))rows=value.artifacts;
  else if(object(value) && object(value.sources)) {
    rows=Object.entries(value.sources).flatMap(([source,record])=>{
      if(!object(record) || !Array.isArray(record.files))throw new Error('Every source must include its file inventory.');
      return record.files.map(item=>{
        if(!object(item) || typeof item.path!=='string')throw new Error('Every artifact needs its original path.');
        return {...item,path:source+'/'+item.path};
      });
    });
  } else throw new Error('Choose an artifact list or a release manifest containing files.');
  const properties=schema.items?.properties ?? {};
  return rows.filter(row=>!(object(row) && row.deleted===true)).map(row=>{
    if(!object(row) || typeof row.path!=='string' || typeof row.sha256!=='string')throw new Error('Each artifact needs a path and SHA-256 hash.');
    // Release metadata is not a capability argument. Keep declared artifact fields only.
    return Object.fromEntries(Object.keys(properties).filter(key=>owns(row,key)).map(key=>[key,row[key]]));
  });
}

function ValueField({name,schema,value,onChange,disabled,depth=0,manifest=false}:{name:string;schema:NativeSchema;
  value:NativeJson|undefined;onChange:(value:NativeJson)=>void;disabled:boolean;depth?:number;manifest?:boolean}) {
  const id=useId(),ticket=useRef(0);const [error,setError]=useState(''),[loaded,setLoaded]=useState('');
  useEffect(()=>()=>{ticket.current+=1;},[]);
  const title=schema.title || label(name);
  const importFile=async(input:HTMLInputElement)=>{
    const file=input.files?.[0];
    const current=++ticket.current;setError('');setLoaded('');if(!file){input.setCustomValidity('');return;}
    input.setCustomValidity('The selected file is still being read.');
    try {
      if(file.size>65536)throw new Error('Choose a file of 64 KB or less.');
      let parsed=JSON.parse(await file.text()) as NativeJson;
      if(manifest)parsed=manifestRows(parsed,schema);
      if(schema.type==='array' && !Array.isArray(parsed))throw new Error('This input needs a list.');
      if((schema.type==='object' || schema.properties) && !object(parsed))throw new Error('This input needs a source record.');
      if(new TextEncoder().encode(JSON.stringify(parsed)).length>65536)throw new Error('The imported input exceeds 64 KB.');
      if(current!==ticket.current)return;
      onChange(parsed);input.setCustomValidity('');setLoaded(file.name+(Array.isArray(parsed)?` · ${parsed.length} records`:''));
    } catch(problem) {if(current===ticket.current){const message=problem instanceof Error?problem.message:'The file could not be read.';input.setCustomValidity(message);setError(message);}}
  };
  const upload=<div style={{margin:'8px 0'}}><label htmlFor={id+'-file'}>{manifest?'Import release manifest':schema.type==='array'?'Import list':'Import source record'}</label>
    <input id={id+'-file'} type="file" accept=".json,application/json" disabled={disabled} style={{display:'block',maxWidth:'100%',marginTop:5}} onChange={event=>void importFile(event.currentTarget)}/>
    {loaded && <p role="status">{loaded}{manifest?' · comparison uses paths, hashes and supported sizes; deleted entries are omitted.':''}</p>}
    {error && <p role="alert" style={{color:'#ffaaa1'}}>{error}</p>}</div>;
  if(depth>5 || (!schema.type && !schema.properties) || (Array.isArray(schema.type)))return <fieldset style={{border:'1px solid #284956',margin:'8px 0'}} disabled={disabled}><legend>{title}</legend>{upload}<p>{value==null?'No source record loaded.':'Source record supplied. The capability validates it before use.'}</p></fieldset>;
  if(schema.enum?.length)return <label style={{display:'block',margin:'8px 0'}}>{title}<select style={field} disabled={disabled} value={JSON.stringify(value ?? schema.enum[0])} onChange={event=>onChange(JSON.parse(event.target.value))}>{schema.enum.map((item,index)=><option key={index} value={JSON.stringify(item)}>{String(item)}</option>)}</select></label>;
  if(schema.type==='array') {
    const rows=Array.isArray(value)?value:[],itemSchema=schema.items ?? {};
    return <fieldset style={{border:'1px solid #284956',margin:'12px 0',padding:10}} disabled={disabled}><legend>{title} · {rows.length} records</legend>
      {upload}{rows.slice(0,30).map((row,index)=><div key={index} style={{borderBottom:'1px solid #284956',paddingBottom:10,marginBottom:10}}>
        <ValueField name={'Record '+(index+1)} schema={itemSchema} value={row} disabled={disabled} depth={depth+1} onChange={next=>onChange(rows.map((old,at)=>at===index?next:old))}/>
        <button type="button" style={button} onClick={()=>onChange(rows.filter((_,at)=>at!==index))}>Remove record {index+1}</button>
      </div>)}
      {rows.length>30 && <p>Showing the first 30 records. All {rows.length} imported records are retained for the request.</p>}
      <button type="button" style={button} disabled={disabled || rows.length>=Math.min(schema.maxItems ?? 30,30)} onClick={()=>onChange([...rows,initial(itemSchema)])}>Add record to {title.toLowerCase()}</button>
    </fieldset>;
  }
  if(schema.type==='object' || schema.properties) {
    if(!schema.properties || !Object.keys(schema.properties).length)return <fieldset style={{border:'1px solid #284956',margin:'8px 0'}} disabled={disabled}><legend>{title}</legend>{upload}<p>{object(value)?'Source record loaded.':'Choose a supplied source record.'}</p></fieldset>;
    const record=object(value)?value:{};
    return <div>{Object.entries(schema.properties).map(([key,child])=>{
      const required=schema.required?.includes(key),present=owns(record,key);
      return <div key={key}>{!required && <label><input type="checkbox" checked={present} disabled={disabled} onChange={event=>{
        const next={...record};if(event.target.checked)next[key]=initial(child);else delete next[key];onChange(next);
      }}/> Include {label(key).toLowerCase()}</label>}
      {(required || present) && <ValueField name={key} schema={child} value={record[key]} depth={depth+1} disabled={disabled}
        manifest={manifest && (key==='before' || key==='after')} onChange={next=>onChange({...record,[key]:next})}/>}</div>;
    })}</div>;
  }
  if(schema.type==='boolean')return <label style={{display:'block',margin:'8px 0'}}><input type="checkbox" disabled={disabled} checked={value===true} onChange={event=>onChange(event.target.checked)}/> {title}</label>;
  const numeric=schema.type==='number' || schema.type==='integer';
  return <label style={{display:'block',margin:'8px 0'}} htmlFor={id}>{title}<input id={id} aria-label={title} style={field} disabled={disabled} type={numeric?'number':'text'}
    min={schema.minimum} max={schema.maximum} step={schema.type==='integer'?1:'any'} maxLength={schema.maxLength}
    value={typeof value==='string' || typeof value==='number'?value:''}
    onChange={event=>onChange(numeric && event.target.value!==''?Number(event.target.value):event.target.value)}/>
    {schema.description && <small>{schema.description}</small>}</label>;
}

export default function NativeCapabilityInputs({contracts,disabled,onRun}:{contracts:NativeContract[];disabled:boolean;onRun:(capability:string,arguments_:Record<string,NativeJson>)=>void}) {
  const [capability,setCapability]=useState(contracts[0]?.name ?? '');
  const contract=contracts.find(item=>item.name===capability) ?? contracts[0];
  const [values,setValues]=useState<NativeJson>(()=>contract?initial(contract.inputSchema):{});
  if(!contract)return null;
  return <form onSubmit={event=>{event.preventDefault();if(object(values))onRun(contract.name,values);}} style={{marginTop:16,borderTop:'1px solid #284956',paddingTop:12}}>
    <h4 style={{margin:'0 0 8px'}}>Use your own inputs</h4>
    {contracts.length>1 && <label>Action<select style={field} disabled={disabled} value={contract.name} onChange={event=>{
      const next=contracts.find(item=>item.name===event.target.value)!;setCapability(next.name);setValues(initial(next.inputSchema));
    }}>{contracts.map(item=><option key={item.name} value={item.name}>{item.description || label(item.name.split('.').at(-1)!)}</option>)}</select></label>}
    <ValueField key={contract.name} name="Inputs" schema={contract.inputSchema} value={values} onChange={setValues} disabled={disabled} manifest={contract.name==='release-inventory.diff'}/>
    <button type="submit" style={button} disabled={disabled || !object(values)}>Run with these inputs</button>
  </form>;
}
