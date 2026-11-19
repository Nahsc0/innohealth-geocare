'use client';
import {useEffect,useRef,useState} from 'react';
import maplibre,{Map as MapInstance,Marker} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type {Point} from '@/lib/api';

export default function MapView({point,markers=[],onPick,label='Interactive map'}:{
  point?:Point|null;markers?:Point[];onPick?:(point:Point)=>void;label?:string;
}) {
  const container=useRef<HTMLDivElement>(null);
  const instance=useRef<MapInstance|null>(null);
  const callback=useRef(onPick);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{callback.current=onPick;},[onPick]);
  useEffect(()=>{
    let map:MapInstance|undefined;
    try {
      const raster=process.env.NEXT_PUBLIC_TILE_URL || (location.hostname==='localhost' || location.hostname==='127.0.0.1' ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : '');
      if(!raster){setFailed(true);return;}
      map=new maplibre.Map({container:container.current!,center:[7.44,10.52],zoom:10,maxZoom:19,
        style:{version:8,sources:{osm:{type:'raster',tiles:[raster],tileSize:256,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}},layers:[{id:'osm',type:'raster',source:'osm'}]}});
      instance.current=map;
      map.addControl(new maplibre.NavigationControl({showCompass:false}),'top-left');
      map.on('click',({lngLat})=>callback.current?.({lat:+lngLat.lat.toFixed(6),lon:+lngLat.wrap().lng.toFixed(6)}));
      map.on('error',()=>setFailed(true));
    } catch {setFailed(true);}
    return ()=>{map?.remove();instance.current=null;};
  },[]);
  useEffect(()=>{
    const map=instance.current;
    if(!map)return;
    const pins:Marker[]=[];
    for(const item of markers.slice(0,100)) {
      const element=document.createElement('div');element.className='map-marker';
      pins.push(new Marker({element}).setLngLat([item.lon,item.lat]).addTo(map));
    }
    if(point){
      const element=document.createElement('div');element.className='map-pin';
      pins.push(new Marker({element}).setLngLat([point.lon,point.lat]).addTo(map));
      map.jumpTo({center:[point.lon,point.lat]});
    } else if(markers[0]) map.jumpTo({center:[markers[0].lon,markers[0].lat]});
    return ()=>pins.forEach(pin=>pin.remove());
  },[point,markers]);
  return <><div className="map" ref={container} aria-label={label}/>{failed&&<p role="status" className="muted">{label} · Map tiles unavailable</p>}</>;
}
