import {expect,test} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test('public navigation, Hausa and responsive layout',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Find healthcare closer to you.'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Switch to Hausa'}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','ha');
  await expect(page.getByRole('link',{name:'Bibiyi buƙata',exact:true})).toBeVisible();
});
test('GPS failure falls back to manual search',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:(_:unknown,failure:()=>void)=>failure()}}));
  await page.goto('/find');
  await page.getByRole('button',{name:'Use my GPS location'}).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('Location unavailable');
  await page.getByLabel('Latitude').fill('10.52');
  await page.getByLabel('Longitude').fill('7.44');
  await page.getByRole('button',{name:'Use these coordinates'}).click();
  await page.getByRole('button',{name:'Search directory'}).click();
  await expect(page.getByRole('status')).toContainText('No verified facilities matched');
});
test('mock postcode is labelled and remains usable',async({page})=>{
  await page.goto('/find');
  await page.getByLabel('Digital postcode').fill('ZZ-01-A01-ZZ-01');
  await page.getByRole('button',{name:'Check postcode'}).click();
  await expect(page.getByRole('status')).toContainText('Local mock postcode matched');
  await expect(page.getByLabel('Latitude')).toHaveValue('10.52');
});
test('simulated incident is saved and privately tracked',async({page})=>{
  await page.goto('/emergency');
  await expect(page.getByRole('link',{name:'SOS · Call 112'})).toHaveAttribute('href','tel:112');
  await page.getByLabel('Simulated landmark').fill('Synthetic training location');
  await page.getByLabel('I confirm these details are synthetic.').check();
  await page.getByRole('button',{name:'Submit simulation'}).click();
  await expect(page.getByRole('status')).toContainText('No help was dispatched');
  const [reference,key]=await page.locator('.notice code').allTextContents();
  await page.getByRole('link',{name:'Open tracking'}).click();
  await page.getByLabel('Reference').fill(reference);
  await page.getByLabel('Private tracking key').fill(key);
  await page.getByRole('button',{name:'Check sandbox status'}).click();
  await expect(page.getByRole('status')).toContainText('Submitted');
  await expect(page.getByRole('status')).toContainText('No help was dispatched');
});
test('failed request on an interrupted connection has no dispatch acknowledgement',async({page})=>{
  await page.goto('/emergency');
  await page.route('**/v1/incidents',async route=>{
    await new Promise(resolve=>setTimeout(resolve,350));
    await route.abort('internetdisconnected');
  });
  await page.getByLabel('Simulated landmark').fill('Synthetic training location');
  await page.getByLabel('I confirm these details are synthetic.').check();
  await page.getByRole('button',{name:'Submit simulation'}).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('could not be confirmed');
  await expect(page.getByText('Simulation saved.')).toHaveCount(0);
});
test('partner screens require authentication',async({page})=>{
  await page.goto('/admin');
  await expect(page.getByRole('link',{name:'Go to partner login'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'User management'})).toHaveCount(0);
});
test('capture the working public pages',async({page},testInfo)=>{
  test.skip(!process.env.GEOCARE_SCREENSHOTS,'Screenshots only on explicit QA runs');
  await mkdir('../docs/screenshots',{recursive:true});
  for(const [path,slug] of [['/','home'],['/find','finder'],['/emergency','emergency'],['/track','tracking'],['/partner','partner-login']]){
    await page.goto(path);
    await expect(page.getByRole('heading',{level:1})).toBeVisible();
    await page.screenshot({path:'../docs/screenshots/'+slug+'-'+testInfo.project.name+'.png',fullPage:true,animations:'disabled'});
  }
});

test('capture signed-in partner workflows and a synthetic facility detail',async({page,request},testInfo)=>{
  const email=process.env.BOOTSTRAP_EMAIL,password=process.env.BOOTSTRAP_PASSWORD;
  test.skip(!process.env.GEOCARE_SCREENSHOTS||!email||!password,'Requires an isolated screenshot database');
  const login=await request.post('http://localhost:8000/v1/login',{data:{email,password}});
  expect(login.ok()).toBe(true);
  const {token}=await login.json();
  const seeded=await request.post('http://localhost:8000/v1/admin/facilities/screenshot-only',{
    headers:{Authorization:'Bearer '+token},
    data:{name:'Synthetic facility · screenshot fixture',state:'FCT',lga:'Synthetic dataset',category:'phc',
      source:'https://example.invalid/test-only',verified_at:'2024-01-01'},
  });
  expect(seeded.ok()).toBe(true);
  await mkdir('../docs/screenshots',{recursive:true});
  await page.goto('/facilities?id=screenshot-only');
  await expect(page.getByRole('heading',{name:'Synthetic facility · screenshot fixture'})).toBeVisible();
  await page.screenshot({path:'../docs/screenshots/facility-details-'+testInfo.project.name+'.png',fullPage:true});
  await page.goto('/partner');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  const links=page.getByRole('navigation',{name:'Partner workspaces'});
  await expect(links).toBeVisible();
  for(const [name,slug] of [['Dispatch','dispatch'],['Facility dashboard','facility-dashboard'],['Maternal referrals','referrals'],['GIS analytics','analytics'],['Administration','admin']]){
    await links.getByRole('link',{name,exact:true}).click();
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    await page.screenshot({path:'../docs/screenshots/'+slug+'-'+testInfo.project.name+'.png',fullPage:true,animations:'disabled'});
  }
  await page.getByRole('button',{name:'Sign out'}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
});