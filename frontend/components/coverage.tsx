'use client';
import {FormEvent,useState} from 'react';
import {api,json} from '@/lib/api';
import {errorText,Notice} from './public';

type Area={id:string;lga:string;population:number;area_km2:number;facility_count:number;phc_count:number;facilities_per_100_km2:number;phcs_per_10000_people:number};
type Timing={stage:string;total:number;mean_seconds:number};
type Coverage={areas:Area[];timings:Timing[]};

export function CoverageReport(){
  const [result,setResult]=useState<Coverage>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [state,setState]=useState('Kaduna');
  async function run(e:FormEvent){
    e.preventDefault();setError('');setBusy(true);setResult(undefined);
    try{setResult(await api<Coverage>('/analytics/coverage?state='+encodeURIComponent(state.trim())));}
    catch(err){setError(errorText(err));}finally{setBusy(false);}
  }
  async function download(){
    setError('');
    try {
      const csv=await api<string>('/analytics/coverage/export?state='+encodeURIComponent(state.trim()));
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
      const link=document.createElement('a');
      link.href=url;link.download='geocare-lga-coverage.csv';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(err){setError(errorText(err));}
  }
  const max=Math.max(1,...(result?.areas.map(a=>a.phcs_per_10000_people)||[]));
  return <section className="card stack"><h2>LGA coverage and sandbox performance</h2>
    <p>Compare published facility counts using verified population and area profiles. Coverage depends on the completeness of the directory and denominator data.</p>
    <form className="toolbar" onSubmit={run}><label>State<input value={state} maxLength={80} required onChange={e=>{setState(e.target.value);setResult(undefined);}} disabled={busy}/></label>
      <button className="button primary" disabled={busy}>Load coverage</button></form>
    <Notice text={error} error/>
    {result&&<><h3>Facility density</h3>
      {result.areas.length===0?<p>No verified LGA profiles for this state.</p>:<button className="button outline" onClick={download}>Download LGA coverage CSV</button>}
      {result.areas.map(a=><div className="record" key={a.id}><strong>{a.lga}</strong>
        <span>{a.facility_count} listed facilities · {a.facilities_per_100_km2} per 100 km²</span>
        <label>{a.phc_count} listed PHCs · {a.phcs_per_10000_people} per 10,000 people<meter className="bar" min={0} max={max} value={a.phcs_per_10000_people}/></label>
      </div>)}
      <h3>Mean time from sandbox submission</h3>
      {result.timings.length===0&&<p>No stages with five or more records.</p>}
      {result.timings.map(t=><p key={t.stage}>{t.stage.replace('.',' · ').replaceAll('_',' ')} · {(t.mean_seconds/60).toFixed(1)} min · {t.total} records</p>)}
    </>}
  </section>;
}

export function AreaEditor(){
  const [note,setNote]=useState(''),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  async function save(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setNote('');setError(false);setBusy(true);
    const data=Object.fromEntries(new FormData(e.currentTarget));
    try{await api('/admin/areas/'+encodeURIComponent(String(data.id)),json(data));setNote('LGA profile saved.');}
    catch(err){setError(true);setNote(errorText(err));}finally{setBusy(false);}
  }
  return <form className="card stack" onSubmit={save}><h2>Verified LGA coverage inputs</h2>
    <div className="form-row"><label>Profile ID<input name="id" required maxLength={64}/></label>
      <label>State<input name="state" defaultValue="Kaduna" required maxLength={80}/></label>
      <label>LGA<input name="lga" required maxLength={80}/></label>
      <label>Population<input name="population" type="number" min="1" step="1" required/></label>
      <label>Area in km²<input name="area_km2" type="number" min=".001" step="any" required/></label>
      <label>Verification date<input name="verified_at" type="date" required/></label></div>
    <label>Source URL<input name="source" type="url" required/></label>
    <button className="button primary" disabled={busy}>Save verified LGA profile</button>
    <Notice text={note} error={error}/>
  </form>;
}
