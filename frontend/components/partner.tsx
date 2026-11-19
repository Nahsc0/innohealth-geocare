'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {FormEvent,useCallback,useEffect,useState} from 'react';
import {api, Facility, json, Point, setToken} from '@/lib/api';
import {AccessAnalysis,CommunityEditor} from './access';
import {AreaEditor,CoverageReport} from './coverage';
import {categoryEntries, errorText, Notice, PageHeading, statusNames} from './public';

const MapView=dynamic(()=>import('./map'),{ssr:false});
type User={id:string;email:string;role:string;org_id:string};
type Organisation={id:string;name:string;verified:number};
type PartnerUser=User&{active:number};
const areas=[
  {href:'/dispatch',label:'Dispatch',roles:['admin','dispatcher','responder']},
  {href:'/facility',label:'Facility dashboard',roles:['admin','clinician']},
  {href:'/referrals',label:'Maternal referrals',roles:['admin','clinician']},
  {href:'/analytics',label:'GIS analytics',roles:['admin','analyst']},
  {href:'/admin',label:'Administration',roles:['admin']},
];
const when=(value:number)=>new Date(value*1000).toLocaleString();
function PartnerLinks({user}:{user:User}){
  return <nav className="toolbar" aria-label="Partner workspaces">{areas.filter(a=>a.roles.includes(user.role)).map(a=><Link className="button outline small" key={a.href} href={a.href}>{a.label}</Link>)}</nav>;
}
export function Login(){
  const router=useRouter();
  const [user,setUser]=useState<User>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{api<User>('/me').then(setUser).catch(()=>{});},[]);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');
    const form=new FormData(e.currentTarget);
    try{
      const result=await api<{token:string;role:string}>('/login',json({email:form.get('email'),password:form.get('password')}));
      setToken(result.token);
      router.push(areas.find(a=>a.roles.includes(result.role))?.href||'/partner');
    }catch(err){setError(errorText(err));}
    finally{setBusy(false);}
  }
  return <div className="wrap page"><PageHeading title="Partner login" detail="Sign in with a verified sandbox partner account."/>
    {user?<div className="card stack">Signed in as {user.email}<PartnerLinks user={user}/></div>:<form className="card narrow stack" onSubmit={submit}>
      <label>Email<input autoComplete="username" type="email" name="email" required maxLength={254}/></label><label>Password<input type="password" name="password" autoComplete="current-password" required maxLength={256}/></label>
      <button className="button primary" disabled={busy}>{busy?'Signing in…':'Sign in'}</button><Notice error text={error}/>
    </form>}</div>;
}
export function Workspace(){
  const path=usePathname().replace(/\/$/, '') || '/';
  const router=useRouter();
  const [user,setUser]=useState<User>(),[error,setError]=useState(''),[checking,setChecking]=useState(true);
  const area=areas.find(a=>a.href===path);
  useEffect(()=>{api<User>('/me').then(setUser).catch(e=>setError(errorText(e))).finally(()=>setChecking(false));},[]);
  async function logout(){
    try{await api('/logout',{method:'POST'});setToken('');router.push('/partner');}
    catch(e){setError(errorText(e));}
  }
  return <div className="wrap page"><PageHeading title={area?.label||'Partner workspace'} detail="Sandbox workspace for authorised partners. Use synthetic patient details only."/>
    {checking&&<Notice text="Checking your session…"/>}
    {!checking&&!user&&<><Notice error text={error}/><Link className="button primary" href="/partner">Go to partner login</Link></>}
    {user&&<><div className="toolbar"><span>{user.email} · {user.role}</span><button className="button outline small" onClick={logout}>Sign out</button></div><PartnerLinks user={user}/>
      <Notice error text={error}/>
      {!area?.roles.includes(user.role)?<Notice error text="Your account does not have access to this workspace."/>:
        path==='/dispatch'?<Dispatch user={user}/>:path==='/referrals'?<Referrals user={user}/>:path==='/analytics'?<Analytics/>:path==='/admin'?<Admin/>:<FacilityDashboard/>}
    </>}
  </div>;
}

type Incident={id:string;category:string;status:string;created:number;updated:number;escalated:number;label:string|null;location:{point:Point|null;postcode:string|null;landmark:string|null;callback:string|null}|null};
type Vehicle={id:string;label:string;responder_id:string;available:number};
const next:Record<string,string>={submitted:'awaiting_acknowledgement',awaiting_acknowledgement:'acknowledged',acknowledged:'assigned',assigned:'en_route',en_route:'arrived',arrived:'completed'};
type Message={author:string;created:number;message:string};
function Dispatch({user}:{user:User}){
  const dispatch=user.role!=='responder';
  const [incidents,setIncidents]=useState<Incident[]>([]),[vehicles,setVehicles]=useState<Vehicle[]>([]);
  const [selected,setSelected]=useState(''),[vehicle,setVehicle]=useState(''),[messages,setMessages]=useState<Message[]>([]);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[showMap,setMap]=useState(false);
  const [fleetEdit,setFleetEdit]=useState<Vehicle>();
  const item=incidents.find(i=>i.id===selected);
  const refresh=useCallback(async()=>{
    const [queue,fleet]=await Promise.all([api<Incident[]>('/ops/incidents'),dispatch?api<Vehicle[]>('/ops/ambulances'):Promise.resolve([])]);
    setIncidents(queue);setVehicles(fleet);
  },[dispatch]);
  useEffect(()=>{refresh().catch(e=>setError(errorText(e)));},[refresh]);
  useEffect(()=>{
    setVehicle('');setMessages([]);
    if(!selected||!item?.label)return;
    let cancelled=false;
    api<Message[]>('/ops/incidents/'+selected+'/messages').then(items=>{if(!cancelled)setMessages(items);}).catch(e=>{if(!cancelled)setError(errorText(e));});
    return ()=>{cancelled=true;};
  },[selected,item?.label]);
  async function act(action:()=>Promise<unknown>){
    setBusy(true);setError('');
    try{await action();await refresh();}
    catch(e){setError(errorText(e));}
    finally{setBusy(false);}
  }
  function change(status:string){return act(()=>api('/ops/incidents/'+selected,json({status,ambulance_id:status==='assigned'?vehicle:null},'PATCH')));}
  return <div className="stack"><Notice error text={error}/><div className="layout">
    <section className="card stack"><h2>Incoming incidents</h2><button className="button outline" disabled={busy} onClick={()=>act(async()=>{})}>Refresh queue</button>
    {incidents.length===0&&<p>No sandbox incidents in this queue.</p>}
    {incidents.map(record=><button className={'button '+(record.id===selected?'primary':'outline')} type="button" key={record.id} onClick={()=>setSelected(record.id)}>
      {record.category} · {statusNames[record.status]?.[0]} {record.escalated?' · Escalated':''}</button>)}
    </section><section className="card stack"><h2>Sandbox incident detail</h2>
      {item?<><p className="break">{item.id}</p><p>Submitted {when(item.created)} · Updated {when(item.updated)}</p>
        <p>Elapsed to last update · {Math.max(0,item.updated-item.created)} s</p>
        {item.location&&<><p>{item.location.postcode||'No postcode'} · {item.location.landmark||'No landmark'}</p><p>{item.location.callback||'No callback'}</p>{item.location.point&&<p>{item.location.point.lat}, {item.location.point.lon}</p>}</>}
        {item.label&&<p>Sandbox unit · {item.label}</p>}
        {dispatch&&item.status==='acknowledged'&&<label>Available sandbox ambulance<select value={vehicle} onChange={e=>setVehicle(e.target.value)}><option value="">Choose a unit</option>{vehicles.filter(v=>v.available).map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>}
        <div className="toolbar">
        {next[item.status]&&(dispatch||['assigned','en_route','arrived'].includes(item.status))&&<button className="button primary" disabled={busy||(item.status==='acknowledged'&&!vehicle)} onClick={()=>change(next[item.status])}>{statusNames[next[item.status]]?.[0]}</button>}
        {dispatch&&next[item.status]&&<button className="button outline" disabled={busy} onClick={()=>change('cancelled')}>Cancel simulation</button>}
        {dispatch&&next[item.status]&&!item.escalated&&<button className="button emergency" disabled={busy} onClick={()=>act(()=>api('/ops/incidents/'+selected+'/escalate',{method:'POST'}))}>Flag for supervisor review</button>}</div>
        {item.label&&<form className="stack" onSubmit={e=>{
          e.preventDefault();const form=e.currentTarget;const data=new FormData(form);
          act(async()=>{await api('/ops/incidents/'+selected+'/messages',json({message:data.get('message')}));setMessages(await api<Message[]>('/ops/incidents/'+selected+'/messages'));form.reset();});
        }}>
          <h3>Sandbox team messages</h3>
          <button className="button outline" type="button" disabled={busy} onClick={()=>act(async()=>setMessages(await api<Message[]>('/ops/incidents/'+selected+'/messages')))}>Refresh messages</button>
          {messages.map((m,i)=><p className="record" key={m.created+'-'+i}>{m.message} · {when(m.created)}</p>)}
          <label>Synthetic message<input name="message" required maxLength={500}/></label><button className="button outline" disabled={busy}>Send sandbox message</button>
        </form>}
      </>:<p>Select an incident to review it.</p>}
      <button className="button outline" onClick={()=>setMap(v=>!v)}>Toggle incident map</button>
      {showMap&&<MapView point={item?.location?.point} markers={incidents.flatMap(i=>i.location?.point?[i.location.point]:[])}/>}
    </section></div>
    {dispatch&&<section className="card stack"><h2>Sandbox ambulance availability</h2>
      {vehicles.map(v=><button className="button outline" key={v.id} onClick={()=>setFleetEdit(v)}>{v.label} · {v.available?'Available':'Unavailable'}</button>)}
      <button className="button outline" onClick={()=>setFleetEdit(undefined)}>Add another ambulance</button>
      <form key={fleetEdit?.id||'new'} className="stack" onSubmit={e=>{
        e.preventDefault();const form=new FormData(e.currentTarget);
        act(()=>api('/ops/ambulances/'+encodeURIComponent(String(form.get('id'))),json({label:form.get('label'),responder_id:form.get('responder_id'),available:form.has('available')})));
      }}>
      <div className="form-row"><label>Ambulance ID<input name="id" maxLength={64} required defaultValue={fleetEdit?.id} readOnly={!!fleetEdit}/></label><label>Unit label<input name="label" maxLength={100} required defaultValue={fleetEdit?.label}/></label></div>
      <label>Responder account ID<input name="responder_id" maxLength={64} required defaultValue={fleetEdit?.responder_id}/></label>
      <label className="check"><input type="checkbox" name="available" defaultChecked={!fleetEdit||!!fleetEdit.available}/>Available</label><button className="button primary" disabled={busy}>Save sandbox ambulance</button>
      </form></section>}
  </div>;
}

type Referral={id:string;sender:string;receiver:string;facility_id:string;status:string;created:number;updated:number;details:{patient_reference:string;reason:string;basis:string}|null};
function Referrals({user}:{user:User}){
  const [items,setItems]=useState<Referral[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [targets,setTargets]=useState<Pick<Facility,'id'|'name'|'lga'|'services'>[]>([]);
  useEffect(()=>{if(user.role==='clinician')api<Pick<Facility,'id'|'name'|'lga'|'services'>[]>('/referral-destinations').then(setTargets).catch(e=>setError(errorText(e)));},[user.role]);
  const refresh=()=>api<Referral[]>('/referrals').then(setItems);
  useEffect(()=>{refresh().catch(e=>setError(errorText(e)));},[]);
  async function act(action:()=>Promise<unknown>){
    setBusy(true);setError('');
    try{await action();await refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  return <div className="layout">
    {user.role==='clinician'&&<form className="card stack" onSubmit={e=>{
      e.preventDefault();const target=e.currentTarget;const data=new FormData(target);
      act(async()=>{await api('/referrals',json({...Object.fromEntries(data),synthetic:data.has('synthetic')}));target.reset();});
    }}><h2>Start a maternal referral</h2><p>Confirm the receiving facility through your authorised team.</p>
      <label>Verified receiving facility<select name="facility_id" required><option value="">Choose a facility</option>{targets.map(f=><option key={f.id} value={f.id}>{f.name} · {f.lga}{f.services?" · "+f.services:""}</option>)}</select></label>
      <label>Synthetic patient reference<input name="patient_reference" required maxLength={80}/></label>
      <label>Synthetic referral reason<textarea name="reason" required maxLength={500}/></label>
      <label>Recorded basis<select name="basis"><option value="consent">Consent</option><option value="documented_other_basis">Other documented basis</option></select></label>
      <label className="check"><input name="synthetic" type="checkbox" required/>All patient details are synthetic.</label><button className="button primary" disabled={busy}>Request acknowledgement</button>
    </form>}
    <section className="card stack"><h2>Referral progress</h2><button className="button outline" disabled={busy} onClick={()=>act(async()=>{})}>Refresh referrals</button>
      <Notice error text={error}/>{items.length===0&&<p>No referrals in this workspace.</p>}
      {items.map(item=>{
        const next:Record<string,string>={requested:'acknowledged',acknowledged:'handed_over',handed_over:'completed'};
        const step=user.role==='clinician'&&(item.receiver===user.org_id?next[item.status]:item.sender===user.org_id&&item.status==='requested'?'cancelled':'');
        return <article key={item.id} className="record"><strong>{item.status.replaceAll('_',' ')} · {item.facility_id}</strong><p>{item.id}</p><p>{when(item.created)}</p>
          {item.details&&<p>{item.details.patient_reference} · {item.details.reason} · {item.details.basis.replaceAll('_',' ')}</p>}
          {step&&<button className="button outline" disabled={busy} onClick={()=>act(()=>api('/referrals/'+item.id,json({status:step},'PATCH')))}>{({acknowledged:'Acknowledge',handed_over:'Confirm handover',completed:'Complete referral',cancelled:'Cancel referral'})[step]}</button>}
        </article>;
      })}
    </section></div>;
}
function FacilityDashboard(){
  const [items,setItems]=useState<Referral[]>([]),[error,setError]=useState('');
  useEffect(()=>{api<Referral[]>('/referrals').then(setItems).catch(e=>setError(errorText(e)));},[]);
  return <section className="card narrow stack"><h2>Referral activity</h2><Notice error text={error}/>
    {['requested','acknowledged','handed_over','completed','cancelled'].map(status=><div className="record" key={status}><strong>{status.replaceAll('_',' ')}</strong>{items.filter(i=>i.status===status).length}</div>)}
    <Link href="/referrals" className="button primary">Open maternal referrals</Link>
  </section>;
}

type Cell={dataset:string;area:string;label:string;total:number};
function Analytics(){
  const [cells,setCells]=useState<Cell[]>([]),[facilities,setFacilities]=useState<Facility[]>([]);
  const [map,setMap]=useState(false),[error,setError]=useState('');
  useEffect(()=>{api<{cells:Cell[]}>('/analytics').then(result=>setCells(result.cells)).catch(e=>setError(errorText(e)));},[]);
  async function download(){
    try{
      const file=await api<string>('/analytics/export');
      const url=URL.createObjectURL(new Blob([file],{type:'text/csv'}));
      const element=document.createElement('a');element.href=url;element.download='geocare-aggregates.csv';element.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError(errorText(e));}
  }
  const maximum=Math.max(1,...cells.map(c=>c.total));
  return <div className="stack"><div className="layout"><section className="card stack"><h2>Published facility distribution</h2>
    <button className="button outline" onClick={async()=>{
      if(map){setMap(false);return;}
      try{setFacilities(await api('/facilities'));setMap(true);}catch(e){setError(errorText(e));}
    }}>{map?'Hide map':'Load Kaduna facility map'}</button>
    {map&&<MapView markers={facilities.flatMap(f=>f.lat===null||f.lon===null?[]:[{lat:f.lat,lon:f.lon}])}/>}
    <Notice error text={error}/>
  </section><section className="card stack"><h2>Aggregate counts</h2><p>Groups with fewer than five records are suppressed. Patient locations are excluded.</p>
    <button className="button primary" onClick={download}>Download aggregate CSV</button>
    {cells.length===0&&<p>No reportable groups.</p>}
    {cells.map(c=><label key={c.dataset+'|'+c.area+'|'+c.label}>{c.dataset} · {c.area} · {c.label} · {c.total}<meter className="bar" max={maximum} value={c.total}/></label>)}
  </section></div><AccessAnalysis/><CoverageReport/></div>;
}

type Draft=Omit<Facility,'verified_at'>&{verified_at:string|null;org_id:string|null};
type Audit={id:string;action:string;entity:string;created:number;actor:string|null};
function Admin(){
  const [orgs,setOrgs]=useState<Organisation[]>([]),[users,setUsers]=useState<PartnerUser[]>([]),[drafts,setDrafts]=useState<Draft[]>([]);
  const [audit,setAudit]=useState<Audit[]>([]),[days,setDays]=useState(30),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [orgEdit,setOrgEdit]=useState<Organisation>(),[draft,setDraft]=useState<Draft>();
  const refresh=useCallback(async()=>{
    const [o,u,f,a,s]=await Promise.all([api<Organisation[]>('/admin/organisations'),api<PartnerUser[]>('/admin/users'),api<Draft[]>('/admin/facilities'),api<Audit[]>('/admin/audit'),api<{retention_days:number}>('/admin/settings')]);
    setOrgs(o);setUsers(u);setDrafts(f);setAudit(a);setDays(s.retention_days);
  },[]);
  useEffect(()=>{refresh().catch(e=>setError(errorText(e)));},[refresh]);
  async function save(action:()=>Promise<unknown>){
    setBusy(true);setError('');setNotice('');
    try{await action();setNotice('Saved.');await refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  return <div className="stack"><Notice error text={error}/><Notice text={notice}/>
    <div className="layout"><section className="card stack"><h2>Partner organisations</h2>
      {orgs.map(o=><button className="button outline" key={o.id} onClick={()=>setOrgEdit(o)}>{o.name} · {o.verified?'Sandbox verified':'Pending'}</button>)}
      <button className="button outline" onClick={()=>setOrgEdit(undefined)}>New organisation</button>
      <form key={orgEdit?.id||'new'} className="stack" onSubmit={e=>{
        e.preventDefault();const form=e.currentTarget;const data=new FormData(form);
        save(async()=>{await api('/admin/organisations'+(orgEdit?'/'+orgEdit.id:''),json({name:data.get('name'),verified:data.has('verified')},orgEdit?'PATCH':'POST'));if(!orgEdit)form.reset();});
      }}><label>Organisation name<input name="name" required maxLength={200} defaultValue={orgEdit?.name}/></label>
      <label className="check"><input name="verified" type="checkbox" defaultChecked={!!orgEdit?.verified}/>Verified for sandbox access</label>
      <button disabled={busy} className="button primary">Save organisation</button></form>
    </section><section className="card stack"><h2>User management</h2>
      {users.map(u=><article className="record" key={u.id}><strong>{u.email} · {u.role}</strong><span>{u.id}</span><button className="button outline small" disabled={busy} onClick={()=>save(()=>api('/admin/users/'+u.id,json({active:!u.active},'PATCH')))}>{u.active?'Deactivate':'Reactivate'}</button></article>)}
      <form className="stack" onSubmit={e=>{
        e.preventDefault();const form=e.currentTarget;const data=new FormData(form);
        save(async()=>{await api('/admin/users',json(Object.fromEntries(data)));form.reset();});
      }}><label>Email<input type="email" name="email" required maxLength={254}/></label><label>Initial password<input type="password" name="password" minLength={14} maxLength={256} autoComplete="new-password" required/></label>
      <label>Partner role<select name="role">{['clinician','dispatcher','responder','analyst','admin'].map(r=><option key={r}>{r}</option>)}</select></label>
      <label>Organisation<select name="org_id" required><option value="">Select organisation</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <button className="button primary" disabled={busy}>Create account</button></form>
    </section></div>
    <section className="card stack"><h2>Facility verification</h2><p>Use authorised source records. Leave the verification date empty to save a draft or unpublish a listing.</p>
      {drafts.map(f=><button className="button outline" key={f.id} onClick={()=>setDraft(f)}>{f.name} · {f.verified_at||'Draft'}</button>)}
      <button className="button outline" onClick={()=>setDraft(undefined)}>New facility</button>
      <form key={draft?.id||'new'} className="stack" onSubmit={e=>{
        e.preventDefault();const data=new FormData(e.currentTarget);
        const body=Object.fromEntries(Array.from(data,([k,v])=>[k,v||null]));
        save(()=>api('/admin/facilities/'+encodeURIComponent(String(body.id)),json(body)));
      }}>
        <div className="form-row"><label>Registry facility ID<input name="id" required maxLength={64} defaultValue={draft?.id} readOnly={!!draft}/></label><label>Facility name<input name="name" required maxLength={200} defaultValue={draft?.name}/></label></div>
        <div className="form-row">{(['state','lga','ward','postcode','lat','lon','ownership','services','hours','phone'] as const).map(k=><label key={k}>{({lga:'LGA',lat:'Latitude',lon:'Longitude'})[k as 'lga']||k[0].toUpperCase()+k.slice(1)}<input name={k} defaultValue={draft?.[k]??(k==='state'?'Kaduna':'')} required={k==='state'||k==='lga'}/></label>)}</div>
        <label>Category<select name="category" defaultValue={draft?.category}>{categoryEntries.map(([k,v])=><option key={k} value={k}>{v[0]}</option>)}</select></label>
        <label>Source URL<input required type="url" name="source" defaultValue={draft?.source}/></label>
        <label>Verification date<input type="date" name="verified_at" defaultValue={draft?.verified_at||''}/></label>
        <label>Receiving organisation<select name="org_id" defaultValue={draft?.org_id||''}><option value="">None</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <button className="button primary" disabled={busy}>Save facility record</button>
      </form>
    </section>
    <CommunityEditor/><AreaEditor/><RequestMetrics/>
    <div className="layout"><form className="card stack" onSubmit={e=>{e.preventDefault();save(()=>api('/admin/settings',json({retention_days:days},'PATCH')));}}><h2>Retention</h2><label>Sensitive case details (days)<input type="number" min={1} max={365} required value={days} onChange={e=>setDays(+e.target.value)}/></label><button className="button primary" disabled={busy}>Save retention</button><p>Live dispatch is disabled.</p></form>
    <section className="card stack"><h2>Audit log</h2><button className="button outline" onClick={()=>refresh().catch(e=>setError(errorText(e)))}>Refresh administration data</button>
      {audit.map(a=><div className="record" key={a.id}><strong>{a.action}</strong><span>{a.entity} · {when(a.created)}</span><span>{a.actor||'Public simulation'}</span></div>)}</section></div>
  </div>;
}


function RequestMetrics(){
  const [counts,setCounts]=useState<Record<string,number>>();
  const [error,setError]=useState('');
  return <section className="card stack"><h2>API monitoring</h2><p>HTTP status totals for the API process serving this request.</p>
    <button className="button outline" onClick={async()=>{
      setError('');
      try{setCounts((await api<{process_http_status_counts:Record<string,number>}>('/admin/monitoring')).process_http_status_counts);}
      catch(e){setError(errorText(e));}
    }}>Read API status totals</button>
    {counts&&<p role="status">{Object.entries(counts).sort().map(([status,total])=>status+' · '+total).join(' / ')}</p>}
    <Notice error text={error}/>
  </section>;
}