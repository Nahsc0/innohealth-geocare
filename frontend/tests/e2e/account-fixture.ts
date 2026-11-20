import {expect,type APIRequestContext,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

let visitorToken:string|undefined;
export const testApi='http://127.0.0.1:8000';
export const profile={name:'Synthetic Visitor',age:30,gender:'prefer_not_to_say',state:'FCT',lga:'Gwagwalada',phone:'+2347000000001'};

export async function latestMail(email:string){
  const mailbox=process.env.GEOCARE_DEV_MAILBOX;
  if(!mailbox)throw new Error('Set GEOCARE_DEV_MAILBOX on the API and Playwright processes.');
  const contents=await readFile(mailbox,'utf8').catch(()=> '');
  return contents.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).reverse()
    .find((item:{recipient:string})=>item.recipient===email) as {challenge:string;code:string}|undefined;
}

export async function openSignedIn(page:Page,request:APIRequestContext,path:string){
  if(!visitorToken){
    const email=`visitor-${Date.now()}@example.invalid`;
    const codeRequest=await request.post(testApi+'/v1/register/code',{data:{email}});
    expect(codeRequest.ok()).toBe(true);
    const mail=await latestMail(email);
    expect(mail).toBeDefined();
    const registration=await request.post(testApi+'/v1/register',{data:{
      email,password:'Synthetic-test-password-42',challenge:mail!.challenge,code:mail!.code,...profile,
    }});
    expect(registration.ok()).toBe(true);
    visitorToken=(await registration.json()).token;
  }
  await page.goto(path);
  await page.evaluate(token=>sessionStorage.setItem('geocare-session',token!),visitorToken);
  await page.reload();
}
