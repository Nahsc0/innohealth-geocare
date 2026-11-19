'use client';
import Image from 'next/image';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {Activity, Globe2, HeartPulse, LockKeyhole, MapPin, Phone, Search} from 'lucide-react';
import {useLanguage} from './language';
import innoHealthLogo from '@/public/brand/innohealth-logo.webp';

export function Shell({children}:{children:React.ReactNode}) {
  const {t,toggle,lang}=useLanguage();
  const path=usePathname().replace(/\/$/, '') || '/';
  return <>
    <a className="skip" href="#main">{t('Skip to content','Tsallaka zuwa babban sashe')}</a>
    <header className="top"><div className="wrap mast">
      <Link className="brand" href="/">
        <Image className="brand-logo" src={innoHealthLogo} alt="InnoHealth Technologies" unoptimized priority/>
        <span className="brand-product">GeoCare</span>
      </Link>
      <nav aria-label={t('Main navigation','Babban menu')}>
        <Link href="/find" aria-current={path==='/find'?'page':undefined}>{t('Find healthcare','Nemo cibiyar lafiya')}</Link>
        <Link href="/emergency" aria-current={path==='/emergency'?'page':undefined}>{t('Emergency','Gaggawa')}</Link>
        <Link href="/track" aria-current={path==='/track'?'page':undefined}>{t('Track request','Bibiyi buƙata')}</Link>
      </nav>
      <div className="top-actions"><button className="button ghost small" onClick={toggle} aria-label={t('Switch to Hausa','Canja zuwa Turanci')}><Globe2 size={16}/>{lang==='en'?'Hausa':'English'}</button>
      <Link className="button outline small" href="/partner"><LockKeyhole size={16}/>{t('Partner login','Shigar abokan aiki')}</Link></div>
    </div></header>
    <aside className="safety"><div className="wrap safety-inner"><span><strong>{t('Sandbox only','Wurin gwaji kawai')}</strong> · {t('GeoCare cannot dispatch emergency assistance.','GeoCare ba zai iya tura agajin gaggawa ba.')}</span>
      <a href="tel:112"><Phone size={15}/>{t('Call 112 in Nigeria','Kira 112 a Najeriya')}</a></div></aside>
    {process.env.NEXT_PUBLIC_GEOCARE_PREVIEW==='1'&&<div className="wrap"><p className="notice">{t('Frontend preview. Facility search, incident tracking and partner services are offline while hosting is set up.','Wannan samfotin shafi ne. Binciken cibiyoyi, bin diddigin buƙatu da ayyukan abokan hulɗa suna jiran kunna sabar.')}</p></div>}
    <main id="main">{children}</main>
    <footer className="foot">
      <div className="wrap footer-inner">
        <div className="footer-company">
          <strong>InnoHealth GeoCare</strong>
          <p>{t('Powered by InnoHealth Africa Technologies Ltd','InnoHealth Africa Technologies Ltd ce ke gudanarwa')}</p>
          <a className="footer-email" href="mailto:admin@innohealthafrica.org">admin@innohealthafrica.org</a>
        </div>
        <nav className="footer-social" aria-label={t('InnoHealth Technologies social media','Kafafen sada zumunta na InnoHealth Technologies')}>
          <strong>InnoHealth Technologies</strong>
          <ul className="footer-links">
            <li><a href="https://www.linkedin.com/company/innohealthtechnologies/">LinkedIn</a></li>
            <li><a href="https://x.com/InnohealthTechs">X</a></li>
            <li><a href="https://www.facebook.com/profile.php?id=61587705212859">Facebook</a></li>
          </ul>
        </nav>
        <nav className="footer-links" aria-label={t('Site policies and emergency information','Sharuɗɗan shafi da bayanan gaggawa')}>
          <Link href="/privacy">{t('Privacy','Sirri')}</Link>
          <Link href="/terms">{t('Terms','Sharuɗɗa')}</Link>
          <a href="https://ncc.gov.ng/media/836/view">{t('112 source','Tushen bayanin 112')}</a>
        </nav>
      </div>
    </footer>
  </>;
}

export function Home() {
  const {t}=useLanguage();
  return <div className="wrap home">
    <section className="hero"><div className="hero-copy">
      <div className="region"><MapPin size={16}/>{t('Kaduna State, Nigeria','Jihar Kaduna, Najeriya')}</div>
      <h1>{t('Find healthcare','Nemo cibiyar lafiya')}<br/><em>{t('closer to you.','kusa da kai.')}</em></h1>
      <p>{t('Search for healthcare facilities in Kaduna State using a digital postcode, your current location, or a point on the map.','Nemi cibiyoyin lafiya a Jihar Kaduna ta amfani da lambar gidan waya ta dijital, wurinka na yanzu, ko wurin da ka zaɓa a taswira.')}</p>
      <div className="actions"><Link className="button primary" href="/find"><Search size={20}/>{t('Find healthcare','Nemo cibiyar lafiya')}</Link><Link className="button emergency" href="/emergency"><HeartPulse size={20}/>{t('Emergency assistance','Agajin gaggawa')}</Link></div>
    </div><div className="hero-map" aria-hidden="true"><div className="map-grid"/><div className="rings"/><span className="pin pin-main"><MapPin size={40}/></span><span className="pin pin-small"><HeartPulse size={24}/></span><span className="map-label">KADUNA STATE</span><span className="map-caption">NIGERIA</span></div></section>
    <section className="services"><h2>{t('How can we help?','Ta yaya za mu taimaka?')}</h2><div className="tiles">
      <Link href="/find"><span className="tile-icon"><Search/></span><h3>{t('Find a facility','Nemo cibiyar lafiya')}</h3><p>{t('Browse the directory and filter by facility type.','Duba kundin cibiyoyin lafiya, ka zaɓi nau’in cibiyar.')}</p></Link>
      <Link href="/track"><span className="tile-icon"><Activity/></span><h3>{t('Track a sandbox request','Bibiyi buƙatar gwaji')}</h3><p>{t('Use your reference and tracking key to check a simulation.','Yi amfani da lambobin bin diddigi don duba gwaji.')}</p></Link>
      <Link href="/partner"><span className="tile-icon"><LockKeyhole/></span><h3>{t('Partner workspace','Wurin aikin abokan hulɗa')}</h3><p>{t('Sign in for referral, dispatch and pilot administration tools.','Shiga don amfani da kayan aikin tura marasa lafiya da gudanar da gwaji.')}</p></Link>
    </div></section>
  </div>;
}
