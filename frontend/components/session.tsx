'use client';
import Link from 'next/link';
import {createContext, FormEvent, useContext, useEffect, useState} from 'react';
import {api, ApiError, json, savedToken, sessionExpired, setToken} from '@/lib/api';
import {errorText, Notice, PageHeading, states} from './public';
import {useLanguage} from './language';

export type User = {id:string; email:string; role:string; org_id:string};
type Session = {user?:User; checking:boolean; error:string; check:()=>Promise<void>;
  authenticate:(credentials:Record<string,FormDataEntryValue>,register:boolean)=>Promise<User>;
  logout:()=>Promise<void>};
const SessionContext = createContext<Session|null>(null);

export function SessionProvider({children}:{children:React.ReactNode}) {
  const [user,setUser]=useState<User>();
  const [checking,setChecking]=useState(true),[error,setError]=useState('');

  async function check(){
    setChecking(true);setError('');
    try{setUser(savedToken() ? await api<User>('/me') : undefined);}
    catch(err){if(!(err instanceof ApiError && err.status===401))setError(errorText(err));}
    finally{setChecking(false);}
  }

  useEffect(()=>{
    function expire(){setUser(undefined);}
    window.addEventListener(sessionExpired,expire);
    setToken(savedToken());
    void check();
    return ()=>window.removeEventListener(sessionExpired,expire);
  },[]);

  async function authenticate(credentials:Record<string,FormDataEntryValue>,register:boolean){
    const result=await api<{token:string}>(register?'/register':'/login',json(credentials));
    setToken(result.token);
    try{
      const account=await api<User>('/me');
      setUser(account);setError('');return account;
    }catch(err){setToken('');throw err;}
  }

  async function logout(){
    try{await api('/logout',{method:'POST'});}
    finally{setToken('');setUser(undefined);setError('');}
  }

  return <SessionContext.Provider value={{user,checking,error,check,authenticate,logout}}>{children}</SessionContext.Provider>;
}

export function useSession(){
  const session=useContext(SessionContext);
  if(!session)throw new Error('GeoCare session context is unavailable');
  return session;
}

export function AccountAccess({partner=false,onLogin}:{partner?:boolean;onLogin?:(user:User)=>void}) {
  const {t}=useLanguage();
  const {authenticate}=useSession();
  const [registration,setRegistration]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [email,setEmail]=useState(''),[challenge,setChallenge]=useState(''),[notice,setNotice]=useState('');
  const title=partner?t('Partner login','Shigar abokan aiki'):registration?t('Create an individual account','Ƙirƙiri asusun mutum'):t('Sign in to GeoCare','Shiga GeoCare');
  async function sendCode(recipient:string){
    const result=await api<{challenge:string}>('/register/code',json({email:recipient}));
    setEmail(recipient);setChallenge(result.challenge);
    setNotice(t('We sent a six-digit code. It expires in 10 minutes.','Mun aika lamba mai lambobi shida. Tana aiki na minti 10.'));
  }
  async function resend(){
    setBusy(true);setError('');setNotice('');
    try{await sendCode(email);}
    catch(err){setError(errorText(err));}
    finally{setBusy(false);}
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError('');
    const form=new FormData(event.currentTarget);
    try{
      const data=Object.fromEntries(form);
      if(registration&&!challenge){await sendCode(String(data.email).trim());return;}
      const user=await authenticate(registration?{...data,challenge}:data,registration);
      onLogin?.(user);
    }
    catch(err){setError(errorText(err));}
    finally{setBusy(false);}
  }
  return <div className="wrap page"><PageHeading title={title} detail={partner?'Sign in with an approved partner account.':t('Use your account to access facility search and other GeoCare tools.','Yi amfani da asusunka don binciken cibiyoyi da sauran kayan GeoCare.')}/>
    <form className="card narrow stack" key={String(registration)+Boolean(challenge)} onSubmit={submit}>
      <label>{t('Email','Imel')}<input autoComplete="username" type="email" name="email" required maxLength={254} defaultValue={registration?email:undefined} readOnly={registration&&Boolean(challenge)}/></label>
      {(!registration||challenge)&&<label>{t('Password','Kalmar sirri')}<input type="password" name="password" autoComplete={registration?'new-password':'current-password'} required minLength={registration?14:undefined} maxLength={256}/></label>}
      {registration&&challenge&&<>
        <p className="muted">{t('Use at least 14 characters for your password.','Yi amfani da aƙalla haruffa 14 don kalmar sirri.')}</p>
        <label>{t('Email verification code','Lambar tabbatar da imel')}<input name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6}/></label>
        <label>{t('Full name','Cikakken suna')}<input name="name" autoComplete="name" required minLength={2} maxLength={120}/></label>
        <div className="form-row">
          <label>{t('Age','Shekaru')}<input name="age" type="number" required min={0} max={120} step={1}/></label>
          <label>{t('Gender','Jinsi')}<select name="gender" required defaultValue=""><option value="" disabled>{t('Select gender','Zaɓi jinsi')}</option>
            <option value="female">{t('Woman','Mace')}</option><option value="male">{t('Man','Namiji')}</option><option value="nonbinary">{t('Non-binary','Jinsi ba na mace ko namiji kaɗai ba')}</option><option value="another_identity">{t('Another gender','Wani jinsi')}</option><option value="prefer_not_to_say">{t('Prefer not to say','Ban so in faɗa')}</option>
          </select></label>
        </div>
        <div className="form-row">
          <label>{t('State','Jiha')}<select name="state" autoComplete="address-level1" required defaultValue=""><option value="" disabled>{t('Select state','Zaɓi jiha')}</option>{[...states].sort().map(state=><option key={state}>{state}</option>)}</select></label>
          <label>{t('Local government area (LGA)','Ƙaramar hukuma (LGA)')}<input name="lga" autoComplete="address-level2" required minLength={2} maxLength={100}/></label>
        </div>
        <label>{t('Contact number','Lambar waya')}<input name="phone" type="tel" autoComplete="tel" required maxLength={25}/></label>
      </>}
      <Notice text={notice}/>
      <button className="button primary" disabled={busy}>{busy?t('Submitting…','Ana aikawa…'):registration?(challenge?t('Verify and create account','Tabbatar ka ƙirƙiri asusu'):t('Send email code','Aika lambar imel')):t('Sign in','Shiga')}</button>
      <Notice error text={error}/>
      {registration&&challenge&&<div className="toolbar"><button className="button outline" type="button" disabled={busy} onClick={()=>void resend()}>{t('Resend code','Sake aika lamba')}</button><button className="button ghost" type="button" disabled={busy} onClick={()=>{setChallenge('');setError('');setNotice('');}}>{t('Change email','Canja imel')}</button></div>}
      {!!registration&&<p className="muted"><Link href="/privacy">{t('Privacy notice','Bayanin sirri')}</Link></p>}
      {!partner&&<button className="button outline" type="button" disabled={busy} onClick={()=>{setRegistration(!registration);setChallenge('');setEmail('');setError('');setNotice('');}}>{registration?t('Back to sign in','Koma wurin shiga'):t('Create an individual account','Ƙirƙiri asusun mutum')}</button>}
      <Link className="button ghost" href="/partner/signup">{t('Create a partner account','Ƙirƙiri asusun abokin aiki')}</Link>
    </form></div>;
}
