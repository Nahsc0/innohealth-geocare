import {describe,expect,it} from 'vitest';
import {demoSatellitePoint,googleSatelliteLinks} from '../../lib/google-maps';

describe('Google Maps satellite views',()=>{
  it('links to satellite mode at the facility coordinates and uses its generated demo embed',()=>{
    const point={lat:10.492,lon:7.433};
    const {maps,embed}=googleSatelliteLinks(point,true);
    expect(new URL(maps).searchParams.get('basemap')).toBe('satellite');
    expect(new URL(maps).searchParams.get('center')).toBe('10.492,7.433');
    expect(embed).toContain('!3d10.492');
  });

  it('keeps unrelated coordinates out of the public demo frame',()=>{
    const selected={lat:55.85,lon:-4.19};
    expect(demoSatellitePoint(selected)).toMatchObject({lat:10.52,lon:7.44});
    expect(googleSatelliteLinks(selected,true).embed).toBeUndefined();
  });

  it('can embed connected facilities through a configured Maps Embed API key',()=>{
    const point={lat:9.04,lon:7.46};
    expect(googleSatelliteLinks(point,false).embed).toBeUndefined();
    const {embed}=googleSatelliteLinks(point,false,'test-key');
    const url=new URL(embed!);
    expect(url.pathname).toBe('/maps/embed/v1/view');
    expect(url.searchParams.get('center')).toBe('9.04,7.46');
    expect(url.searchParams.get('maptype')).toBe('satellite');
  });
});
