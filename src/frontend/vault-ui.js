let recoveryPromise;
const $=id=>document.getElementById(id);
export function configureVaultInputs(enabled) {
  if(!enabled)return;
  const labels={'private-pin':'Contraseña de cifrado','private-pin-confirm':'Repite tu contraseña','private-new-pin':'Nueva contraseña de cifrado','private-new-confirm':'Repite la nueva contraseña','account-private-pin':'Contraseña de cifrado','account-private-confirm':'Repite tu contraseña'};
  for(const [id,label] of Object.entries(labels)) {
    const input=$(id);input.removeAttribute('pattern');input.removeAttribute('inputmode');input.minLength=12;input.maxLength=512;input.placeholder='12 caracteres o más';
    const text=[...(input.labels?.[0]?.childNodes??[])].find(node=>node.nodeType===3);if(text)text.textContent=label;
  }
  $('private-change-form').closest('details').querySelector('summary').textContent='Cambiar mi contraseña de cifrado';
  $('private-security-note').textContent='Desbloquea una vez por sesión. Configura en Ajustes el bloqueo por inactividad y al cambiar de aplicación. Recargar o cerrar la página vuelve a bloquearla. Los títulos, carpetas y progreso se cifran aquí; Render procesa las URL e imágenes mientras lees. Guarda la clave de recuperación.';
  $('private-recovery-label').hidden=false;
  $('account-private-note').textContent='La contraseña de cifrado se usa únicamente en tu navegador. Al terminar, volveremos a bloquear la biblioteca.';
}
export function showRecoveryKey(key) {
  if(!key)return Promise.resolve(true);
  if(recoveryPromise)return recoveryPromise;
  const dialog=$('vault-recovery-dialog'),field=$('vault-recovery-key');field.value=key;
  recoveryPromise=new Promise(resolve=>{
    const finish=approved=>{field.value='';dialog.close();$('vault-recovery-confirm').removeEventListener('click',confirm);dialog.removeEventListener('cancel',cancel);document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',hide);recoveryPromise=null;resolve(approved);};
    const confirm=()=>finish(true),cancel=event=>event.preventDefault(),hide=()=>{if(document.visibilityState==='hidden')finish(false);};
    $('vault-recovery-confirm').addEventListener('click',confirm);dialog.addEventListener('cancel',cancel);document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',hide);dialog.showModal();
  });return recoveryPromise;
}
export function initializeRecoveryDownload() {
  $('vault-recovery-download').addEventListener('click',()=>{
    const key=$('vault-recovery-key').value;if(!key)return;
    const url=URL.createObjectURL(new Blob(['Clave de recuperación de Lector Manga\n\n'+key+'\n\nGuárdala fuera del navegador y no la compartas.\n'],{type:'text/plain'}));
    const link=document.createElement('a');link.href=url;link.download='lector-clave-recuperacion.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  });
}
