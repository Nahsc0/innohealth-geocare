import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',workers:1,reporter:'list',
  globalSetup:'./tests/e2e/global-setup.ts',
  use:{baseURL:'http://localhost:3000',trace:'retain-on-failure'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},
    {name:'mobile',use:{...devices['iPhone 13'],browserName:'chromium'}}],
  webServer:{command:process.env.GEOCARE_BUILD_TEST==='1'?'npm run start':'npm run dev',url:'http://localhost:3000',reuseExistingServer:!process.env.CI,timeout:90000},
});
