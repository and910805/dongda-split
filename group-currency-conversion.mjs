import {
  allocateLargestRemainder,
  amountCentsToInputValue,
  convertAmountCents,
  convertAmountCentsDetailed,
  getCurrency,
} from './currency.mjs';
import {allocateByWeights,allocateEqual,allocateHybrid} from './finance.mjs';

const asSafeInteger=(value,label)=>{
  const amount=Number(value);
  if(!Number.isSafeInteger(amount))throw new RangeError(`${label}超過可安全處理的範圍`);
  return amount;
};

const inputAmount=(amountCents,currency)=>Number(
  amountCentsToInputValue(Math.abs(amountCents),currency)
);

function allocateRelatedRows(totalCents,rows,targetCurrency,amountField,label){
  if(!Array.isArray(rows)||!rows.length)throw new Error(`${label}沒有可換算的明細`);
  if(rows.length===1)return[{...rows[0],[amountField]:totalCents}];
  try{
    return allocateLargestRemainder(
      totalCents,
      rows.map(row=>({...row,weight:String(Math.abs(asSafeInteger(row[amountField],label)))})),
      {currency:targetCurrency,amountKey:amountField,requirePositive:true}
    ).map(({weight,...row})=>row);
  }catch(error){
    throw new Error(`${label}換算後太小，無法為每位成員保留至少一個最小單位：${error.message}`);
  }
}

function rebuildSplitMeta(expense,shares,targetCurrency){
  const mode=expense.splitMode||'equal';
  const existing=expense.splitMeta&&typeof expense.splitMeta==='object'?expense.splitMeta:{};
  if(mode==='exact'){
    return{shares:shares.map(share=>({
      userId:String(share.userId),
      amount:inputAmount(share.amountCents,targetCurrency)
    }))};
  }
  if(mode==='hybrid'){
    const fixedIds=new Set((existing.fixedShares||[]).map(item=>String(item.userId)));
    return{
      participantIds:Array.isArray(existing.participantIds)
        ?existing.participantIds.map(String)
        :shares.map(share=>String(share.userId)),
      fixedShares:shares.filter(share=>fixedIds.has(String(share.userId))).map(share=>({
        userId:String(share.userId),
        amount:inputAmount(share.amountCents,targetCurrency)
      }))
    };
  }
  if(mode==='weights'){
    return{weights:(existing.weights||[]).map(item=>({
      userId:String(item.userId),
      weight:Number(item.weight)
    }))};
  }
  return{
    participantIds:Array.isArray(existing.participantIds)
      ?existing.participantIds.map(String)
      :shares.map(share=>String(share.userId))
  };
}

function rebuildShares(expense,totalCents,sourceCurrency,targetCurrency,rate){
  const mode=expense.splitMode||'equal';
  const existing=expense.splitMeta&&typeof expense.splitMeta==='object'?expense.splitMeta:{};
  if(mode==='equal'){
    const participantIds=Array.isArray(existing.participantIds)&&existing.participantIds.length
      ?existing.participantIds.map(String)
      :expense.shares.map(share=>String(share.userId));
    return allocateEqual(totalCents,participantIds,false,{currency:targetCurrency})
      .map(({userId,shareCents})=>({userId,amountCents:shareCents}));
  }
  if(mode==='weights'){
    const weights=(existing.weights||[]).map(item=>({userId:String(item.userId),weight:item.weight}));
    return allocateByWeights(totalCents,weights,{currency:targetCurrency})
      .map(({userId,shareCents})=>({userId,amountCents:shareCents}));
  }
  if(mode==='hybrid'){
    const participantIds=Array.isArray(existing.participantIds)&&existing.participantIds.length
      ?existing.participantIds.map(String)
      :expense.shares.map(share=>String(share.userId));
    const fixedIds=new Set((existing.fixedShares||[]).map(item=>String(item.userId)));
    const convertedFixed=expense.shares
      .filter(share=>fixedIds.has(String(share.userId)))
      .map(share=>({
        userId:String(share.userId),
        shareCents:convertAmountCents(
          asSafeInteger(share.amountCents,'指定分攤金額'),
          rate,
          targetCurrency,
          {sourceCurrency}
        )
      }));
    return allocateHybrid(totalCents,participantIds,convertedFixed,{currency:targetCurrency})
      .map(({userId,shareCents})=>({userId,amountCents:shareCents}));
  }
  return allocateRelatedRows(
    totalCents,
    expense.shares,
    targetCurrency,
    'amountCents',
    '分攤明細'
  );
}

function roundingDeltaNumerator(beforeAmountCents,afterAmountCents,rate){
  const numerator=BigInt(rate.ratioNumerator??rate.numerator);
  const denominator=BigInt(rate.ratioDenominator??rate.denominator);
  return BigInt(afterAmountCents)*denominator-BigInt(beforeAmountCents)*numerator;
}

export function buildCurrencyConversionPlan({
  expenses=[],
  settlements=[],
  sourceCurrency,
  targetCurrency,
  rate,
}={}){
  const source=getCurrency(sourceCurrency);
  const target=getCurrency(targetCurrency);
  if(source.code===target.code)throw new Error('來源與目標幣別不可相同');
  const ratio={
    ratioNumerator:String(rate?.ratioNumerator??rate?.numerator??''),
    ratioDenominator:String(rate?.ratioDenominator??rate?.denominator??'')
  };
  if(!/^\d+$/.test(ratio.ratioNumerator)||!/^\d+$/.test(ratio.ratioDenominator)
    ||BigInt(ratio.ratioNumerator)<=0n||BigInt(ratio.ratioDenominator)<=0n){
    throw new Error('匯率資料不完整');
  }

  const convertedExpenses=[];
  const convertedSettlements=[];
  const blockedIssues=[];
  let totalRoundingNumerator=0n;
  const roundingDenominator=BigInt(ratio.ratioDenominator);

  for(const expense of expenses){
    try{
      const beforeAmountCents=asSafeInteger(expense.amountCents,'支出金額');
      const detail=convertAmountCentsDetailed(beforeAmountCents,ratio,target.code,{sourceCurrency:source.code});
      if(detail.amountCents===0)throw new Error('換算後金額小於目標幣別最小單位');
      const payments=allocateRelatedRows(
        detail.amountCents,
        expense.payments,
        target.code,
        'amountCents',
        '付款明細'
      );
      const shares=rebuildShares(expense,detail.amountCents,source.code,target.code,ratio);
      totalRoundingNumerator+=roundingDeltaNumerator(beforeAmountCents,detail.amountCents,ratio);
      convertedExpenses.push({
        ...expense,
        beforeAmountCents,
        amountCents:detail.amountCents,
        payments,
        shares,
        splitMeta:rebuildSplitMeta(expense,shares,target.code)
      });
    }catch(error){
      blockedIssues.push({
        type:'expense',
        id:String(expense.id),
        title:String(expense.title||'未命名支出'),
        message:error.message
      });
    }
  }

  for(const settlement of settlements){
    try{
      const beforeAmountCents=asSafeInteger(settlement.amountCents,'還款金額');
      const detail=convertAmountCentsDetailed(beforeAmountCents,ratio,target.code,{sourceCurrency:source.code});
      if(detail.amountCents<=0)throw new Error('換算後金額小於目標幣別最小單位');
      totalRoundingNumerator+=roundingDeltaNumerator(beforeAmountCents,detail.amountCents,ratio);
      convertedSettlements.push({...settlement,beforeAmountCents,amountCents:detail.amountCents});
    }catch(error){
      blockedIssues.push({
        type:'settlement',
        id:String(settlement.id),
        title:String(settlement.label||'還款紀錄'),
        message:error.message
      });
    }
  }

  const roundingDeltaCents=Number(
    totalRoundingNumerator>=0n
      ?(totalRoundingNumerator+roundingDenominator/2n)/roundingDenominator
      :(totalRoundingNumerator-roundingDenominator/2n)/roundingDenominator
  );
  return{
    sourceCurrency:source.code,
    targetCurrency:target.code,
    targetDecimals:target.decimals,
    expenses:convertedExpenses,
    settlements:convertedSettlements,
    blockedIssues,
    roundingDeltaCents,
    counts:{
      expenses:expenses.length,
      payments:expenses.reduce((sum,expense)=>sum+(expense.payments?.length||0),0),
      shares:expenses.reduce((sum,expense)=>sum+(expense.shares?.length||0),0),
      settlements:settlements.length
    },
    examples:convertedExpenses.slice(0,3).map(expense=>({
      id:String(expense.id),
      title:expense.title,
      beforeAmountCents:expense.beforeAmountCents,
      afterAmountCents:expense.amountCents
    }))
  };
}
