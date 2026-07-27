export const DEFAULT_EXPENSE_SORT={key:'date',direction:'desc'};

const numericValue=value=>{
  const number=Number(value);
  return Number.isFinite(number)?number:null;
};

const normalizeExpenseSearch=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-TW');

export const filterExpenses=(expenses,query)=>{
  const normalizedQuery=normalizeExpenseSearch(query);
  if(!normalizedQuery)return [...(expenses||[])];
  return (expenses||[]).filter(expense=>{
    const category=Number(expense?.amountCents)<0?'退款':expense?.category||'其他';
    return [expense?.title,expense?.payerName,category].some(value=>normalizeExpenseSearch(value).includes(normalizedQuery));
  });
};

const expenseDateValue=expense=>{
  const timestamp=Date.parse(expense?.createdAt);
  return Number.isFinite(timestamp)?timestamp:null;
};

export const expenseParticipantAmount=(expense,participantId)=>{
  if(participantId===null||participantId===undefined)return null;
  const share=(expense?.shares||[]).find(item=>String(item.userId)===String(participantId));
  return share?numericValue(share.amountCents):null;
};

const expenseSortValue=(expense,key,participantId)=>{
  if(key==='participantAmount')return expenseParticipantAmount(expense,participantId);
  if(key==='amount')return numericValue(expense?.amountCents);
  return expenseDateValue(expense);
};

export const sortExpenses=(expenses,sort=DEFAULT_EXPENSE_SORT,participantId)=>{
  const direction=sort?.direction==='asc'?1:-1;
  const key=['date','participantAmount','amount'].includes(sort?.key)?sort.key:DEFAULT_EXPENSE_SORT.key;
  return [...(expenses||[])].map((expense,index)=>({expense,index,value:expenseSortValue(expense,key,participantId)})).sort((left,right)=>{
    if(left.value===null&&right.value===null)return left.index-right.index;
    if(left.value===null)return 1;
    if(right.value===null)return -1;
    if(left.value!==right.value)return (left.value-right.value)*direction;
    return left.index-right.index;
  }).map(item=>item.expense);
};

export const nextExpenseSort=(current,key)=>{
  if(current?.key!==key)return {key,direction:'desc'};
  return {key,direction:current.direction==='desc'?'asc':'desc'};
};
