import {test,expect} from '@playwright/test';
import {startAccountDemo} from '../examples/account-demo.js';
let demo;
test.beforeAll(async()=>{demo=await startAccountDemo({apiPort:0,webPort:0});});
test.afterAll(async()=>{await demo.close();});

test('biblioteca: ficha, búsqueda por capítulo y lectura directa bajo /lector_manga/',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(demo.web+'#library');
  await expect(page.locator('#series-grid .library-progress')).toBeVisible();
  await page.getByRole('button',{name:'Elegir Historia de prueba',exact:true}).click();
  await expect(page.locator('#picked-tags')).toContainText('Acción');
  await page.getByRole('searchbox',{name:'Buscar capítulo',exact:true}).fill('2');
  await expect(page.locator('#chapter-browser .chapter-row')).toHaveCount(1);
  await page.locator('#chapter-browser .chapter-row').click();
  await expect(page.locator('#chapter-title')).toHaveText('Capítulo 2');
  expect(errors).toEqual([]);
});

test('biblioteca vacía: bienvenida útil y navegación móvil de cinco accesos',async({page})=>{
  await page.goto(demo.web+'?qa_user=b#home');
  await expect(page.getByRole('heading',{name:'Empieza una biblioteca a tu medida.',exact:true})).toBeVisible();
  if(page.viewportSize().width<=768){
    await expect(page.locator('.library-tabs > button:visible')).toHaveCount(5);
    await page.locator('#show-settings').click();
    await expect(page.locator('#settings-panel')).toBeVisible();
    await page.locator('#show-private').click();
    await expect(page.locator('#private-gate')).toBeVisible();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Descubrir: controles compactos, vista previa y leer sin guardar',async({page})=>{
  await page.goto(demo.web+'?qa_user=b#discover');
  await expect(page.locator('#recommend-results .series-choice').first()).toBeVisible();
  await expect(page.locator('#rec-result-query')).toBeHidden();
  await page.locator('#recommend-results .series-choice').first().click();
  await expect(page.locator('[data-save]')).toHaveText('Guardar en biblioteca');
  await page.getByRole('button',{name:'Leer primer capítulo',exact:true}).click();
  await expect(page.locator('#chapter-title')).toHaveText('Capítulo 1');
  await expect(page.locator('#save-status')).toContainText('Lectura de prueba');
  const controls=page.getByRole('button',{name:'Controles',exact:true});
  if(await controls.isVisible())await controls.click();
  await page.locator('#reader-close').click();
  await page.locator('#show-saved').click();
  await expect(page.locator('#series-grid .series-card')).toHaveCount(0);
});
