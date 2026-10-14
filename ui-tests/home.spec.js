import {test,expect} from '@playwright/test';
import {startAccountDemo} from '../examples/account-demo.js';
import {openDatabase} from '../src/storage/database.js';
import {USERS} from '../test/helpers/account-store.js';
let demo;
test.use({serviceWorkers:'block'});
test.beforeEach(async()=>{demo=await startAccountDemo({apiPort:0,webPort:0});});
test.afterEach(async()=>{await demo.close();});

test('Inicio: resumen real, lectura sin duplicar, filtros útiles y novedades agrupadas',async({page})=>{
  await page.route('**/api/updates',route=>route.fulfill({json:[{id:3,serie_id:1,source:'qa-local',chapter_title:'Capítulo 3',numero:3,first_seen_at:Date.now()},{id:2,serie_id:1,source:'qa-local',chapter_title:'Capítulo 2',numero:2,first_seen_at:Date.now()}]}));
  await page.goto(demo.web+'#home');
  await expect(page.locator('#home-total-count')).toHaveText('1');await expect(page.locator('#home-reading-count')).toHaveText('1');
  await expect(page.locator('#home-unread-count')).toHaveText('1');await expect(page.locator('#home-recent')).toBeHidden();
  await expect(page.locator('#home-news-count')).toContainText('1 obra');await expect(page.locator('#updates-list .home-update')).toHaveCount(1);
  await expect(page.locator('#updates-list')).toContainText('2 nuevos');
  await page.getByRole('button',{name:'Leer Capítulo 2 de Historia de prueba',exact:true}).click();await expect(page.locator('#chapter-title')).toHaveText('Capítulo 2');
  await page.locator('#reader-library').click();await page.locator('#show-home').click();
  await page.locator('[data-home-library="unread"]').click();await expect(page.locator('#saved-panel')).toBeVisible();await expect(page.locator('#only-unread')).toBeChecked();
  await page.locator('#show-home').click();await page.locator('[data-home-library="planned"]').first().click();await expect(page.locator('#reading-filter')).toHaveValue('planned');await expect(page.locator('#only-unread')).not.toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Inicio vacío guía los primeros pasos y un fallo de novedades conserva la biblioteca',async({page})=>{
  await page.goto(demo.web+'?qa_user=b#home');await expect(page.locator('#home-start-guide')).toBeVisible();await expect(page.locator('#home-content')).toBeHidden();
  await page.getByRole('button',{name:'Buscar un título ↗',exact:true}).click();await expect(page.locator('#search-panel')).toBeVisible();
  await page.route('**/api/updates',route=>route.fulfill({status:503,json:{error:{message:'Catálogo temporalmente no disponible'}}}));
  await page.goto(demo.web+'?qa_user=a#home');await expect(page.locator('#hero-title')).toHaveText('Historia de prueba');
  await expect(page.locator('#home-total-count')).toHaveText('1');await expect(page.locator('#home-news-empty-title')).toHaveText('No pudimos consultar las novedades');
  await page.locator('#sync-library').click();await expect(page.locator('#updates-status')).toContainText('1 series actualizadas');
  await expect(page.locator('#sync-library')).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Inicio muestra historias por empezar y permite abrir su ficha',async({page})=>{
  const entry=demo.state.states.get(USERS.a.id),db=openDatabase(':memory:');db.restoreState(entry.state);
  const saved=db.saveFavorite({source:'qa-local',titulo:'Una historia pendiente',url_origen:demo.api+'/qa/otra',portada:demo.api+'/qa/image.png'});
  db.saveChapters(saved.id,[{title:'Capítulo 1',number:1,url:demo.api+'/qa/chapter/1'}]);
  demo.state.states.set(USERS.a.id,{...entry,state:db.exportState()});db.close();
  await page.goto(demo.web+'#home');await expect(page.locator('#home-total-count')).toHaveText('2');await expect(page.locator('#home-planned-count')).toHaveText('1');
  await expect(page.locator('#home-planned-grid .series-card')).toHaveCount(1);
  await page.getByRole('button',{name:'Elegir Una historia pendiente',exact:true}).click();await expect(page.locator('#picked-title')).toHaveText('Una historia pendiente');
  await expect(page.locator('#chapter-browser .chapter-row')).toHaveCount(1);
  await page.locator('#chapter-controls').press('Escape');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
