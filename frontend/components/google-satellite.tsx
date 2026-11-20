'use client';
import {ExternalLink} from 'lucide-react';
import type {Point} from '@/lib/api';
import {googleSatelliteLinks} from '@/lib/google-maps';
import {useLanguage} from './language';

export function GoogleSatellite({point,demo=false}:{point:Point;demo?:boolean}) {
  const {t}=useLanguage();
  const {maps,embed}=googleSatelliteLinks(point,demo,process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY);
  return <div className="stack">
    {embed&&<iframe className="map map-embed" title={t('Google Maps satellite view','Hoton tauraron ɗan adam na Google Maps')}
      src={embed} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>}
    <a className="button outline" href={maps} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>
      {t('Open satellite view in Google Maps','Buɗe hoton tauraron ɗan adam a Google Maps')}</a>
  </div>;
}
