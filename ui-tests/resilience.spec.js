import {test,expect} from '@playwright/test';
import {startAccountDemo} from '../examples/account-demo.js';
let demo;
test.use({serviceWorkers:'block'});
test.beforeEach(async()=>{demo=await startAccountDemo({apiPort:0,webPort:0,alternatives:true});});
test.afterEach(async()=>{await demo.close();});

test('módulo bloqueado: aviso, navegación liberada y reintento sin borrar datos',async({page})=>{
  await page.route('**/reader.js',route=>route.abort());await page.goto(demo.web+'#home');
  const target=await page.locator('.skip-link').getAttribute('href');await expect(page.locator(target)).toHaveCount(1);
  expect(await page.locator('dialog').evaluateAll(rows=>rows.every(row=>row.hidden&&row.children.length>0))).toBe(true);
  await expect(page.locator('#startup-retry')).toBeVisible({timeout:12000});await expect(page.locator('.library-tabs')).not.toHaveAttribute('inert','');
  await page.locator('#show-settings').click();await expect(page.locator('#settings-panel')).toBeVisible();
  await page.unroute('**/reader.js');await page.locator('#startup-retry').click();
  await expect(page.locator('#settings-panel')).toBeVisible();await expect(page.locator('#startup-retry')).toBeHidden();
  await page.locator('#show-saved').click();await expect(page.locator('#series-grid .series-card')).toHaveCount(1);
});

test('arranque lento se recupera cuando responde la biblioteca',async({page})=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/series',async route=>{await gate;await route.continue();});
  await page.goto(demo.web+'#home');await expect(page.locator('#startup-retry')).toBeVisible({timeout:12000});
  await page.locator('#show-settings').click();await expect(page.locator('#settings-panel')).toBeVisible();
  release();await expect(page.locator('#startup-retry')).toBeHidden();await expect(page.locator('#settings-panel')).toBeVisible();
  await page.locator('#show-saved').click();await expect(page.locator('#series-grid .series-card')).toHaveCount(1);
});

test('una fuente lenta no oculta resultados y el aviso +18 sigue la selección real',async({page})=>{
  await page.route('**/api/sources',async route=>{const response=await route.fetch(),data=await response.json();for(const source of data)source.capabilities.adult=true;await route.fulfill({response,json:data});});
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/sources/qa-alt/search?**',async route=>{await gate;await route.fulfill({status:503,json:{error:{message:'Fallo de fuente simulado'}},headers:{'Access-Control-Allow-Origin':new URL(demo.web).origin}});});
  await page.goto(demo.web+'#home');await page.getByRole('button',{name:'Buscar un manga',exact:true}).click();
  await page.locator('#search-source').selectOption('all');await page.locator('#search-query').fill('Historia');await page.locator('#search-submit').click();
  await expect(page.locator('#search-results .series-card')).toHaveCount(1);await expect(page.locator('#search-status')).toContainText('1 fuente pendiente');
  await expect(page.locator('#catalog-source-status li[data-state="loading"]')).toContainText('Otra fuente de prueba');
  release();await expect(page.locator('#search-status')).toContainText('1 fuente con error');await expect(page.locator('#search-results .series-card')).toHaveCount(1);
  await page.locator('#search-query').fill('');await page.locator('#search-genre').selectOption('adult');
  await expect(page.locator('#search-genre-note')).toContainText('Otra fuente de prueba');
  await page.locator('#source-hub input[value="qa-local"]').check();await expect(page.locator('#search-genre-note')).toContainText('Fuente de prueba');await expect(page.locator('#search-genre-note')).not.toContainText('Otra fuente de prueba');
  await page.locator('#source-hub input[value="qa-local"]').uncheck();await expect(page.locator('#search-genre-note')).toContainText('Ninguna');
});

test('Atrás desde el lector conserva filtros y Adelante recupera el capítulo',async({page})=>{
  await page.goto(demo.web+'#library?status=reading&source=qa-local&q=Historia');
  await page.getByRole('button',{name:'Continuar Historia de prueba',exact:true}).click();await expect(page.locator('#chapter-title')).toHaveText('Capítulo 2');
  await page.goBack();await expect(page.locator('#saved-panel')).toBeVisible();await expect(page.locator('#library-query')).toHaveValue('Historia');await expect(page.locator('#reading-filter')).toHaveValue('reading');await expect(page.locator('#source-filter')).toHaveValue('qa-local');
  await expect(page).toHaveURL(/#library\?status=reading&source=qa-local&q=Historia$/);
  await page.goForward();await expect(page.locator('#reader')).toBeVisible();await expect(page.locator('#chapter-title')).toHaveText('Capítulo 2');
});
