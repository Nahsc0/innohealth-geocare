const site = new URL(process.env.GEOCARE_SITE_URL);
const api = new URL(process.env.NEXT_PUBLIC_API_URL);
if (site.protocol !== 'https:' || api.protocol !== 'https:' || api.username || api.password || api.search || api.hash) {
  throw new Error('Set GEOCARE_API_URL to the public HTTPS API base URL.');
}
const url = path => new URL(api.href.replace(/\/$/, '') + path);
const request = (path, options = {}) => fetch(url(path), {
  ...options, signal: AbortSignal.timeout(30000), redirect: 'error',
});
let status;
for (let attempt=0; attempt<4 && !status; attempt++) {
  const health=await request('/health').catch(()=>null);
  if(health?.ok)status=await health.json();
  else if(attempt<3)await new Promise(resolve=>setTimeout(resolve,3000));
}
if (!status) throw new Error('Sandbox API is unavailable.');
if (!status.ready || status.mode !== 'sandbox' || status.dispatch_enabled !== false) {
  throw new Error('Expected a ready GeoCare sandbox with dispatch disabled.');
}
if (status.registration_configured !== true) {
  throw new Error('Configure the Google Apps Script registration registry on the hosted API before publishing.');
}
const connection = await request('/health/connected');
const connected = await connection.json().catch(()=>({}));
if (!connection.ok || connected.ready !== true) {
  throw new Error('The hosted application cannot verify its Google Sheet, email service and loaded facility directory.');
}
const preflight = await request('/v1/incidents', {method:'OPTIONS',headers:{
  Origin:site.origin,
  'Access-Control-Request-Method':'POST',
  'Access-Control-Request-Headers':'authorization,content-type,x-tracking-key',
}});
const allowedHeaders = preflight.headers.get('access-control-allow-headers')?.toLowerCase().split(',').map(value => value.trim());
if (!preflight.ok || preflight.headers.get('access-control-allow-origin') !== site.origin ||
    !['authorization','content-type','x-tracking-key'].every(value => allowedHeaders?.includes(value))) {
  throw new Error('Configure the FastAPI CORS allowlist for the exact Pages origin.');
}
const directory = await request('/v1/facilities?state=Kaduna', {headers:{Origin:site.origin}});
if (directory.status !== 401 || directory.headers.get('access-control-allow-origin') !== site.origin) {
  throw new Error('The hosted facility directory must require sign-in and allow the Pages origin.');
}
console.log('GeoCare sandbox API and Pages CORS verified.');
