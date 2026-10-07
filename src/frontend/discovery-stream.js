// NDJSON permite mostrar resultados antes de que terminen los catálogos lentos.
export async function readRecommendationStream(response,onProgress){
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',complete=null;
  const consume=line=>{if(!line.trim())return;const event=JSON.parse(line);if(event.type==='error')throw Object.assign(new Error(event.error?.message??'Falló la consulta.'),{code:event.error?.code});if(event.type==='complete')complete=event;if(['start','progress','complete'].includes(event.type))onProgress?.(event);};
  try{while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value??new Uint8Array(),{stream:!done});if(buffer.length>2000000)throw new Error('Respuesta de recomendaciones demasiado grande.');let index;while((index=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,index));buffer=buffer.slice(index+1);}if(done){consume(buffer);break;}}
    if(!complete)throw new Error('La consulta se interrumpió antes de terminar. Pulsa Actualizar.');return complete;
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
