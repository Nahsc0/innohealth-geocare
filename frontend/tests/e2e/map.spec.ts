import {expect,test} from '@playwright/test';

test.use({launchOptions:{args:['--enable-unsafe-swiftshader']}});
test('map selection fills coordinates while using only test tiles',async({page})=>{
  const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
  await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({
    status:200,contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'},body:tile,
  }));
  await page.goto('/find');
  await page.getByRole('button',{name:'Open map to select a point'}).click();
  const canvas=page.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  await canvas.click();
  await expect(page.getByLabel('Latitude')).toHaveValue(/10\.\d+/);
  await expect(page.getByLabel('Longitude')).toHaveValue(/7\.\d+/);
});
