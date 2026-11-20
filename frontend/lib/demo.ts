import {ApiError, type Facility} from './api';
import fixtures from './demo-facilities.json';

const demoToken = 'geocare-static-demo';
const facilities = fixtures.map((record): Facility => ({
  ...record, ward:null, ownership:null, hours:null, phone:null, source:'', verified_at:'',
}));

function distanceKm(lat:number, lon:number, otherLat:number, otherLon:number) {
  const radians=(degrees:number)=>degrees*Math.PI/180;
  const dLat=radians(otherLat-lat), dLon=radians(otherLon-lon);
  const a=Math.sin(dLat/2)**2+Math.cos(radians(lat))*Math.cos(radians(otherLat))*Math.sin(dLon/2)**2;
  return 12742*Math.asin(Math.sqrt(Math.min(a,1)));
}

export function demoRequest(path:string, options:RequestInit, token:string):unknown {
  const url=new URL(path,'https://demo.invalid');
  const {pathname,searchParams}=url;
  if(pathname==='/demo/session'&&options.method==='POST')return {token:demoToken};
  if(token!==demoToken)throw new ApiError(401,'Sign in to the demo first.');
  if(pathname==='/me')return {id:'demo-visitor',email:'',role:'individual',org_id:''};
  if(pathname==='/logout')return undefined;
  if(pathname==='/postcodes/lookup'){
    const {postcode}=JSON.parse(String(options.body));
    const code=String(postcode).toUpperCase().replace(/[ -]/g,'');
    const facility=facilities.find(record=>record.postcode?.replace(/-/g,'')===code);
    return {valid:Boolean(facility),source:'local_mock',location:facility?{lat:facility.lat,lon:facility.lon}:null};
  }
  if(pathname==='/facilities'){
    const state=searchParams.get('state')||'', category=searchParams.get('category');
    const term=(searchParams.get('q')||'').trim().toLowerCase();
    const results=facilities.filter(f=>(!state||f.state===state) && (!category||f.category===category)
      && (f.name.toLowerCase().includes(term)||f.lga.toLowerCase().includes(term)));
    if(!searchParams.has('lat')||!searchParams.has('lon'))return results.sort((a,b)=>a.name.localeCompare(b.name));
    const lat=Number(searchParams.get('lat')), lon=Number(searchParams.get('lon'));
    const radius=Number(searchParams.get('radius')||50);
    return results.map(f=>({...f,distance_km:distanceKm(lat,lon,f.lat!,f.lon!)}))
      .filter(record=>record.distance_km<=radius).sort((a,b)=>a.distance_km-b.distance_km);
  }
  const detail=/^\/facilities\/([^/]+)$/.exec(pathname);
  if(detail){
    const facility=facilities.find(record=>record.id===decodeURIComponent(detail[1]));
    if(facility)return facility;
    throw new ApiError(404,'Demo facility unavailable.');
  }
  throw new ApiError(503,'This feature requires the connected GeoCare service.');
}
