import {formatCurrencyAmount,isSupportedCurrency} from '../currency.mjs';

const safeText=value=>String(value||'').replace(/\s+/g,' ').trim();
const isEnglish=options=>String(options?.language||'').toLowerCase().startsWith('en');

export function formatSettlementReportTime(value,options={}){
  const date=value instanceof Date?value:new Date(value);
  const english=isEnglish(options);
  if(Number.isNaN(date.getTime()))return english?'Time not recorded':'時間未記錄';
  const parts=new Intl.DateTimeFormat(english?'en-US':'zh-TW',{
    year:'numeric',
    month:english?'short':'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    hourCycle:'h23'
  }).formatToParts(date);
  const part=type=>parts.find(item=>item.type===type)?.value||'';
  return english
    ?`${part('month')} ${part('day')}, ${part('year')} ${part('hour')}:${part('minute')}`
    :`${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
}

export function formatSettlementReportAmount(amountCents,currency='TWD',_options={}){
  const numeric=Number(amountCents);
  const currencyCode=isSupportedCurrency(currency)?String(currency).toUpperCase():'TWD';
  const safeCents=Number.isSafeInteger(numeric)&&numeric>0?numeric:0;
  try{return formatCurrencyAmount(safeCents,currencyCode)}
  catch{return formatCurrencyAmount(0,currencyCode)}
}

export function buildSettlementNotice(report,options={}){
  const english=isEnglish(options);
  const groupName=safeText(report?.groupName)||(english?'Unnamed trip':'未命名旅程');
  const payerName=safeText(report?.from?.displayName)||(english?'Payer':'付款人');
  const recipientName=safeText(report?.to?.displayName)||(english?'Recipient':'收款人');
  const reporterName=safeText(report?.reportedBy?.displayName)||payerName;
  const currency=isSupportedCurrency(report?.currency)?String(report.currency).toUpperCase():'TWD';
  const amountLabel=formatSettlementReportAmount(report?.amountCents,currency,options);
  const reportedCurrency=isSupportedCurrency(report?.reportedCurrency)?String(report.reportedCurrency).toUpperCase():currency;
  const reportedAmountCents=Number(report?.reportedAmountCents??report?.amountCents);
  const originalAmountLabel=reportedCurrency!==currency||reportedAmountCents!==Number(report?.amountCents)
    ?formatSettlementReportAmount(reportedAmountCents,reportedCurrency,options)
    :'';
  const timeLabel=formatSettlementReportTime(report?.reportedAt,options);
  const reporterLine=reporterName===payerName?'':english?`\nReported by: ${reporterName}`:`\n回報人：${reporterName}`;
  const originalAmountLine=originalAmountLabel?english?`\nOriginal reported amount: ${originalAmountLabel}`:`\n原回報金額：${originalAmountLabel}`:'';

  return {
    amountLabel,
    timeLabel,
    text:english?`【TripTab | Transfer record】
${reporterName} marked this payment as “Transferred”

Trip: ${groupName}
Payer: ${payerName}
Recipient: ${recipientName}
Transfer amount: ${amountLabel}${originalAmountLine}
Recorded at: ${timeLabel}${reporterLine}

Please ask ${recipientName} to check the receiving account
TripTab records member-reported status only. Check the bank record for the actual deposit status`:`【旅帳 TripTab｜轉帳紀錄】
${reporterName} 已將這筆款項標記為「已轉帳」

旅程：${groupName}
付款人：${payerName}
收款人：${recipientName}
轉帳金額：${amountLabel}${originalAmountLine}
記錄時間：${timeLabel}${reporterLine}

請 ${recipientName} 留意收款帳戶
旅帳僅記錄成員回報，實際入帳狀態以銀行紀錄為準`
  };
}

export function settlementLineShareUrl(report,options={}){
  return `https://line.me/R/share?text=${encodeURIComponent(buildSettlementNotice(report,options).text)}`;
}
