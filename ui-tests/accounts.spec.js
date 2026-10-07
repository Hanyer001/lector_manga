import { test, expect } from '@playwright/test';
import { startAccountDemo } from '../examples/account-demo.js';
import {createVaultEncryption} from '../src/frontend/vault-crypto.js';
import {openDatabase} from '../src/storage/database.js';
import {USERS} from '../test/helpers/account-store.js';
let demo;

test('OLED: navegación adaptable, tarjetas sobre portada y acento persistente',async({page},testInfo)=>{
  await page.goto(demo.web);await expect(page.locator('#add-toggle')).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-theme','oled');
  await page.locator('#show-saved').click();
  const layout=await page.evaluate(()=>{const nav=document.querySelector('.library-tabs').getBoundingClientRect(),card=document.querySelector('#series-grid .series-card'),caption=card.querySelector('.series-caption');return {width:innerWidth,bottom:nav.bottom,left:nav.left,navWidth:nav.width,background:getComputedStyle(document.body).backgroundColor,captionPosition:getComputedStyle(caption).position,border:getComputedStyle(card).borderTopWidth,overflow:document.documentElement.scrollWidth>innerWidth};});
  expect(layout.background).toBe('rgb(0, 0, 0)');expect(layout.border).toBe('0px');expect(layout.captionPosition).toBe('absolute');expect(layout.overflow).toBe(false);
  if(layout.width<=768)expect(layout.navWidth).toBeGreaterThan(300);else expect(layout.navWidth).toBeLessThan(250);
  await page.locator('#show-settings').click();await page.locator('#appearance-theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.locator('#appearance-theme').selectOption('oled');await page.locator('#appearance-accent').selectOption('cyan');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','oled');
  expect(await page.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent-color').trim().toLowerCase())).toBe('#22d3ee');
});

test('lector inmersivo: zonas superior, central e inferior y ancho máximo',async({page})=>{
  const isolated=await startAccountDemo({apiPort:0,webPort:0});
  try{
    await page.goto(isolated.web);await expect(page.locator('#add-toggle')).toBeEnabled();
    await page.getByRole('button',{name:'Continuar Historia de prueba',exact:true}).first().click();
    await expect(page.locator('#page-position')).toContainText('Imagen 2 de 6');
    await page.locator('#reader-options-toggle').click();await page.locator('#reading-mode').selectOption('paged');
    await page.locator('#focus-toggle').click();await expect(page.locator('#reader-overlay')).toBeHidden();
    await page.locator('[data-reader-tap="next"]').click();await expect(page.locator('#page-position')).toContainText('Imagen 3 de 6');
    await page.locator('[data-reader-tap="previous"]').click();await expect(page.locator('#page-position')).toContainText('Imagen 2 de 6');
    await page.locator('[data-reader-tap="toggle"]').press('Enter');await expect(page.locator('#reader-overlay')).toBeVisible();
    const style=await page.locator('#reader').evaluate(el=>({width:el.getBoundingClientRect().width,background:getComputedStyle(document.body).backgroundColor}));
    expect(style.width).toBeLessThanOrEqual(800);expect(style.background).toBe('rgb(0, 0, 0)');
    await page.locator('#reading-zoom').press('End');
    await expect(page.locator('#reader-tap-zones')).toBeHidden();
  }finally{await isolated.close();}
});
test.beforeAll(async()=>{demo=await startAccountDemo({apiPort:0,webPort:0});});
test.afterAll(async()=>{await demo.close();});
test('Pages con subcarpeta: cuenta, biblioteca, controles de lectura y ancla',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(demo.web);
  await page.getByRole('button',{name:'Cuenta y sincronización',exact:true}).click();
  await expect(page.locator('#account-email')).toHaveText('a@example.test');
  await expect(page.getByRole('button',{name:'Exportar biblioteca',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Biblioteca',exact:true}).click();
  await expect(page.getByRole('button',{name:'Elegir Historia de prueba',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Continuar Historia de prueba',exact:true}).click();
  await expect(page.locator('#page-position')).toContainText('Imagen 2 de 6');
  await page.locator('#reader-options-toggle').click();
  await page.locator('#reading-mode').selectOption('paged');
  await expect(page.locator('#page-forward')).toBeEnabled();
  await page.locator('#page-forward').click();
  await expect(page.locator('#page-position')).toContainText('Imagen 3 de 6');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('importa un respaldo privado de otra cuenta con recuperación y mantiene su posición',async({page})=>{
  const isolated=await startAccountDemo({apiPort:0,webPort:0});
  const password='Contraseña de destino ficticia y extensa 82',sourcePassword='Contraseña de origen ficticia y extensa 63';
  const state=structuredClone(isolated.state.states.get(USERS.a.id).state);
  const encrypted=await createVaultEncryption(state,sourcePassword,USERS.a.id),empty=openDatabase(':memory:');
  const backup={...empty.exportLibrary(),version:2,includesPrivate:true,privateVault:{owner:USERS.a.id,envelope:encrypted.envelope}};empty.close();
  try{
    await page.goto(isolated.web+'?qa_user=b');
    await page.getByRole('button',{name:'Cuenta y sincronización',exact:true}).click();
    await page.locator('#account-import-file').setInputFiles({name:'respaldo-ficticio.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await expect(page.locator('#account-private-dialog')).toBeVisible();
    await page.locator('#account-private-pin').fill(password);await page.locator('#account-private-confirm').fill(password);
    await page.locator('#account-private-submit').click();await expect(page.locator('#vault-recovery-dialog')).toBeVisible();
    await page.getByRole('button',{name:'Ya guardé mi clave',exact:true}).click();
    await expect(page.locator('#account-private-title')).toHaveText('Desbloquea el archivo cifrado');
    await page.locator('#account-private-pin').fill(encrypted.recoveryKey);await page.locator('#account-private-recovery').check();
    await page.locator('#account-private-submit').click();await expect(page.locator('#account-status')).toContainText('Importación completada');
    await page.getByRole('button',{name:'Privada',exact:true}).click();await page.locator('#private-pin').fill(password);
    await page.getByRole('button',{name:'Desbloquear',exact:true}).click();
    await page.locator('#private-library').getByRole('button',{name:'Continuar Historia de prueba',exact:true}).click();
    await expect(page.locator('#page-position')).toContainText('Imagen 2 de 6');
  }finally{encrypted.rawKey.fill(0);await isolated.close();}
});
test('sin sesión usa biblioteca del dispositivo; otra cuenta empieza vacía',async({page})=>{
  await page.goto(demo.web+'?qa_user=none');
  await expect(page.locator('#account-gate')).toBeHidden();
  await page.getByRole('button',{name:'Biblioteca',exact:true}).click();
  await expect(page.locator('#series-grid')).not.toContainText('Historia de prueba');
  await page.goto(demo.web+'?qa_user=b');
  await page.getByRole('button',{name:'Biblioteca',exact:true}).click();
  await expect(page.locator('#series-grid')).not.toContainText('Historia de prueba');
});

test('el correo solicita un enlace y mantiene la biblioteca oculta hasta verificar la sesión',async({page})=>{
  await page.goto(demo.web+'?qa_user=none');
  await page.getByRole('button',{name:'Cuenta y sincronización',exact:true}).click();
  await page.getByRole('button',{name:'Acceder con correo',exact:true}).click();
  await page.getByRole('textbox',{name:'Tu correo',exact:true}).fill('reader@example.test');
  await page.getByRole('button',{name:'Recibir enlace de acceso',exact:true}).click();
  await expect(page.locator('#account-gate-status')).toContainText('Revisa tu correo');
  await expect(page.locator('#account-gate-signin')).toBeDisabled();
  await expect(page.locator('#library')).toBeHidden();
});

test('bóveda E2EE: entrega recuperación, conserva el ancla y elimina los datos visibles al bloquear',async({page})=>{
  const isolated=await startAccountDemo({apiPort:0,webPort:0}),requests=[];
  const password='Una contraseña ficticia para comprobar cifrado 75';
  page.on('request',request=>{if(request.url().startsWith(isolated.api))requests.push(request.postData()??'');});
  try{
    await page.goto(isolated.web);
    await page.getByRole('button',{name:'Elegir Historia de prueba',exact:true}).click();
    await page.getByRole('button',{name:'Mover a privada',exact:true}).click();
    await page.getByRole('textbox',{name:'Contraseña de cifrado',exact:true}).fill(password);
    await page.getByRole('textbox',{name:'Repite tu contraseña',exact:true}).fill(password);
    await page.getByRole('button',{name:'Crear bóveda cifrada',exact:true}).click();
    await expect(page.locator('#vault-recovery-dialog')).toBeVisible();
    const recovery=await page.locator('#vault-recovery-key').inputValue();expect(recovery).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await page.getByRole('button',{name:'Ya guardé mi clave',exact:true}).click();
    await expect(page.locator('#private-library').getByRole('button',{name:'Elegir Historia de prueba',exact:true})).toBeVisible();
    expect(JSON.stringify([...isolated.state.states.values()])).not.toContain('Historia de prueba');
    expect(JSON.stringify([...isolated.state.vaults.values()])).not.toContain('Historia de prueba');
    expect(requests.join('\n')).not.toContain(password);expect(requests.join('\n')).not.toContain(recovery);
    await page.locator('#show-settings').click();
    await expect(page.locator('#private-idle-minutes')).toHaveValue('30');await expect(page.locator('#private-background-minutes')).toHaveValue('2');
    await page.locator('#private-idle-minutes').selectOption('60');await page.locator('#private-background-minutes').selectOption('5');
    await expect(page.locator('#private-settings-lock')).toBeEnabled();
    await page.locator('#show-saved').click();await expect(page.locator('#saved-panel')).not.toContainText('Historia de prueba');
    await page.locator('#show-private').click();await expect(page.locator('#private-gate')).toBeHidden();
    await expect(page.locator('#private-library').getByRole('button',{name:'Elegir Historia de prueba',exact:true})).toBeVisible();
    await page.locator('#private-library').getByRole('button',{name:'Continuar Historia de prueba',exact:true}).click();
    await expect(page.locator('#page-position')).toContainText('Imagen 2 de 6');
    await expect(page.locator('#pages')).toHaveAttribute('aria-busy','false');
    const controlsVisible=await page.locator('#reader-overlay').isVisible();
    await page.locator('#reader').press('c');
    if(controlsVisible){await expect(page.locator('#reader-overlay')).toBeHidden();await page.locator('#exit-focus').click();}
    else await expect(page.locator('#reader-overlay')).toBeVisible();
    await page.locator('#reader-library').click();
    await page.getByRole('button',{name:'Bloquear ahora',exact:true}).click();
    await expect(page.locator('#private-gate')).toBeVisible();
    await expect(page.locator('#private-library')).toBeEmpty();
    await expect(page.locator('#vault-recovery-key')).toHaveValue('');
    await expect(page.locator('body')).not.toContainText('Historia de prueba');
    await page.getByRole('textbox',{name:'Contraseña de cifrado',exact:true}).fill(recovery);
    await page.getByRole('checkbox',{name:'Usar mi clave de recuperación',exact:true}).check();
    await page.getByRole('button',{name:'Desbloquear',exact:true}).click();
    await expect(page.locator('#private-library').getByRole('button',{name:'Elegir Historia de prueba',exact:true})).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await isolated.close();}
});


test('bóveda: pausa breve conserva la sesión, plazo vencido bloquea y recargar conserva solo los tiempos',async({page})=>{
  const isolated=await startAccountDemo({apiPort:0,webPort:0}),password='Contraseña ficticia para la prueba de sesión 93';
  try{
    await page.clock.install();await page.goto(isolated.web+'?qa_user=none');await page.locator('#show-private').click();
    await page.getByRole('textbox',{name:'Contraseña de cifrado',exact:true}).fill(password);await page.getByRole('textbox',{name:'Repite tu contraseña',exact:true}).fill(password);
    await page.getByRole('button',{name:'Crear bóveda cifrada',exact:true}).click();await page.getByRole('button',{name:'Ya guardé mi clave',exact:true}).click();
    await expect(page.locator('#private-gate')).toBeHidden();
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await expect(page.locator('body')).toHaveClass(/vault-background-hidden/);await page.clock.fastForward(60000);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
    await expect(page.locator('body')).not.toHaveClass(/vault-background-hidden/);await expect(page.locator('#private-gate')).toBeHidden();
    await page.locator('#show-settings').click();await page.locator('#private-background-minutes').selectOption('1');await page.locator('#private-idle-minutes').selectOption('15');await page.locator('#show-private').click();
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.fastForward(61000);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.locator('#private-gate')).toBeVisible();
    await page.getByRole('textbox',{name:'Contraseña de cifrado',exact:true}).fill(password);await page.getByRole('button',{name:'Desbloquear',exact:true}).click();await expect(page.locator('#private-gate')).toBeHidden();
    await page.reload();await expect(page.locator('#private-gate')).toBeVisible();await page.locator('#show-settings').click();await expect(page.locator('#private-background-minutes')).toHaveValue('1');await expect(page.locator('#private-idle-minutes')).toHaveValue('15');await expect(page.locator('#private-settings-lock')).toBeDisabled();
  }finally{await isolated.close();}
});

test('invitado: guarda lectura local, conserva ancla y permite volver sin cuenta',async({page})=>{
  const localDemo=await startAccountDemo({apiPort:0,webPort:0});
  try{
  await page.goto(localDemo.web+'?qa_user=none');
  await page.locator('#add-toggle').click();await page.locator('#series-url').fill(localDemo.api+'/qa/manga');
  await page.locator('#add-series').click();await expect(page.locator('#chapter-controls')).toBeVisible();
  await expect(page.locator('#chapter-select')).toBeEnabled();await page.locator('#chapter-select').selectOption({index:2});
  await page.locator('#open-chapter').click();await expect(page.locator('#pages')).toHaveAttribute('aria-busy','false');
  await page.locator('#reader-options-toggle').click();await page.locator('#reading-mode').selectOption('paged');
  await page.locator('#page-forward').click();await page.locator('#page-forward').click();
  await expect(page.locator('#page-position')).toContainText('Imagen 3 de 6');
  await expect(page.locator('#save-status')).toContainText('Guardado en este dispositivo');
  await page.reload();await expect(page.locator('#page-position')).toContainText('Imagen 3 de 6');
  await page.locator('#reader-library').click();await page.getByRole('button',{name:'Cuenta y sincronización',exact:true}).click();
  await expect(page.locator('#account-email')).toContainText('sin cuenta');
  await page.goto(localDemo.web+'?qa_user=b');await page.getByRole('button',{name:'Cuenta y sincronización',exact:true}).click();
  await page.locator('#account-device-import').click();await expect(page.locator('#account-status')).toContainText('La copia local se conserva');
  await page.getByRole('button',{name:'Biblioteca',exact:true}).click();await expect(page.locator('#series-grid')).toContainText('Historia de prueba');
  }finally{await localDemo.close();}
});

test('Descubrir: vista previa sin añadir y más de 24 recomendaciones',async({page})=>{
  await page.goto(demo.web+'?qa_user=b');
  await page.getByRole('button',{name:'Descubrir',exact:true}).click();
  await expect(page.locator('#recommend-results .series-card')).toHaveCount(24);
  await page.locator('#recommend-results .series-choice').first().click();
  await expect(page.locator('.series-preview')).toBeVisible();await expect(page).toHaveURL(/#discover$/);
  await page.getByRole('button',{name:'Cerrar vista previa',exact:true}).click();
  await page.locator('#recommend-more').click();await expect(page.locator('#recommend-results .series-card')).toHaveCount(36);
  await page.locator('#recommend-more').click();await expect(page.locator('#recommend-results .series-card')).toHaveCount(60);
  await page.locator('#recommend-more').click();await expect(page.locator('#recommend-results .series-card')).toHaveCount(72);
  await expect(page.locator('#recommend-more')).toBeHidden();
  await page.getByRole('button',{name:'Biblioteca',exact:true}).click();await expect(page.locator('#series-grid .series-card')).toHaveCount(0);
});

test('portadas: cambiar entre Inicio y Biblioteca reutiliza la descarga',async({page})=>{
  const requests=[];page.on('request',request=>{if(request.url().includes('/api/image?'))requests.push(request.url());});
  await page.goto(demo.web);await page.getByRole('button',{name:'Biblioteca',exact:true}).click();
  await expect(page.locator('#series-grid img').first()).toHaveAttribute('src',/^blob:/);
  const initial=requests.length;
  await page.getByRole('button',{name:'Inicio',exact:true}).click();await page.getByRole('button',{name:'Biblioteca',exact:true}).click();
  await expect(page.locator('#series-grid img').first()).toHaveAttribute('src',/^blob:/);expect(requests.length).toBe(initial);
});

test('invitado: privada cifrada persistente al recargar',async({page})=>{
  const isolated=await startAccountDemo({apiPort:0,webPort:0});
  try{
    await page.goto(isolated.web+'?qa_user=none');
    await page.locator('#add-toggle').click();await page.locator('#series-url').fill(isolated.api+'/qa/manga');await page.locator('#add-series').click();
    await expect(page.locator('#chapter-controls')).toBeVisible();
    await page.getByRole('button',{name:'Mover a privada',exact:true}).click();
    const password='Bóveda de prueba sin cuenta 958';
    await page.getByRole('textbox',{name:'Contraseña de cifrado',exact:true}).fill(password);
    await page.getByRole('textbox',{name:'Repite tu contraseña',exact:true}).fill(password);
    await page.getByRole('button',{name:'Crear bóveda cifrada',exact:true}).click();
    await page.getByRole('button',{name:'Ya guardé mi clave',exact:true}).click();
    await expect(page.locator('#private-library')).toContainText('Historia de prueba');
    const stored=await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('lector-device-v1');open.onsuccess=()=>{const db=open.result,request=db.transaction('library').objectStore('library').get('main');request.onsuccess=()=>{resolve(JSON.stringify(request.result));db.close();};request.onerror=reject;};open.onerror=reject;}));
    expect(stored).not.toContain('Historia de prueba');expect(stored).not.toContain(password);
    await page.reload();await expect(page.locator('#private-gate')).toBeVisible();
    await page.getByRole('textbox',{name:'Contraseña de cifrado',exact:true}).fill(password);await page.getByRole('button',{name:'Desbloquear',exact:true}).click();
    await expect(page.locator('#private-library')).toContainText('Historia de prueba');
  }finally{await isolated.close();}
});

test('probar una recomendación: ficha completa y lectura temporal sin favoritos ni progreso',async({page})=>{
  const isolated=await startAccountDemo({apiPort:0,webPort:0});
  try{
    const before=structuredClone(isolated.state.states.get(USERS.a.id).state.tables);
    await page.goto(isolated.web+'#discover');await expect(page.locator('#recommend-results .series-card')).toHaveCount(24);
    await page.locator('#recommend-results .series-choice').first().click();
    await expect(page.locator('[data-authors]')).toContainText('Autora de prueba');await expect(page.locator('[data-publication]')).toContainText('En emisión');
    await expect(page.locator('[data-reason]')).toContainText('POR QUÉ TE LA SUGERIMOS');
    await page.getByRole('button',{name:'Consultar capítulos',exact:true}).click();await expect(page.locator('[data-chapter-select] option')).toHaveCount(3);
    await page.getByRole('button',{name:'Leer sin guardar',exact:true}).click();await expect(page.locator('#chapter-title')).toHaveText('Capítulo 1');
    await expect(page.locator('#save-status')).toContainText('Lectura de prueba');await expect(page.locator('#reader-mark')).toBeHidden();
    await page.locator('#next-chapter').click();await expect(page.locator('#chapter-title')).toHaveText('Capítulo 2');
    await page.locator('#reader-close').click();await expect(page).toHaveURL(/#discover$/);
    const after=isolated.state.states.get(USERS.a.id).state.tables;expect(after.Series).toEqual(before.Series);expect(after.Chapters).toEqual(before.Chapters);expect(after.Progress).toEqual(before.Progress);
    await page.reload();await expect(page.locator('#library')).toBeVisible();await expect(page.locator('#pages .page-slot')).toHaveCount(0);
  }finally{await isolated.close();}
});

test('Solo nuevas: recuerda fichas entre sesiones, permite recuperarlas y no cambia la biblioteca',async({page})=>{
  const isolated=await startAccountDemo({apiPort:0,webPort:0});
  try{
    await page.goto(isolated.web+'?qa_user=b#discover');await expect(page.locator('#recommend-results .series-card')).toHaveCount(24);
    const choice=page.locator('#recommend-results .series-choice').first(),label=await choice.getAttribute('aria-label');await choice.click();
    await expect(page.locator('#rec-seen-status')).toContainText('Ficha recordada');await page.getByRole('button',{name:'Cerrar vista previa',exact:true}).click();
    await page.locator('#rec-only-new').check();await expect(page.getByRole('button',{name:label,exact:true})).toHaveCount(0);
    await page.reload();await expect(page.locator('#rec-only-new')).toBeChecked();await expect(page.locator('#recommend-results .series-card')).toHaveCount(24);await expect(page.getByRole('button',{name:label,exact:true})).toHaveCount(0);
    await page.locator('#rec-reset-seen').click();await expect(page.locator('#rec-seen-status')).toContainText('Historial de vistas reiniciado');await expect(page.getByRole('button',{name:label,exact:true})).toBeVisible();
    await page.locator('#show-saved').click();await expect(page.locator('#series-grid .series-card')).toHaveCount(0);
  }finally{await isolated.close();}
});

test('fuente caída: ofrece alternativas y exige confirmar el capítulo antes de probar otra edición',async({page})=>{
  const isolated=await startAccountDemo({apiPort:0,webPort:0,alternatives:true});
  try{
    isolated.faults.images=true;
    await page.goto(isolated.web);await expect(page.locator('#add-toggle')).toBeEnabled();await page.getByRole('button',{name:'Continuar Historia de prueba',exact:true}).first().click();
    await expect(page.locator('#reader-failed-alternatives')).toBeVisible();await page.locator('#reader-failed-alternatives').click();
    await expect(page.locator('.alternative-list')).toContainText('Otra fuente de prueba');await page.getByRole('button',{name:'Comprobar ficha',exact:true}).click();
    await page.getByRole('button',{name:'Consultar capítulos',exact:true}).click();await expect(page.locator('[data-read]')).toBeDisabled();
    await expect(page.locator('[data-chapter-note]')).toContainText('Comprueba');await page.locator('[data-confirm]').check();await expect(page.locator('[data-read]')).toBeEnabled();
    await page.locator('[data-read]').click();await expect(page.locator('#save-status')).toContainText('Lectura de prueba');
    expect(isolated.state.states.get(USERS.a.id).state.tables.Series).toHaveLength(1);
  }finally{await isolated.close();}
});

test('guardado transparente: muestra capítulo e imagen y permite reintentar un fallo confirmado',async({page})=>{
  const isolated=await startAccountDemo({apiPort:0,webPort:0});isolated.faults.progress=true;
  try{
    // La caída se simula en el servidor para comprobar el fetch real de ambos motores.
    await page.goto(isolated.web);await expect(page.locator('#add-toggle')).toBeEnabled();await page.getByRole('button',{name:'Continuar Historia de prueba',exact:true}).first().click();
    await expect(page.locator('#save-status')).toContainText('Pendiente de guardar');await expect(page.locator('#save-status')).toContainText('Capítulo 2 · imagen 2');
    isolated.faults.progress=false;await page.locator('#retry-progress').click();await expect(page.locator('#save-status')).toContainText('Sincronizado · Capítulo 2 · imagen 2');await expect(page.locator('#retry-progress')).toBeHidden();
  }finally{await isolated.close();}
});
