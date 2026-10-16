import {test,expect} from '@playwright/test';
import {startAccountDemo} from '../examples/account-demo.js';
let demo;
test.use({serviceWorkers:'block'});
test.beforeEach(async()=>{demo=await startAccountDemo({apiPort:0,webPort:0});});
test.afterEach(async()=>{await demo.close();});
test('inicio estático oculta vistas y diálogos antes de ejecutar la aplicación',async({page})=>{
  await page.route('**/reader.js',route=>route.abort());
  await page.goto(demo.web+'#home');
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.locator('#startup-status')).toBeVisible();
  for(const id of ['library','saved-panel','reader','account-private-dialog','vault-recovery-dialog'])await expect(page.locator('#'+id)).toBeHidden();
});
test('saltar al contenido enfoca la vista actual sin navegar ni cambiar el hash',async({page})=>{
  await page.goto(demo.web+'#home');await expect(page.locator('#home-panel')).toBeVisible();
  for(const [button,panel,hash] of [['show-home','home-panel','#home'],['show-settings','settings-panel','#settings']]){
    await page.locator('#'+button).click();await expect(page.locator('#'+panel)).toBeVisible();
    await page.locator('.skip-link').focus();await page.locator('.skip-link').press('Enter');
    await expect(page.locator('#'+panel)).toBeFocused();expect(new URL(page.url()).hash).toBe(hash);
  }
  await page.locator('#show-home').click();await page.locator('#hero-action').click();await expect(page.locator('#reader')).toBeVisible();
  await expect(page).toHaveURL(/\?chapter=2$/);
  const url=page.url();await page.locator('.skip-link').focus();await page.locator('.skip-link').press('Enter');
  await expect(page.locator('#reader')).toBeFocused();expect(page.url()).toBe(url);
});
