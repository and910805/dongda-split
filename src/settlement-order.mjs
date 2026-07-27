export const prioritizeSettlementsForReceiver=(settlements,receiverId)=>{
  const items=[...(settlements||[])];
  if(receiverId===null||receiverId===undefined)return items;
  const prioritized=[],others=[];
  for(const settlement of items){
    (String(settlement?.to?.id)===String(receiverId)?prioritized:others).push(settlement);
  }
  return [...prioritized,...others];
};
