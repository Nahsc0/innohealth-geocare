import type {Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

export const testApi='http://127.0.0.1:8000';
export const profile={name:'Synthetic Visitor',age:30,gender:'prefer_not_to_say',state:'FCT',lga:'Gwagwalada',phone:'+2347000000001'};

export async function latestMail(email:string){
  const mailbox=process.env.GEOCARE_DEV_MAILBOX;
  if(!mailbox)throw new Error('Set GEOCARE_DEV_MAILBOX on the API and Playwright processes.');
  const contents=await readFile(mailbox,'utf8').catch(()=> '');
  return contents.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).reverse()
    .find((item:{recipient:string})=>item.recipient===email) as {challenge:string;code:string}|undefined;
}

export async function openSignedIn(page:Page,path:string){
  const visitorToken=process.env.GEOCARE_E2E_VISITOR_TOKEN;
  if(!visitorToken)throw new Error('Playwright global setup did not provision a visitor.');
  await page.goto(path);
  await page.evaluate(token=>sessionStorage.setItem('geocare-session',token),visitorToken);
  await page.reload();
}
