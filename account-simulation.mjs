const normalizeSingleLine=value=>String(value??'')
  .replace(/[\u0000-\u001f\u007f]+/g,' ')
  .replace(/\s+/gu,' ')
  .trim();

const characterCount=value=>Array.from(value).length;

export function normalizeSimulatedAccountInput(body={}){
  const displayName=normalizeSingleLine(body.displayName);
  const note=normalizeSingleLine(body.note);
  const displayNameLength=characterCount(displayName);
  if(displayNameLength<1||displayNameLength>40)throw new Error('顯示名稱需為 1–40 個字');
  if(characterCount(note)>120)throw new Error('使用情境最多 120 個字');
  return{displayName,note};
}
