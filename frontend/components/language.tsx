'use client';
import {createContext,useContext,useEffect,useState} from 'react';

type Lang='en'|'ha';
const Language=createContext({lang:'en' as Lang,t:(a:string,b:string)=>a,toggle:()=>{}});
export function LanguageProvider({children}:{children:React.ReactNode}) {
  const [lang,setLang]=useState<Lang>('en');
  useEffect(()=>{if(localStorage.getItem('geocare-language')==='ha')setLang('ha');},[]);
  useEffect(()=>{document.documentElement.lang=lang;},[lang]);
  return <Language.Provider value={{lang,t:(en,ha)=>lang==='ha'?ha:en,toggle:()=>{
    const language=lang==='en'?'ha':'en';localStorage.setItem('geocare-language',language);setLang(language);
  }}}>{children}</Language.Provider>;
}
export const useLanguage=()=>useContext(Language);
