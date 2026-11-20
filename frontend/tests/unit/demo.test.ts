import {describe,expect,it} from 'vitest';
import {demoRequest} from '../../lib/demo';

describe('public directory demo',()=>{
  it('requires a demo session and returns facilities nearest the sample postcode',()=>{
    expect(()=>demoRequest('/facilities',{},'')).toThrow('Sign in to the demo first');
    const {token}=demoRequest('/demo/session',{method:'POST'},'') as {token:string};
    const result=demoRequest('/postcodes/lookup',{method:'POST',body:JSON.stringify({postcode:'zz 01 a01 zz 01'})},token);
    expect(result).toMatchObject({valid:true,location:{lat:10.52,lon:7.44}});
    const facilities=demoRequest('/facilities?lat=10.52&lon=7.44',{},token) as {id:string;distance_km:number}[];
    expect(facilities).toHaveLength(3);
    expect(facilities[0]).toMatchObject({id:'demo-kaduna-01',distance_km:0});
    expect(demoRequest('/facilities?lat=55.85&lon=-4.19',{},token)).toEqual([]);
    expect(demoRequest('/facilities?state=Kaduna&q=South',{},token)).toMatchObject([{id:'demo-kaduna-02'}]);
  });
});
