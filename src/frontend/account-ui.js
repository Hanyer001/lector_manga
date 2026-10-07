import { cloudMode,encryptedPrivate, accountUser, initializeAccount, signIn, signOut, clearAccountMedia, recheckAccount, isGuest, guestBackup } from './network.js';
import {showRecoveryKey} from './vault-ui.js';
const $ = id => document.getElementById(id);
export function createAccountUI({ api, reload, navigate, beforeSignOut = async () => {}, lockPrivate = async () => {} }) {
  let lastRevision = 0,lastVaultRevision=0, refreshing = false, polling, mailTimer;
  let privateConfirmation, privateConfigured=false,backupMode=false,pendingBackup;
  function status(message) { $('account-status').textContent = message; }
  const privateDialog=$('account-private-dialog');
  function finishConfirmation(approved=false) {
    const resolve=privateConfirmation;privateConfirmation=null;
    backupMode=false;
    $('account-private-recovery').checked=false;
    $('account-private-pin').value=$('account-private-confirm').value='';
    if(privateDialog.open)privateDialog.close();resolve?.(approved);
  }
  privateDialog.addEventListener('cancel',event=>{if($('account-private-submit').disabled)event.preventDefault();else finishConfirmation();});
  $('account-private-cancel').addEventListener('click',()=>finishConfirmation());
  $('account-private-form').addEventListener('submit',async event=>{
    event.preventDefault();$('account-private-submit').disabled=$('account-private-cancel').disabled=true;
    try {
      const pin=$('account-private-pin').value;
      if(backupMode){const result=await api('/api/private/import-backup',{method:'POST',body:JSON.stringify({backup:pendingBackup,secret:pin,recovery:$('account-private-recovery').checked})});finishConfirmation({result});return;}
      if(!privateConfigured&&pin!==$('account-private-confirm').value)throw new Error(encryptedPrivate?'Las contraseñas no coinciden.':'Los PIN no coinciden.');
      const info=await api('/api/private/'+(privateConfigured?'unlock':'setup'),{method:'POST',body:JSON.stringify({pin,recovery:encryptedPrivate&&$('account-private-recovery').checked})});
      if(!await showRecoveryKey(info.recoveryKey)){await api('/api/private/lock',{method:'POST'});throw new Error('Se ocultó la clave de recuperación. Desbloquea con tu contraseña para continuar.');}
      finishConfirmation(true);
    }catch(error){$('account-private-status').textContent=error.message;}
    finally{$('account-private-submit').disabled=$('account-private-cancel').disabled=false;}
  });
  async function runTransfer(action) {
    try{return await action();}catch(error){
      if(error.code!=='BACKUP_PASSWORD_REQUIRED'||!pendingBackup)throw error;
      backupMode=true;$('account-private-recovery-label').hidden=false;$('account-private-title').textContent='Desbloquea el archivo cifrado';$('account-private-confirm-label').hidden=true;$('account-private-confirm').required=false;$('account-private-status').textContent='Introduce la contraseña que protegía este archivo cuando lo exportaste. Se utiliza únicamente en este navegador.';
      const answer=await new Promise(resolve=>{privateConfirmation=resolve;privateDialog.showModal();$('account-private-pin').focus();});
      if(!answer)throw new Error('Importación cancelada.');return answer.result;
    }
  }
  async function transfer(action) {
    try { return await runTransfer(action); }
    catch(error) {
      if(error.code!=='PRIVATE_LOCKED')throw error;
      await lockPrivate();
      const info=await api('/api/private/status');privateConfigured=info.configured;
      $('account-private-title').textContent=encryptedPrivate?(privateConfigured?'Desbloquea la bóveda cifrada':'Crea la contraseña de cifrado'):(privateConfigured?'Confirma tu PIN':'Crea el PIN de esta biblioteca');
      $('account-private-confirm-label').hidden=privateConfigured;$('account-private-confirm').required=!privateConfigured;
      $('account-private-recovery-label').hidden=!encryptedPrivate||!privateConfigured;
      $('account-private-status').textContent='';
      const approved=await new Promise(resolve=>{privateConfirmation=resolve;privateDialog.showModal();$('account-private-pin').focus();});
      if(!approved)throw new Error('Transferencia cancelada.');
      try { return await runTransfer(action); }
      finally { await api('/api/private/lock',{method:'POST',keepalive:true}).catch(()=>{}); }
    }
  }
  function render() {
    const user = accountUser();
    document.body.classList.remove('account-required');
    $('account-gate').hidden = true;
    $('account-signin').hidden = !cloudMode || Boolean(user);
    $('account-signout').hidden = !cloudMode || !user;
    $('account-name').textContent = user?.user_metadata?.full_name ?? (isGuest() ? 'En este dispositivo' : 'Biblioteca de este computador');
    $('account-email').textContent = user?.email ?? (isGuest() ? 'Puedes leer sin cuenta. Accede para sincronizar entre dispositivos.' : 'Modo local · los datos se guardan en este equipo.');
    $('account-sync').hidden = !cloudMode || !user;
    $('account-export').disabled = false;
    $('account-import').disabled = false;
    $('account-device-import').hidden=!cloudMode||!user;
    $('account-local-hint').hidden = !isGuest();
    if (!cloudMode) status('Puedes exportar tu biblioteca ahora e importarla después en tu cuenta.');
  }
  async function synchronize({ force = false } = {}) {
    if (!cloudMode || !accountUser() || document.visibilityState === 'hidden' || (!force&&document.body.classList.contains('reader-active')) || refreshing) return;
    refreshing = true;
    try {
      const info = await api('/api/account');
      if (force || info.revision > lastRevision || (info.vaultRevision??0)>lastVaultRevision) { if(await reload()===false)throw new Error('No se pudo actualizar la biblioteca.');lastVaultRevision=info.vaultRevision??0; }
      status('Biblioteca sincronizada · ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }));
    } catch (error) { status(error.code === 'AUTH_REQUIRED' ? 'La sesión ha vencido. Vuelve a iniciar sesión.' : 'Sin conexión con la sincronización · reintentar'); }
    finally { refreshing = false; }
  }
  $('account-signin').textContent = 'Acceder con correo';
  $('account-signin').addEventListener('click', () => { $('account-gate').hidden=false;document.body.classList.add('account-required');$('account-login-email').focus(); });
  $('account-guest').addEventListener('click',()=>{ $('account-gate').hidden=true;document.body.classList.remove('account-required'); });
  $('account-device-import').addEventListener('click',async()=>{const button=$('account-device-import');button.disabled=true;try{pendingBackup=await guestBackup();if(!pendingBackup.tables.Series.length&&!pendingBackup.privateVault){status('No hay lecturas guardadas sin cuenta en este navegador.');return;}const result=await transfer(()=>api('/api/library/import',{method:'POST',body:JSON.stringify(pendingBackup)}));await reload();status(`Biblioteca del dispositivo añadida: ${result.seriesAdded} series. La copia local se conserva.`);}catch(error){status(error.message);}finally{pendingBackup=undefined;button.disabled=false;}});
  $('account-email-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('account-gate-signin');
    if (button.disabled) return;
    button.disabled = true;
    $('account-gate-status').textContent = 'Enviando enlace…';
    try {
      await signIn($('account-login-email').value);
      $('account-gate-status').textContent = 'Revisa tu correo y abre el enlace para entrar. Si no lo ves, revisa spam. Usa el mismo correo en tus otros dispositivos.';
      const retryAt = Date.now() + 60000;
      button.textContent = 'Reenviar enlace (60 s)';
      mailTimer = setInterval(() => {
        const remaining = Math.ceil((retryAt - Date.now()) / 1000);
        if (remaining <= 0) { clearInterval(mailTimer); button.disabled = false; button.textContent = 'Reenviar enlace'; }
        else button.textContent = `Reenviar enlace (${remaining} s)`;
      }, 1000);
    } catch (error) { status(error.message); $('account-gate-status').textContent = error.message; button.disabled = false; }
  });
  $('account-signout').addEventListener('click', async () => {
    $('account-signout').disabled = true;
    try { await beforeSignOut(); await signOut(); clearAccountMedia(); location.replace(location.pathname); }
    catch (error) { status(error.message); $('account-signout').disabled = false; }
  });
  $('account-open').addEventListener('click', () => { navigate('settings'); $('account-panel').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  $('account-sync').addEventListener('click', () => synchronize({ force: true }));
  $('account-export').addEventListener('click', async () => {
    $('account-export').disabled = true;
    try {
      const backup = await transfer(()=>api('/api/library/export' + ($('account-export-private').checked ? '?private=1' : '')));
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'lector-biblioteca-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      status(backup.privateVault?'Biblioteca exportada. Las lecturas privadas permanecen cifradas; la biblioteca general es legible.':'Biblioteca exportada. El archivo contiene tus enlaces y progreso; guárdalo en un lugar privado.');
    } catch (error) { status(error.message); }
    finally { $('account-export').disabled = false; }
  });
  $('account-import').addEventListener('click', () => $('account-import-file').click());
  $('account-import-file').addEventListener('change', async () => {
    const file = $('account-import-file').files[0]; if (!file) return;
    $('account-import').disabled = true;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('El archivo supera el límite de importación.');
      const backup = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      pendingBackup=backup;
      const result = await transfer(()=>api('/api/library/import', { method: 'POST', body: JSON.stringify(backup) }));
      await reload();
      status(`Importación completada: ${result.seriesAdded} series, ${result.chaptersAdded} capítulos y ${result.foldersAdded} carpetas añadidos. Las lecturas existentes se conservaron.`);
    } catch (error) { status(error instanceof SyntaxError ? 'El archivo no es un JSON válido.' : error.message); }
    finally { pendingBackup=undefined;$('account-import').disabled = false; $('account-import-file').value = ''; }
  });
  window.addEventListener('online', () => synchronize());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') synchronize(); });
  window.addEventListener('pageshow',event=>{if(event.persisted)recheckAccount().then(()=>synchronize());});
  window.addEventListener('library-loaded', event => { lastRevision = event.detail?.revision ?? 0; });
  // Un cambio de cuenta también elimina cualquier DOM y caché de imágenes del usuario anterior.
  window.addEventListener('account-changed', () => { clearAccountMedia(); location.replace(location.pathname); });
  return {
    async start() {
      try { await initializeAccount(); render(); if (cloudMode && accountUser()) polling = setInterval(synchronize, 60000); return true; }
      catch (error) { render(); $('account-gate-status').textContent = error.message; status(error.message); return false; }
    },
    synchronize, stop: () => { clearInterval(polling); clearInterval(mailTimer); }
  };
}
