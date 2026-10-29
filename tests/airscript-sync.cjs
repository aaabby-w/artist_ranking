const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('supabase/airscript/sync-cards.js','utf8');
const rows=[Array(11).fill(''),Array(11).fill(''),...Array.from({length:225},(_,i)=>['art','','1','','card'+i,'owner','description','skill','','',''])];
const sheet={Name:'全部卡牌',get UsedRange(){return {Row:1,Rows:{Count:rows.length}}},Range(address){const m=address.match(/^([A-K])(\d+)(?::([A-K])(\d+))?$/);assert(m); const r=+m[2]-1,c=m[1].charCodeAt(0)-65,end=m[4]?+m[4]:r+1,ec=(m[3]||m[1]).charCodeAt(0)-64;return {get Value2(){return m[3]?rows.slice(r,end).map(x=>x.slice(c,ec)):rows[r][c]},set Value2(v){assert.equal(c,10);rows[r][c]=v}}}};
const run=()=>vm.runInNewContext('(function(){'+source+'})()',{Application:{Sheets:{Item:()=>sheet}},Set,Date,Math});
let first=run();assert.equal(first.rows.length,227);let ids=rows.slice(2).map(r=>r[10]);assert.equal(new Set(ids).size,225);run();assert.deepEqual(rows.slice(2).map(r=>r[10]),ids);
rows[2][4]='renamed';run();assert.equal(rows[2][10],ids[0]);rows.reverse();rows.reverse();
rows.push(['new','','','','new card','owner','','','','','']);run();assert(rows.at(-1)[10]);
rows.at(-1)[10]=ids[0];assert.throws(run,/重复/);console.log('PASS: >100 rows, stable IDs on retry/rename, new IDs, duplicate rejection');
