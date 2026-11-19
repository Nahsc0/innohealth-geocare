'use client';
import {FormEvent,useState} from 'react';
import {api,json} from '@/lib/api';
import {errorText,Notice} from './public';

type Community={id:string;name:string;lga:string;facility_id:string|null;facility:string|null;distance_km:number|null;beyond_threshold:boolean|null};
export function AccessAnalysis(){
  const [threshold,setThreshold]=useState(5),[loadedThreshold,setLoadedThreshold]=useState(5);
  const [communities,setCommunities]=useState<Community[]>([]),[estimates,setEstimates]=useState<Record<string,string>>({});
  const [error,setError]=useState(''),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[routing,setRouting]=useState('');
  async function load(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      const result=await api<{communities:Community[];threshold_km:number}>('/analytics/access?threshold_km='+threshold);
      setCommunities(result.communities);setLoadedThreshold(result.threshold_km);setEstimates({});setLoaded(true);
    }catch(err){setError(errorText(err));}finally{setBusy(false);}
  }
  async function route(item:Community){
    setRouting(item.id);
    let estimate='Road estimate unavailable';
    try{
      const result=await api<{km:number;minutes:number}>('/analytics/access/'+encodeURIComponent(item.id)+'/'+encodeURIComponent(item.facility_id!)+'/route',{method:'POST'});
      estimate=result.minutes+' min · '+result.km+' km by road';
    }catch(err){estimate=errorText(err);}
    finally{setEstimates(values=>({...values,[item.id]:estimate}));setRouting('');}
  }
  return <section className="card stack"><h2>Access to primary healthcare in Kaduna</h2>
    <p>Compare verified community centroids with the nearest verified PHC by straight-line distance. The threshold is a planning filter. Request a road estimate separately.</p>
    <form className="toolbar" onSubmit={load}>
      <label>Distance threshold (km)<input type="number" min=".1" max="100" step=".1" required value={threshold} onChange={e=>setThreshold(+e.target.value)}/></label>
      <button className="button primary" disabled={busy||!!routing}>Analyse PHC access</button>
    </form>
    <Notice text={error} error/>
    {loaded&&communities.length===0&&<Notice text="No verified community centroids have been added for Kaduna."/>}
    {loaded&&communities.length>0&&<p>{communities.filter(c=>c.beyond_threshold).length} of {communities.length} listed communities are beyond {loadedThreshold} km from the nearest mapped PHC.</p>}
    {communities.map(c=><article className="record" key={c.id}><strong>{c.name} · {c.lga}</strong>
      {c.distance_km===null?<span>No mapped PHC in the study area</span>:<span>{c.facility} · {c.distance_km.toFixed(1)} km straight-line {c.beyond_threshold?' · Beyond threshold':''}</span>}
      {c.facility_id&&<button className="button outline small" disabled={!!routing||busy} onClick={()=>route(c)}>Estimate road travel</button>}
      <Notice text={estimates[c.id]||''}/></article>)}
  </section>;
}
export function CommunityEditor(){
  const [message,setMessage]=useState(''),[failure,setFailure]=useState(false),[busy,setBusy]=useState(false);
  async function save(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setMessage('');setBusy(true);setFailure(false);
    const data=new FormData(e.currentTarget),values=Object.fromEntries(data);
    try{
      await api('/admin/communities/'+encodeURIComponent(String(values.id)),json({...values,population:values.population||null}));
      setMessage('Community saved.');
    }catch(err){setFailure(true);setMessage(errorText(err));}finally{setBusy(false);}
  }
  return <form className="card stack" onSubmit={save}><h2>Community accessibility data</h2>
    <p>Use an authorised population-centre dataset with public centroid coordinates.</p>
    <div className="form-row"><label>Source record ID<input name="id" maxLength={64} required/></label><label>Community name<input name="name" maxLength={120} required/></label>
      <label>State<input name="state" defaultValue="Kaduna" required/></label><label>LGA<input name="lga" required/></label>
      <label>Centroid latitude<input name="lat" type="number" min="-90" max="90" step="any" required/></label>
      <label>Centroid longitude<input name="lon" type="number" min="-180" max="180" step="any" required/></label>
      <label>Population (optional)<input name="population" type="number" min="0" step="1"/></label><label>Verification date<input name="verified_at" type="date" required/></label></div>
    <label>Source URL<input name="source" type="url" required/></label>
    <button className="button primary" disabled={busy}>Save verified community</button><Notice text={message} error={failure}/>
  </form>;
}
