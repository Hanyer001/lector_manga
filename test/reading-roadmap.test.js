import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/storage/database.js';
import {trialChapters,matchingTrialChapter} from '../src/frontend/trial-reading.js';
import {rankRecommendations,selectRecommendationSeeds} from '../src/frontend/discovery-core.js';

test('prueba de lectura: capítulos decimales, versiones ambiguas y origen sin correspondencia',()=>{
  const chapters=trialChapters([{title:'Dos B',number:2,url:'https://example.test/2b'},{title:'Uno',number:1,url:'https://example.test/1'},{title:'Dos A',number:2,url:'https://example.test/2a'},{title:'Extra',url:'https://example.test/extra'},{title:'Medio',number:1.5,url:'https://example.test/1.5'}]);
  assert.deepEqual(chapters.map(item=>item.number),[1,1.5,2,2,null]);assert.ok(chapters.every(item=>item.id.startsWith('trial:')));
  assert.equal(matchingTrialChapter(chapters,1.5).index,1);assert.match(matchingTrialChapter(chapters,1.5).message,/Comprueba/);
  assert.equal(matchingTrialChapter(chapters,2).index,null);assert.match(matchingTrialChapter(chapters,2).message,/varias versiones/);
  assert.equal(matchingTrialChapter(chapters,9).index,null);assert.equal(matchingTrialChapter(chapters,null).index,null);
});
test('vistas de Descubrir: persisten sin alterar gustos o lecturas y el reinicio conserva descartes',()=>{
  const db=openDatabase(':memory:'),copy=openDatabase(':memory:');try{
    const item={source:'test',title:'Vista',url:'https://example.test/vista',genres:['Fantasy']};
    db.saveRecommendationFeedback(item,{seen:true});assert.equal(db.listSeries().length,0);
    assert.deepEqual(selectRecommendationSeeds({feedback:db.getDiscovery().feedback}),[]);
    db.saveRecommendationFeedback(item,{sentiment:'like'});db.saveRecommendationFeedback({...item,title:'Descartada',url:'https://example.test/no'},{seen:true,hidden:true});
    db.saveRecommendationFeedback({...item,title:'Solo vista',url:'https://example.test/solo'},{seen:true});
    db.saveDiscovery({onlyNew:true});copy.restoreState(db.exportState());assert.equal(copy.getDiscovery().preferences.onlyNew,true);assert.equal(copy.getDiscovery().feedback.filter(item=>item.seen).length,3);
    copy.resetSeenRecommendations();const feedback=copy.getDiscovery().feedback;
    assert.equal(feedback.length,2);assert.ok(feedback.every(item=>!item.seen));assert.equal(feedback.find(item=>item.title==='Vista').sentiment,'like');assert.equal(feedback.find(item=>item.title==='Descartada').hidden,true);
    assert.throws(()=>db.saveRecommendationFeedback(item,{seen:'yes'}));
  }finally{db.close();copy.close();}
});
test('explicaciones: solo atribuyen etiquetas y autoría compartidas realmente',()=>{
  const seed={id:1,work_id:1,source:'a',titulo:'Oscura',genres:['Fantasy','Horror'],themes:['Revenge'],authors:['Autora']};
  const candidate={source:'b',title:'Otra oscura',url:'https://example.test/otra',genres:['Fantasy','Horror'],themes:['Revenge','Magic'],authors:['Autora']};
  const [result]=rankRecommendations([candidate],{library:[seed],mode:'similar',seedWorkId:1});
  assert.equal(result.explanation.seedTitle,'Oscura');assert.deepEqual(result.explanation.sharedAuthors,['Autora']);assert.ok(result.explanation.sharedTags.includes('Venganza'));assert.ok(!result.explanation.sharedTags.includes('Magia'));
});
