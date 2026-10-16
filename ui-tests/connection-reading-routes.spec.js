import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {startAccountDemo} from '../examples/account-demo.js';
let demo;
test.use({serviceWorkers:'block'});
test.beforeEach(async()=>{demo=await startAccountDemo({apiPort:0,webPort:0});});
test.afterEach(async()=>{await demo.close();});

test('conexión anticipada visible, sin credenciales, y semáforo según consultas reales',async({page})=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});let ping;
  await page.route('**/api/health',async route=>{ping=route.request();await gate;await route.fulfill({json:{ok:true},headers:{'Access-Control-Allow-Origin':new URL(demo.web).origin}});});
  await page.goto(demo.web+'?qa_user=b#home');await expect(page.locator('#home-panel')).toBeVisible();
  await expect(page.locator('#catalog-connection-label')).toHaveText('Despertando catálogos…');
  expect(ping.headers().authorization).toBeUndefined();expect(ping.headers()['x-private-token']).toBeUndefined();
  release();await expect(page.locator('#catalog-connection-label')).toHaveText('Catálogos en línea');
  await page.locator('#recommend-warnings > summary').click();
  await expect(page.locator('#catalog-source-status')).toContainText('Disponible · sin consultar');
  await page.locator('#show-home').click();await page.getByRole('button',{name:'Buscar un título ↗',exact:true}).click();
  await page.locator('#search-source').selectOption('qa-local');
  await page.locator('#search-query').fill('Historia');await page.locator('#search-submit').click();
  await expect(page.locator('#catalog-source-status li[data-state="ok"]')).toContainText('Fuente de prueba');
  await page.route('**/api/sources/qa-local/search?**',route=>route.fulfill({status:503,json:{error:{message:'Fallo simulado'}},headers:{'Access-Control-Allow-Origin':new URL(demo.web).origin}}));
  await page.locator('#search-submit').click();await expect(page.locator('#catalog-source-status li[data-state="error"]')).toContainText('Última consulta fallida');
});

test('conexión fallida permite reintentar sin recargar ni perder la vista',async({page})=>{
  let attempts=0;
  await page.route('**/api/health',route=>route.fulfill({status:++attempts===1?503:200,json:{ok:attempts>1},headers:{'Access-Control-Allow-Origin':new URL(demo.web).origin}}));
  await page.goto(demo.web+'#home');await expect(page.locator('#catalog-connection-label')).toHaveText('No se pudo conectar con los catálogos');
  await page.locator('#recommend-warnings > summary').click();await page.getByRole('button',{name:'Reintentar conexión',exact:true}).click();
  await expect(page.locator('#catalog-connection-label')).toHaveText('Catálogos en línea');await expect(page.locator('#home-panel')).toBeVisible();expect(attempts).toBe(2);
});

test('chips visibles, enlace compartido, recarga y Atrás/Adelante restauran los filtros',async({page})=>{
  await page.goto(demo.web+'?qa_user=a#library?status=reading&source=qa-local');
  const chips=page.getByRole('group',{name:'Estado de lectura',exact:true});
  await expect(page.locator('#series-grid .series-card')).toHaveCount(1);await expect(chips).toBeVisible();
  await expect(chips.getByRole('button',{name:'Leyendo',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.library-options').filter({has:page.locator('#source-filter')})).not.toHaveAttribute('open','');
  await chips.getByRole('button',{name:'Pendiente',exact:true}).click();await expect(page).toHaveURL(/#library\?status=planned&source=qa-local$/);await expect(page.locator('#series-grid .series-card')).toHaveCount(0);
  await page.goBack();await expect(page.locator('#reading-filter')).toHaveValue('reading');await expect(page.locator('#series-grid .series-card')).toHaveCount(1);
  await page.goForward();await expect(page.locator('#reading-filter')).toHaveValue('planned');await expect(page.locator('#series-grid .series-card')).toHaveCount(0);
  await page.reload();await expect(page.locator('#reading-filter')).toHaveValue('planned');await expect(page.locator('#source-filter')).toHaveValue('qa-local');
  await chips.getByRole('button',{name:'Leyendo',exact:true}).click();await page.locator('#library-query').fill('Historia');await expect(page).toHaveURL(/q=Historia/);
  await page.locator('#show-settings').click();await page.goBack();await expect(page.locator('#library-query')).toHaveValue('Historia');
  await expect(page.locator('#series-grid .series-card')).toHaveCount(1);expect(new URL(page.url()).searchParams.get('qa_user')).toBe('a');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('lector de 60 páginas: precarga acotada, dos reintentos automáticos y recuperación manual',async({page})=>{
  const png=await readFile(new URL('../test/fixtures/reader-1.png',import.meta.url)),attempts=new Map();
  await page.route('**/api/chapters/*/images',async route=>{
    const response=await route.fetch(),data=await response.json();data.images=Array.from({length:60},(_,index)=>({index,url:'/api/image?ticket=qa-page-'+index}));await route.fulfill({response,json:data});
  });
  await page.route('**/api/image?ticket=qa-page-*',async route=>{
    const index=Number(new URL(route.request().url()).searchParams.get('ticket').split('-').at(-1)),attempt=(attempts.get(index)??0)+1;attempts.set(index,attempt);
    await route.fulfill({status:index===0&&attempt<=3?503:200,body:index===0&&attempt<=3?'temporal':png,contentType:index===0&&attempt<=3?'text/plain':'image/png',headers:{'Access-Control-Allow-Origin':new URL(demo.web).origin}});
  });
  await page.goto(demo.web+'?chapter=1');await expect(page.locator('#pages .page-slot')).toHaveCount(60);
  const first=page.locator('#pages .page-slot').first();await expect(first).toHaveAttribute('data-state','error',{timeout:15000});
  expect(attempts.get(0)).toBe(3);expect(Math.max(...attempts.keys())).toBeLessThanOrEqual(3);
  await first.getByRole('button',{name:'Reintentar página 1',exact:true}).click();await expect(first).toHaveAttribute('data-state','loaded');expect(attempts.get(0)).toBe(4);
  await page.locator('#pages .page-slot').nth(12).scrollIntoViewIfNeeded();await expect(page.locator('#pages .page-slot').nth(12)).toHaveAttribute('data-state','loaded');
  await expect(page.locator('#pages .page-slot').nth(59).locator('img')).not.toHaveAttribute('src',/.+/);
  const toggle=page.getByRole('button',{name:'Controles',exact:true});if(await toggle.isVisible())await toggle.click();await page.locator('#reader-close').click();await expect(page.locator('#pages .page-slot')).toHaveCount(0);
});
