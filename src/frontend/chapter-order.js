// No deducir números desde URL: muchas fuentes usan identificadores, no capítulos.
export function chapterNumber(chapter) {
  const raw=chapter.numero ?? chapter.number;
  if(raw!=null && String(raw).trim()!=='' && /^\d+(?:[.,]\d+)?$/.test(String(raw).trim()))return Number(String(raw).trim().replace(',','.'));
  const title=String(chapter.titulo ?? chapter.title ?? '').trim();
  const match=title.match(/^(?:(?:cap[ií]tulo|cap\.?|chapter|ch\.?|episodio|episode)\s*[:#-]?\s*)?(\d+(?:[.,]\d+)?)(?=\s|$|[:·–—])/i);
  return match ? Number(match[1].replace(',','.')) : null;
}
export function compareChapters(a,b) {
  const left=chapterNumber(a),right=chapterNumber(b);
  return left===null ? right===null ? 0 : 1 : right===null ? -1 : left-right;
}
export function orderedChapters(items=[]) { return items.slice().sort(compareChapters); }
export function chapterGaps(items=[]) {
  const numbers=[...new Set(items.map(chapterNumber).filter(number=>number!==null))].sort((a,b)=>a-b);
  return numbers.slice(1).flatMap((number,index)=>number-numbers[index]>1 ? [[numbers[index],number]] : []);
}
