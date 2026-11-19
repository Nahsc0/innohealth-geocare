import {afterEach,describe,expect,it,vi} from 'vitest';
import {api,ApiError,coordinates,json,setToken} from '../../lib/api';

afterEach(()=>{vi.unstubAllGlobals();setToken('');});
describe('coordinates',()=>{
  it('preserves zero and rejects blanks, invalid numbers and invalid bounds',()=>{
    expect(coordinates('0','0')).toEqual({lat:0,lon:0});
    expect(coordinates('10.52','7.44')).toEqual({lat:10.52,lon:7.44});
    for(const [lat,lon] of [['','7'],['1','Infinity'],['91','0'],['1','-181']]){
      expect(coordinates(lat,lon)).toBeNull();
    }
  });
});
describe('API client',()=>{
  it('sends a bearer token and JSON without caching',async()=>{
    const mock=vi.fn().mockResolvedValue(new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}}));
    vi.stubGlobal('fetch',mock);setToken('synthetic-token');
    await expect(api('/test',json({synthetic:true}))).resolves.toEqual({ok:true});
    const args=mock.mock.calls[0][1] as RequestInit;
    expect((args.headers as Headers).get('Authorization')).toBe('Bearer synthetic-token');
    expect(args.cache).toBe('no-store');
  });
  it('reports failed transport without a false success',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('NetworkError')));
    await expect(api('/incidents',json({synthetic:true}))).rejects.toMatchObject({status:0});
  });
  it('preserves server failures for callers',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"detail":"Sign in required"}',{status:401})));
    await expect(api('/me')).rejects.toBeInstanceOf(ApiError);
  });
});
