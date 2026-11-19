import {Suspense} from 'react';
import {FacilityDetails} from '@/components/public';

export default function FacilityPage(){
  return <Suspense fallback={<div className="wrap page" role="status">Loading facility…</div>}>
    <FacilityDetails/>
  </Suspense>;
}
