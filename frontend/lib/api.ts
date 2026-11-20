export type Point = {lat:number;lon:number};
export type Facility = {
  id:string;name:string;state:string;lga:string;category:string;source:string;
  ward:string|null;postcode:string|null;lat:number|null;lon:number|null;
  ownership:string|null;services:string|null;hours:string|null;phone:string|null;
  verified_at:string;distance_km?:number;
};

export class ApiError extends Error {
  constructor(public status:number, message:string) { super(message); }
}
export const demoMode = process.env.NEXT_PUBLIC_GEOCARE_PREVIEW === '1';
export const demoPostcode = 'ZZ-01-A01-ZZ-01';
let token = '';
const sessionKey = demoMode?'geocare-demo-session':'geocare-session';
export const sessionExpired = 'geocare-session-expired';
export function savedToken() {
  try { return sessionStorage.getItem(sessionKey) || ''; } catch { return ''; }
}
export function setToken(value:string) {
  token = value;
  try {
    if (value) sessionStorage.setItem(sessionKey, value);
    else sessionStorage.removeItem(sessionKey);
  } catch { /* The current page can still use the in-memory session. */ }
}

export async function api<T>(path:string, options:RequestInit = {}):Promise<T> {
  if (demoMode) {
    const {demoRequest}=await import('./demo');
    return demoRequest(path,options,token) as T;
  }
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type','application/json');
  const requestToken = token;
  if (requestToken) headers.set('Authorization','Bearer '+requestToken);
  const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const timeout = ['/me','/login','/register/code','/partner/signup','/partner/activate'].includes(path)?75000:12000;
  let response:Response;
  try {
    response = await fetch(base + '/v1' + path, {
      ...options, headers, cache:'no-store', signal:options.signal || AbortSignal.timeout(timeout),
    });
  } catch {
    throw new ApiError(0,'Connection unavailable. Check your network and try again.');
  }
  if (!response.ok) {
    if (response.status === 401 && requestToken && requestToken === token && path !== '/login') {
      setToken('');
      window.dispatchEvent(new Event(sessionExpired));
    }
    const result = await response.json().catch(() => ({}));
    throw new ApiError(response.status, typeof result.detail==='string' ? result.detail : 'Check the information provided and try again.');
  }
  if (response.status===204) return undefined as T;
  return (response.headers.get('Content-Type')?.includes('text/csv') ? await response.text() : await response.json()) as T;
}
export const json = (body:unknown, method='POST'):RequestInit => ({method,body:JSON.stringify(body)});
export function coordinates(lat:string,lon:string):Point|null {
  if (!lat.trim() || !lon.trim()) return null;
  const a=Number(lat), b=Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a)>90 || Math.abs(b)>180) return null;
  return {lat:a,lon:b};
}
