import type {Metadata} from 'next';
import {LanguageProvider} from '@/components/language';
import {Shell} from '@/components/shell';
import {SessionProvider} from '@/components/session';
import './styles.css';
export const metadata:Metadata={title:'InnoHealth GeoCare',description:'Healthcare facility discovery and sandbox coordination for Kaduna State.'};
export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body><LanguageProvider><SessionProvider><Shell>{children}</Shell></SessionProvider></LanguageProvider></body></html>;
}
