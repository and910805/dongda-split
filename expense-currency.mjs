import {decimalToFraction,getCurrency} from './currency.mjs';
import {buildCurrencyConversionPlan} from './group-currency-conversion.mjs';

const safeNumber=value=>{
  const amount=Number(value);
  if(!Number.isSafeInteger(amount))throw new RangeError('支出金額超過系統可安全處理的範圍');
  return amount;
};

const gcd=(left,right)=>{
  let a=left<0n?-left:left,b=right<0n?-right:right;
  while(b!==0n)[a,b]=[b,a%b];
  return a||1n;
};

const canonicalRate=(numerator,denominator,scale=15)=>{
  const factor=10n**BigInt(scale);
  const rounded=(numerator*factor+denominator/2n)/denominator;
  const whole=rounded/factor;
  const fraction=String(rounded%factor).padStart(scale,'0').replace(/0+$/u,'');
  return fraction?`${whole}.${fraction}`:String(whole);
};

export function normalizeExpenseRate(rate){
  const fraction=decimalToFraction(rate);
  if(fraction.numerator<=0n)throw new RangeError('匯率必須大於 0');
  const divisor=gcd(fraction.numerator,fraction.denominator);
  const numerator=fraction.numerator/divisor;
  const denominator=fraction.denominator/divisor;
  if(String(numerator).length>78||String(denominator).length>78){
    throw new RangeError('匯率精度超過系統可保存的範圍');
  }
  const rateValue=canonicalRate(numerator,denominator);
  if(rateValue==='0')throw new RangeError('匯率小於系統可保存的最小精度');
  return{
    rate:rateValue,
    ratioNumerator:String(numerator),
    ratioDenominator:String(denominator)
  };
}

const sourceSnapshot=(input,sourceCurrency)=>({
  inputCurrency:sourceCurrency,
  inputAmountCents:safeNumber(input.amountCents),
  inputPayments:input.payments.map(item=>({
    userId:String(item.userId),
    amountCents:safeNumber(item.paymentCents)
  })),
  inputShares:input.shares.map(item=>({
    userId:String(item.userId),
    amountCents:safeNumber(item.shareCents)
  })),
  inputSplitMeta:input.splitMeta||{}
});

export function convertExpenseInputToLedger({
  input,
  sourceCurrency,
  targetCurrency,
  rate,
  rateDate=null,
  rateSource='member',
  rateMode='manual'
}={}){
  const source=getCurrency(sourceCurrency).code;
  const target=getCurrency(targetCurrency).code;
  const snapshot=sourceSnapshot(input,source);
  if(source===target){
    return{
      ...input,
      currencyMeta:{
        ...snapshot,
        ledgerCurrency:target,
        rate:'1',
        ratioNumerator:'1',
        ratioDenominator:'1',
        rateDate:null,
        rateSource:'identity',
        rateMode:'identity'
      }
    };
  }

  const normalizedRate=rate?.ratioNumerator&&rate?.ratioDenominator
    ?{
      rate:String(rate.rate||canonicalRate(BigInt(rate.ratioNumerator),BigInt(rate.ratioDenominator))),
      ratioNumerator:String(rate.ratioNumerator),
      ratioDenominator:String(rate.ratioDenominator)
    }
    :normalizeExpenseRate(rate);
  const plan=buildCurrencyConversionPlan({
    sourceCurrency:source,
    targetCurrency:target,
    rate:normalizedRate,
    expenses:[{
      id:'expense-input',
      title:input.title,
      amountCents:input.amountCents,
      splitMode:input.mode,
      splitMeta:input.splitMeta,
      payments:input.payments.map(item=>({userId:item.userId,amountCents:item.paymentCents})),
      shares:input.shares.map(item=>({userId:item.userId,amountCents:item.shareCents}))
    }]
  });
  if(plan.blockedIssues.length||!plan.expenses[0]){
    const message=plan.blockedIssues[0]?.message||'這筆支出無法換算成群組幣別';
    const error=new Error(message);
    error.code='EXPENSE_CURRENCY_CONVERSION_BLOCKED';
    error.issues=plan.blockedIssues;
    throw error;
  }
  const converted=plan.expenses[0];
  return{
    ...input,
    amountCents:converted.amountCents,
    payments:converted.payments.map(item=>({userId:item.userId,paymentCents:item.amountCents})),
    shares:converted.shares.map(item=>({userId:item.userId,shareCents:item.amountCents})),
    splitMeta:converted.splitMeta,
    currencyMeta:{
      ...snapshot,
      ledgerCurrency:target,
      rate:normalizedRate.rate,
      ratioNumerator:normalizedRate.ratioNumerator,
      ratioDenominator:normalizedRate.ratioDenominator,
      rateDate:rateDate||null,
      rateSource:String(rateSource||'member'),
      rateMode:rateMode==='quoted'?'quoted':'manual'
    }
  };
}
