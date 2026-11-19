'use client';
import {useLanguage} from './language';
import {PageHeading} from './public';

export function Privacy(){
  const {t}=useLanguage();
  return <div className="wrap page prose narrow"><PageHeading title={t('Sandbox privacy notice','Bayanin sirrin wurin gwaji')} detail={t('InnoHealth Africa Technologies Ltd · Kaduna pilot','InnoHealth Africa Technologies Ltd · Gwajin Kaduna')}/>
    <section className="card stack"><h2>{t('Data used during testing','Bayanan da ake amfani da su a gwaji')}</h2>
      <p>{t('Use synthetic incident and referral details only. The service stores partner account details, simulation records and audit events. Access to simulation data depends on partner role and organisation.','Yi amfani da bayanan gwaji kawai. Ana adana bayanan asusun abokan aiki, bayanan gwaji da tarihin ayyuka. Samun bayanai ya danganta da aikin mai amfani da ƙungiyarsa.')}</p>
      <p>{t('GPS begins only when you request it. Directory and routing requests can transmit selected coordinates. Map and routing providers may receive information about the requested area.','Ana kunna GPS ne idan ka nema. Binciken kundin da hanyar tafiya na iya aika lambobin wurin da ka zaɓa. Masu samar da taswira ko hanyoyi na iya samun bayanin yankin da ka nema.')}</p>
      <p>{t('Sandbox operators configure how long sensitive simulation details are kept. Ask your pilot administrator about access or deletion requests.','Masu gudanar da gwaji ne ke saita tsawon lokacin adana bayanan sirri na gwaji. Tuntuɓi mai gudanar da gwajin don neman bayanai ko a goge su.')}</p>
    </section></div>;
}
export function Terms(){
  const {t}=useLanguage();
  return <div className="wrap page prose narrow"><PageHeading title={t('Sandbox terms of use','Sharuɗɗan amfani da wurin gwaji')} detail={t('InnoHealth GeoCare is a Kaduna pilot sandbox.','InnoHealth GeoCare wurin gwaji ne a Kaduna.')}/>
    <section className="card stack"><h2>{t('Using the sandbox','Amfani da wurin gwaji')}</h2>
      <p>{t('For emergencies in Nigeria, call 112. The sandbox cannot dispatch responders and its referral tools are for training.','Idan akwai gaggawa a Najeriya, kira 112. Wurin gwajin ba zai iya tura masu agaji ba, kuma kayan tura marasa lafiya na horo ne.')}</p>
      <p>{t('Contact facilities directly to confirm hours and services. Road estimates depend on routing data and conditions can change. Protect private tracking keys and partner credentials.','Tuntuɓi cibiyoyi kai tsaye don tabbatar da lokutan aiki da ayyuka. Ƙiyasin tafiya ya dogara da bayanan hanyoyi kuma yanayi na iya canzawa. Kiyaye lambobin bin diddigi da bayanan shiga.')}</p>
    </section></div>;
}
