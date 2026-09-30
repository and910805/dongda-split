const storageKey=userId=>`triptab:last-ledger:${String(userId)}`;

export function readLedgerPreference(userId,storage){
  if(userId===undefined||userId===null)return null;
  try{return (storage??globalThis.localStorage)?.getItem(storageKey(userId))||null}catch{return null}
}

export function writeLedgerPreference(userId,groupId,storage){
  if(userId===undefined||userId===null||!groupId)return false;
  try{const target=storage??globalThis.localStorage;if(!target)return false;target.setItem(storageKey(userId),String(groupId));return true}catch{return false}
}

export function chooseMemberLedger(groups,{preferredId,currentId,rememberedId}={}){
  const candidates=[preferredId,currentId,rememberedId];
  for(const candidate of candidates){
    if(candidate===undefined||candidate===null)continue;
    const match=groups.find(group=>String(group.id)===String(candidate));
    if(match)return match.id;
  }
  return groups[0]?.id??null;
}

export function canRememberLedger(group,userId,{adminViewing=false}={}){
  return Boolean(userId!==undefined&&userId!==null&&!adminViewing&&group?.id&&(group.members||[]).some(member=>!member.isFund&&String(member.id)===String(userId)));
}
