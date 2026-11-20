import {request} from '@playwright/test';
import {latestMail,profile,testApi} from './account-fixture';

export default async function setupBrowserAccount(){
  const api=await request.newContext();
  try {
    const email=`browser-fixture-${Date.now()}@example.invalid`;
    const sent=await api.post(testApi+'/v1/register/code',{data:{email}});
    if(!sent.ok())throw new Error(`Browser fixture code request failed with HTTP ${sent.status()}`);
    const mail=await latestMail(email);
    if(!mail || mail.challenge!==(await sent.json()).challenge)throw new Error('Browser fixture code is missing from the test mailbox.');
    const registration=await api.post(testApi+'/v1/register',{data:{
      email,password:'Synthetic-test-password-42',challenge:mail.challenge,code:mail.code,...profile,
    }});
    if(!registration.ok())throw new Error(`Browser fixture registration failed with HTTP ${registration.status()}`);
    process.env.GEOCARE_E2E_VISITOR_TOKEN=(await registration.json()).token;
  } finally {
    await api.dispose();
  }
}
