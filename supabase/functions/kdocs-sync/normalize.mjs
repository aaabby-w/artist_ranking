export function normalize(result) {
  if(result?.version!==2 || result.complete!==true || !Array.isArray(result.sheets) || !result.sheets.length || result.sheets.length>20) throw new Error('INVALID_SNAPSHOT');
  const names=new Set();
  return result.sheets.map(s=>{
    if(typeof s.sheet_name!=='string'||!s.sheet_name.trim()||names.has(s.sheet_name)||s.complete!==true||!Array.isArray(s.rows)||s.rows.length<3||s.rows.length>20000||!s.rows.every(Array.isArray)) throw new Error('INVALID_SHEET');
    names.add(s.sheet_name);
    const text=v=>v==null?'':String(v).trim();
    const headers=s.rows[1].map(text);
    // Headers, not row numbers, define column meaning; each sheet must publish this contract.
    const at=name=>{const i=headers.indexOf(name);if(i<0||headers.lastIndexOf(name)!==i)throw new Error('INVALID_HEADERS');return i;};
    const idAt=at('同步ID'),nameAt=at('卡牌名称'),ownerAt=at('谁的卡'),descAt=at('技能介绍'),artistAt=at('负责画师'),statusAt=at('完成情况');
    const ids=new Set();const cards=[];
    for(const row of s.rows.slice(2)) {
      if(row.every(v=>!text(v))) continue;
      const id=text(row[idAt]),title=text(row[nameAt]);
      if(!id||id.length>200||!title||ids.has(id))throw new Error('INVALID_CARD_ID');
      ids.add(id);
      const data={title,owner:text(row[ownerAt]),description:text(row[descAt]),artist:text(row[artistAt]),status:text(row[statusAt]),art_requirement:text(row[0]),raw:row};
      cards.push({id,data});
    }
    if(!cards.length)throw new Error('EMPTY_SNAPSHOT');
    return {name:s.sheet_name,complete:true,rows:s.rows,cards};
  });
}
