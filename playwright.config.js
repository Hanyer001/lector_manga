import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./ui-tests',timeout:30000,fullyParallel:false,workers:1,
  reporter:'list',use:{trace:'retain-on-failure'},
  projects:[
    {name:'Escritorio Chromium',use:{...devices['Desktop Chrome']}},
    {name:'iPhone WebKit',use:{...devices['iPhone 13'],browserName:'webkit'}}
  ]
});
