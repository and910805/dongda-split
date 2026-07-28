export const prioritizeSettlementsForMember=(settlements,memberId)=>{
  const items=[...(settlements||[])];
  if(memberId===null||memberId===undefined)return items;
  const targetId=String(memberId);
  const prioritized=[],others=[];
  for(const settlement of items){
    const related=String(settlement?.from?.id)===targetId||String(settlement?.to?.id)===targetId;
    (related?prioritized:others).push(settlement);
  }
  return [...prioritized,...others];
};

export const prioritizeSettlementsForReceiver=prioritizeSettlementsForMember;
