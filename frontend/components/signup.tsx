'use client';
import Link from 'next/link';
import {FormEvent,useEffect,useState} from 'react';
import {api,json} from '@/lib/api';
import {errorText,Notice,PageHeading} from './public';

export function PartnerSignup(){
  const [activation,setActivation]=useState(false),[busy,setBusy]=useState(false);
  const [notice,setNotice]=useState(''),[error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setNotice('');setError('');
    const form=event.currentTarget;
    try{
      const result=await api<{message:string}>(activation?'/partner/activate':'/partner/signup',json(Object.fromEntries(new FormData(form))));
      setNotice(result.message);form.reset();
    }catch(err){setError(errorText(err));}
    finally{setBusy(false);}
  }
  return <div className="wrap page"><PageHeading title="Partner signup" detail="Request access to the GeoCare partner sandbox."/>
    <div className="toolbar">
      <button className="button outline" disabled={busy} onClick={()=>{setActivation(!activation);setNotice('');setError('');}}>{activation?'Request partner access':'I have an activation code'}</button>
      <Link className="button outline" href="/partner">Back to sign in</Link>
    </div>
    <form className="card narrow stack" key={String(activation)} onSubmit={submit}>
      {activation?<><label>Activation code<input name="code" required maxLength={43} autoComplete="off"/></label>
      <label>New password<input name="password" type="password" required minLength={14} maxLength={256} autoComplete="new-password"/></label></>:
      <><p>An administrator reviews your organisation and sends a single-use code through a verified contact channel.</p>
      <label>Work email<input name="email" type="email" required maxLength={254} autoComplete="email"/></label>
      <label>Organisation<input name="organisation" required minLength={2} maxLength={200} autoComplete="organization"/></label></>}
      <button className="button primary" disabled={busy}>{busy?'Submitting…':activation?'Activate account':'Request access'}</button>
      <Notice text={notice}/><Notice error text={error}/>
    </form></div>;
}

type Application={id:string;email:string;organisation:string;status:string};
export function Applications({organisations}:{organisations:{id:string;name:string;verified:number}[]}){
  const [requests,setRequests]=useState<Application[]>([]),[error,setError]=useState('');
  const [issued,setIssued]=useState<{email:string;code:string}>(),[busy,setBusy]=useState(false);
  async function load(){setRequests(await api<Application[]>('/admin/partner-applications'));}
  useEffect(()=>{load().catch(e=>setError(errorText(e)));},[]);
  async function approve(event:FormEvent<HTMLFormElement>,request:Application){
    event.preventDefault();setBusy(true);setError('');setIssued(undefined);
    try{
      const result=await api<{activation_code:string}>('/admin/partner-applications/'+request.id+'/approve',json(Object.fromEntries(new FormData(event.currentTarget))));
      setIssued({email:request.email,code:result.activation_code});await load();
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  return <section className="card stack"><h2>Partner signup requests</h2>
    <p>Verify the applicant through a trusted organisational contact before sharing an activation code.</p>
    <Notice error text={error}/>
    {issued&&<div className="notice">Single-use code for {issued.email} (expires in 24 hours). <code className="break">{issued.code}</code></div>}
    {requests.length===0&&<p>No requests awaiting activation.</p>}
    {requests.map(request=><form className="record stack" key={request.id} onSubmit={event=>approve(event,request)}>
      <strong>{request.email}</strong><span>{request.organisation} · {request.status}</span>
      <label>Verified organisation<select name="org_id" required defaultValue=""><option value="" disabled>Choose organisation</option>{organisations.filter(o=>o.verified).map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></label>
      <label>Partner role<select name="role">{['clinician','dispatcher','responder','analyst'].map(role=><option key={role}>{role}</option>)}</select></label>
      <button className="button outline" disabled={busy}>{request.status==='approved'?'Reissue activation code':'Approve and issue code'}</button>
    </form>)}
  </section>;
}

export function SheetSnapshot({onImported}:{onImported:()=>Promise<void>}){
  const [notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setNotice('');setError('');
    const form=event.currentTarget;
    try{
      const csv=new FormData(form).get('csv');
      if(!(csv instanceof File)||csv.size===0||csv.size>500000)throw new Error('Choose a CSV file under 500 KB.');
      const result=await api<{imported:number}>('/admin/facility-snapshot',json({csv:await csv.text()}));
      setNotice('Imported '+result.imported+' facility records.');form.reset();await onImported();
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  return <form className="card stack" onSubmit={submit}>
    <h2>Google Sheets directory import</h2>
    <p>Download the Facilities tab as CSV. Import only authorised facility directory data.</p>
    <label>Facilities CSV<input type="file" name="csv" accept=".csv,text/csv" required/></label>
    <button className="button primary" disabled={busy}>{busy?'Importing…':'Import directory snapshot'}</button>
    <Notice text={notice}/><Notice error text={error}/>
  </form>;
}
