'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {Crosshair, MapPin, Phone, Search} from 'lucide-react';
import {FormEvent,useEffect,useRef,useState} from 'react';
import {api,coordinates,demoMode,demoPostcode,Facility,json,Point} from '@/lib/api';
import {demoSatellitePoint} from '@/lib/google-maps';
import {GoogleSatellite} from './google-satellite';
import {useLanguage} from './language';

const MapView=dynamic(()=>import('./map'),{ssr:false,loading:()=> <p role="status">…</p>});
export const categories = {
  phc:['Primary healthcare centres','Cibiyoyin kiwon lafiya na farko'],
  general:['General hospitals','Asibitocin gama-gari'],
  specialist:['Specialist hospitals','Asibitocin ƙwararru'],
  maternity:['Maternity facilities','Cibiyoyin kula da masu juna biyu'],
  emergency:['Emergency departments','Sassan gaggawa'],
  pharmacy:['Pharmacies','Kantunan magani'],
  laboratory:['Laboratories','Dakunan gwaje-gwaje'],
};
export const states=['Kaduna','Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];
export const categoryEntries=Object.entries(categories);
export const statusNames:Record<string,[string,string]>={
  submitted:['Submitted','An aika'],
  awaiting_acknowledgement:['Awaiting acknowledgement','Ana jiran amincewa'],
  acknowledged:['Acknowledged','An karɓa'],
  assigned:['Assigned in sandbox','An ware a gwaji'],
  en_route:['En route in sandbox','Yana kan hanya a gwaji'],
  arrived:['Arrived in sandbox','Ya isa a gwaji'],
  completed:['Completed','An kammala'],
  cancelled:['Cancelled','An soke'],
};
export function errorText(error:unknown) {return error instanceof Error?error.message:'Request failed';}
export function Notice({text,error=false}:{text:string;error?:boolean}) {
  return text?<p role={error?'alert':'status'} className={error?'notice error':'notice'}>{text}</p>:null;
}
export function PageHeading({title,detail}:{title:string;detail:string}) {
  return <><h1>{title}</h1><p className="lead">{detail}</p></>;
}
function LocationFields({point,onPoint,allowGPS=true}:{point:Point|null;onPoint:(p:Point)=>void;allowGPS?:boolean}) {
  const {t}=useLanguage();
  const [error,setError]=useState(''), [locating,setLocating]=useState(false);
  const [lat,setLat]=useState(''),[lon,setLon]=useState('');
  useEffect(()=>{if(point){setLat(String(point.lat));setLon(String(point.lon));}},[point]);
  function gps(){
    const fallback=t('Location unavailable. Open the map or enter coordinates.','Ba a samu wurinka ba. Buɗe taswira ko shigar da lambobin wuri.');
    if(!navigator.geolocation){setError(fallback);return;}
    setLocating(true);setError('');
    navigator.geolocation.getCurrentPosition(({coords})=>{
      setLocating(false);onPoint({lat:+coords.latitude.toFixed(6),lon:+coords.longitude.toFixed(6)});
    },()=>{setLocating(false);setError(fallback);},{timeout:7000,maximumAge:30000});
  }
  return <div className="stack">
    {allowGPS&&<button className="button outline" type="button" onClick={gps} disabled={locating}><Crosshair size={17}/>{locating?t('Locating…','Ana gano wuri…'):t('Use my GPS location','Yi amfani da wurina na GPS')}</button>}
    <div className="form-row"><label>{t('Latitude','Latitude')}<input inputMode="decimal" value={lat} onChange={e=>setLat(e.target.value)}/></label><label>{t('Longitude','Longitude')}<input inputMode="decimal" value={lon} onChange={e=>setLon(e.target.value)}/></label></div>
    <button className="button outline" type="button" onClick={()=>{
      const entered=coordinates(lat,lon);
      if(entered){setError('');onPoint(entered);}
      else setError(t('Enter a valid latitude and longitude.','Shigar da ingantattun lambobin wuri.'));
    }}>{t('Use these coordinates','Yi amfani da waɗannan lambobi')}</button><Notice text={error} error/>
  </div>;
}
export function Finder(){
  const {t}=useLanguage();
  const [point,setPoint]=useState<Point|null>(null),[showMap,setShowMap]=useState(false);
  const [results,setResults]=useState<Facility[]>([]),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
  const [state,setState]=useState('Kaduna'),[category,setCategory]=useState(''),[term,setTerm]=useState('');
  const [code,setCode]=useState(''),[lookup,setLookup]=useState(''),[checking,setChecking]=useState(false),[failure,setFailure]=useState('');
  const searchVersion=useRef(0), lookupVersion=useRef(0);
  function clearResults(){
    searchVersion.current++;
    setResults([]);setLoaded(false);setBusy(false);setFailure('');
  }
  async function search(origin:Point|null, autoNearby=false, searchTerm=term, facilityType=category){
    const request=++searchVersion.current;
    setBusy(true);setFailure('');
    const params=new URLSearchParams({state:autoNearby?'':state,q:searchTerm});
    if(facilityType)params.set('category',facilityType);
    if(origin){params.set('lat',String(origin.lat));params.set('lon',String(origin.lon));}
    try{
      const matches=await api<Facility[]>('/facilities?'+params);
      if(request===searchVersion.current){setResults(matches);setLoaded(true);}
    }catch{
      if(request===searchVersion.current)setFailure(t('Directory unavailable. Check your connection and try again.','Ba a samu kundin ba. Duba haɗin intanet sannan ka sake gwadawa.'));
    }finally{if(request===searchVersion.current)setBusy(false);}
  }
  function selectPoint(origin:Point){
    lookupVersion.current++;setChecking(false);setLookup('');
    setPoint(origin);setState('');clearResults();void search(origin,true);
  }
  async function check(postcode:string, facilityType=category){
    const request=++lookupVersion.current;
    setChecking(true);setLookup('');setPoint(null);if(!state)setState('Kaduna');clearResults();
    try{
      const result=await api<{valid:boolean;source:string;location:Point|null}>('/postcodes/lookup',json({postcode}));
      if(request!==lookupVersion.current)return;
      if(result.location){
        setPoint(result.location);setState('');setTerm('');void search(result.location,true,'',facilityType);
        setLookup(result.source==='local_mock'
          ? t('Local mock postcode matched. Demo coordinates selected.','An samu lambar gwaji. An zaɓi wurin gwaji.')
          : t('Postcode matched a directory location. Nearby facilities are ordered by distance.','An samu wurin lambar gidan waya. An tsara cibiyoyi bisa nisa.'));
      }else{
        setLookup(result.valid
          ? t('Postcode recognised. Use GPS, the map or coordinates to find nearby facilities.','An gane lambar. Yi amfani da GPS ko taswira don ganin cibiyoyin da ke kusa.')
          : t('Postcode location unavailable. Use GPS, the map or coordinates.','Ba a gano wuri ba. Yi amfani da GPS ko taswira.'));
      }
    }catch{
      if(request===lookupVersion.current)setLookup(t('Could not verify the postcode. Check the format or use GPS or the map.','An kasa tabbatar da lambar. Duba tsarin lambar ko amfani da GPS ko taswira.'));
    }finally{if(request===lookupVersion.current)setChecking(false);}
  }
  return <div className="wrap page">
    <PageHeading title={t('Find healthcare','Nemo cibiyar lafiya')} detail={demoMode?t('Try the Kaduna sample postcode to see nearby demo facilities.','Gwada lambar gidan waya ta Kaduna don ganin cibiyoyin misali da ke kusa.'):t('Search verified directory entries by name, local government area or distance.','Nemi cibiyoyin da aka tabbatar da su ta suna, ƙaramar hukuma ko nisa.')}/>
    <div className="layout"><section className="card stack"><h2>{t('Choose a location','Zaɓi wuri')}</h2>
      <form className="stack" onSubmit={e=>{e.preventDefault();void check(code);}}><label>{t('Digital postcode','Lambar gidan waya ta dijital')}<input value={code} maxLength={32} onChange={e=>{lookupVersion.current++;setChecking(false);setCode(e.target.value);setPoint(null);if(!state)setState('Kaduna');setLookup('');clearResults();}} placeholder="AA-01-A01-AA-01"/></label>
      <button className="button outline" type="submit" disabled={!code.trim()||checking}>{checking?t('Checking…','Ana dubawa…'):t('Check postcode and find nearby','Duba lambar gidan waya ka nemo na kusa')}</button>
      </form>{demoMode&&<button className="button ghost" type="button" disabled={checking} onClick={()=>{setCode(demoPostcode);setCategory('');void check(demoPostcode,'');}}>{t('Use sample postcode','Yi amfani da lambar gwaji')} · {demoPostcode}</button>}
      <Notice text={lookup}/><LocationFields point={point} onPoint={selectPoint}/>
      <button className="button outline" type="button" onClick={()=>setShowMap(v=>!v)}><MapPin size={17}/>{showMap?t('Hide map','Ɓoye taswira'):demoMode?t('Show satellite map','Nuna hoton tauraron ɗan adam'):t('Open map to select a point','Buɗe taswira don zaɓar wuri')}</button>
      {point&&<button className="button ghost" onClick={()=>{setPoint(null);if(!state)setState('Kaduna');setLookup('');clearResults();}}>{t('Clear selected location','Cire wurin da aka zaɓa')}</button>}
    </section><section className="card stack">
      {showMap&&(demoMode?<GoogleSatellite point={demoSatellitePoint(point)} demo/>:
        <MapView point={point} markers={results.flatMap(f=>f.lat===null||f.lon===null?[]:[{lat:f.lat,lon:f.lon}])} onPick={selectPoint} label={t('Facility map','Taswirar cibiyoyin lafiya')}/>)}
      <h2>{t('Facility directory','Kundin cibiyoyin lafiya')}</h2>
      <form className="stack" onSubmit={e=>{e.preventDefault();void search(point);}}><div className="form-row"><label>{t('State','Jiha')}<select value={state} onChange={e=>setState(e.target.value)}>{point&&<option value="">{t('Any nearby state','Duk jihar da ke kusa')}</option>}{states.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>{t('Facility type','Nau’in cibiyar')}<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">{t('All facility types','Duk nau’o’i')}</option>{categoryEntries.map(([key,value])=><option key={key} value={key}>{t(...value as [string,string])}</option>)}</select></label></div>
      <label>{t('Name or LGA','Suna ko ƙaramar hukuma')}<input maxLength={100} value={term} onChange={e=>setTerm(e.target.value)}/></label>
      <button className="button primary" disabled={busy}><Search size={18}/>{busy?t('Searching…','Ana nema…'):t('Search directory','Bincika kundin')}</button></form>
      <Notice text={failure} error/>
      {loaded&&results.length===0&&!failure&&<Notice text={demoMode?t('No demo facilities match. Try the sample Kaduna postcode.','Babu cibiyar gwaji da ta dace. Gwada lambar Kaduna.') : t('No verified facilities matched this search.','Babu cibiyar da aka tabbatar da ta dace da binciken.')}/>}
      {results.map(f=><div className="record" key={f.id}><Link href={{pathname:'/facilities',query:{id:f.id}}}><strong>{f.name}</strong></Link><span className="muted">{f.lga}, {f.state}{f.distance_km!==undefined?' · '+f.distance_km.toFixed(1)+' km':''}</span></div>)}
    </section></div>
  </div>;
}

export function FacilityDetails(){
  const {t}=useLanguage();
  const id=useSearchParams().get('id')||'';
  const [record,setRecord]=useState<Facility>(),[failure,setFailure]=useState(false),[point,setPoint]=useState<Point|null>(null);
  const [route,setRoute]=useState(''),[routing,setRouting]=useState(false),[map,setMap]=useState(false),[originMap,setOriginMap]=useState(false);
  useEffect(()=>{api<Facility>('/facilities/'+encodeURIComponent(id)).then(setRecord).catch(()=>setFailure(true));},[id]);
  async function estimate(){
    setRouting(true);setRoute('');
    try{const data=await api<{minutes:number;km:number}>('/facilities/'+encodeURIComponent(id)+'/route',json(point));setRoute(data.minutes+' min · '+data.km+' km');}
    catch{setRoute(t('Road estimate unavailable.','Ba a samu ƙiyasin lokacin tafiya ba.'));}
    finally{setRouting(false);}
  }
  return <div className="wrap page"><Link href="/find">{t('Back to directory','Koma kundin')}</Link>
    {failure&&<Notice error text={t('Facility details are unavailable.','Ba a samu bayanan cibiyar ba.')}/>}
    {!record&&!failure&&<p role="status">{t('Loading…','Ana lodawa…')}</p>}
    {record&&<><PageHeading title={record.name} detail={record.lga+', '+record.state}/><div className="layout"><section className="card stack">
      {demoMode?<p>{t('Synthetic facility for testing.','Cibiyar misali don gwaji.')}</p>:<p>{t('Last verified','Ranar tabbatarwa')} · {record.verified_at}</p>}
      {[[t('Type','Nau’i'),categories[record.category as keyof typeof categories]?t(...categories[record.category as keyof typeof categories] as [string,string]):record.category],[t('Ward','Mazaba'),record.ward],[t('Postcode','Lambar gidan waya'),record.postcode],[t('Ownership','Mai cibiyar'),record.ownership],[t('Services','Ayyuka'),record.services],[t('Hours','Lokutan aiki'),record.hours]].map(([label,value])=><p key={label}><strong>{label}</strong> · {value||t('Unavailable','Babu bayani')}</p>)}
      <p><strong>{t('Verified phone','Tabbatacciyar lambar waya')}</strong> · {record.phone?<a href={'tel:'+record.phone.replace(/[^+0-9]/g,'')}>{record.phone}</a>:t('Unavailable','Babu bayani')}</p>
      {!demoMode&&<a className="button outline" href={record.source} rel="noreferrer">{t('View verification source','Duba tushen bayanai')}</a>}
      </section><section className="card stack"><h2>{t('Location','Wuri')}</h2>
      {record.lat!==null&&record.lon!==null&&<>
        <button className="button outline" type="button" aria-expanded={map} onClick={()=>setMap(v=>!v)}>{map?t('Hide satellite map','Ɓoye hoton tauraron ɗan adam'):t('Show satellite map','Nuna hoton tauraron ɗan adam')}</button>
        {map&&<GoogleSatellite point={{lat:record.lat,lon:record.lon}} demo={demoMode||record.id.startsWith('demo-kaduna-')}/>}
      </>}
      {!demoMode&&<><h2>{t('Road travel estimate','Ƙiyasin tafiya ta hanya')}</h2>
        <LocationFields point={point} onPoint={setPoint}/>
        {record.lat!==null&&record.lon!==null&&<>
          <button className="button outline" type="button" aria-expanded={originMap} onClick={()=>setOriginMap(v=>!v)}>{originMap?t('Hide origin map','Ɓoye taswirar wurin farawa'):t('Choose a starting point on the map','Zaɓi wurin farawa a taswira')}</button>
          {originMap&&<MapView point={point} onPick={setPoint} markers={[{lat:record.lat,lon:record.lon}]}/>}
        </>}
        <button className="button primary" disabled={!point||routing} onClick={estimate}>{t('Estimate route','Ƙiyasta tafiya')}</button><Notice text={route}/>
      </>}
      </section></div></>}
  </div>;
}

type Tracking={id:string;status:string;created?:number;updated?:number;tracking_key?:string;dispatch_enabled:false};
export function Emergency(){
  const {t}=useLanguage();
  const [point,setPoint]=useState<Point|null>(null),[map,setMap]=useState(false),[busy,setBusy]=useState(false),[record,setRecord]=useState<Tracking>(),[error,setError]=useState('');
  const retry=useRef<{key:string;body:string}|undefined>(undefined);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');setRecord(undefined);
    const data=new FormData(e.currentTarget);
    const payload=json({synthetic:data.has('synthetic'),category:data.get('category'),point,
      postcode:data.get('postcode')||null,callback:data.get('callback')||null,landmark:data.get('landmark')||null});
    try{
      const body=String(payload.body);
      if(retry.current?.body!==body)retry.current={key:crypto.randomUUID(),body};
      const result=await api<Tracking>('/incidents',{...payload,headers:{'X-Tracking-Key':retry.current.key}});
      setRecord(result);
      retry.current=undefined;
    }
    catch{setError(t('Sandbox submission could not be confirmed. Check your location fields and connection. For real emergencies call 112.','Ba a tabbatar da aika gwajin ba. Duba bayanan wuri da haɗin intanet. Idan gaggawa ce, kira 112.'));}
    finally{setBusy(false);}
  }
  return <div className="wrap page"><PageHeading title={t('Emergency assistance','Agajin gaggawa')} detail={t('For a real emergency in Nigeria, call 112. GeoCare cannot send responders.','Idan akwai gaggawa a Najeriya, kira 112. GeoCare ba zai iya tura masu agaji ba.')}/>
    <a className="button emergency" href="tel:112"><Phone size={20}/>{t('SOS · Call 112','SOS · Kira 112')}</a>
    <div className="layout"><form className="card stack" onSubmit={submit}>
      <h2>{t('Register a sandbox incident','Yi rajistar lamarin gwaji')}</h2>
      <label>{t('Emergency category','Nau’in gaggawa')}<select name="category"><option value="maternal">{t('Maternal and obstetric','Ciki da haihuwa')}</option><option value="traffic">{t('Road traffic injury','Raunin hatsarin hanya')}</option><option value="acute">{t('Acute medical emergency','Matsalar lafiya ta gaggawa')}</option><option value="other">{t('Other emergency','Wata gaggawa')}</option></select></label>
      <label>{t('Synthetic postcode (optional)','Lambar gidan waya ta gwaji (na zaɓi)')}<input name="postcode" maxLength={32}/></label>
      <label>{t('Synthetic callback number (optional)','Lambar waya ta gwaji (na zaɓi)')}<input name="callback" type="tel" maxLength={30}/></label>
      <label>{t('Simulated landmark or access instructions','Bayanin wurin gwaji ko yadda za a isa')}<textarea name="landmark" maxLength={280}/></label>
      <LocationFields point={point} onPoint={setPoint} allowGPS={false}/>
      <label className="check"><input type="checkbox" name="synthetic" required/>{t('I confirm these details are synthetic.','Na tabbatar cewa waɗannan bayanan na gwaji ne.')}</label>
      <button className="button primary" disabled={busy}>{busy?t('Submitting…','Ana aikawa…'):t('Submit simulation','Aika gwaji')}</button>
      <Notice text={error} error/>
    </form><section className="card stack"><button className="button outline" onClick={()=>setMap(v=>!v)}>{t('Toggle simulated location map','Buɗe ko rufe taswirar wurin gwaji')}</button>{map&&<MapView point={point} onPick={setPoint}/>}
    {record&&<div className="notice" role="status"><strong>{t('Simulation saved. No help was dispatched.','An adana gwajin. Ba a tura agaji ba.')}</strong>
      <p className="break">{t('Reference','Lambar rajista')} · <code>{record.id}</code></p><p className="break">{t('Private tracking key','Lambar bin diddigi ta sirri')} · <code>{record.tracking_key}</code></p>
      <p>{t('Save both values somewhere private to track this simulation.','Adana lambobin biyu a wuri na sirri don bin diddigin gwajin.')}</p><Link className="button outline" href="/track">{t('Open tracking','Buɗe bin diddigi')}</Link></div>}
    </section></div></div>;
}
export function Track(){
  const {t}=useLanguage();
  const [record,setRecord]=useState<Tracking>(),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError(false);setRecord(undefined);
    const data=new FormData(e.currentTarget);
    try{setRecord(await api<Tracking>('/incidents/'+encodeURIComponent(String(data.get('id')).trim())+'/track',{method:'POST',headers:{'X-Tracking-Key':String(data.get('key')).trim()}}));}
    catch{setError(true);}
    finally{setBusy(false);}
  }
  return <div className="wrap page"><PageHeading title={t('Track a sandbox request','Bibiyi buƙatar gwaji')} detail={t('Enter the reference and private tracking key from your simulation.','Shigar da lambar rajista da lambar bin diddigi ta sirri daga gwajinka.')}/>
    <form className="card narrow stack" onSubmit={submit}><label>{t('Reference','Lambar rajista')}<input name="id" required maxLength={64} autoComplete="off"/></label>
    <label>{t('Private tracking key','Lambar bin diddigi ta sirri')}<input name="key" type="password" required maxLength={100} autoComplete="off"/></label>
    <button className="button primary" disabled={busy}>{busy?t('Checking…','Ana dubawa…'):t('Check sandbox status','Duba matsayin gwaji')}</button>
    {error&&<Notice error text={t('Could not retrieve the simulation. Check your reference, key and connection.','An kasa dawo da gwajin. Duba lambobinka da haɗin intanet.')}/>}
    {record&&<Notice text={t(...statusNames[record.status])+' · '+t('Simulation only. No help was dispatched.','Gwaji ne kawai. Ba a tura agaji ba.')}/>}</form></div>;
}
