import {fileURLToPath} from 'node:url';
const pages = process.env.GEOCARE_PAGES === '1';
export default {
  ...(pages ? {output:'export', trailingSlash:true, basePath:process.env.GEOCARE_BASE_PATH || ''} : {}),
  poweredByHeader: false,
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  ...(!pages && {async headers() {
    return [{source:'/:path*',headers:[
      {key:'X-Frame-Options',value:'DENY'},
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
      {key:'Permissions-Policy',value:'geolocation=(self)'},
    ]}];
  }}),
};
