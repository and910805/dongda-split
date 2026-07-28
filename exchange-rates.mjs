const TAIPEI_OFFSET_MS=8*60*60*1000;
const DAY_MS=24*60*60*1000;
const DEFAULT_TIMEOUT_MS=10_000;
const DEFAULT_RETRY_DELAYS_MS=Object.freeze([5*60_000,30*60_000,2*60*60_000]);
const DEFAULT_SYNC_HOUR=8;
const DEFAULT_SYNC_MINUTE=15;
const EXCHANGE_RATE_LOCK_KEY=1_915_240_815;

export const SUPPORTED_EXCHANGE_CURRENCIES=Object.freeze([
  'TWD',
  'JPY',
  'KRW',
  'USD',
  'CNY',
  'THB'
]);

export const EXCHANGE_RATE_PROVIDER=Object.freeze({
  id:'fawazahmed0',
  primaryUrl:'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/twd.min.json',
  fallbackUrl:'https://latest.currency-api.pages.dev/v1/currencies/twd.min.json'
});

const safeErrorMessage=error=>{
  if(error instanceof Error&&error.message)return error.message.slice(0,2_000);
  return String(error??'未知錯誤').slice(0,2_000);
};

const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);

const validIsoDate=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [year,month,day]=value.split('-').map(Number);
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
};

const taipeiIsoDate=now=>new Date(now.getTime()+TAIPEI_OFFSET_MS).toISOString().slice(0,10);
const addIsoDays=(value,days)=>{
  const [year,month,day]=value.split('-').map(Number);
  return new Date(Date.UTC(year,month-1,day+days)).toISOString().slice(0,10);
};

const normalizedPositiveRate=(value,currency)=>{
  const rate=typeof value==='number'?value:Number(value);
  if(!Number.isFinite(rate)||rate<=0){
    throw new Error(`匯率資料缺少有效的 ${currency} 報價`);
  }
  return rate;
};

export function validateExchangeRatePayload(payload,{now=new Date(),maxFutureDays=1}={}){
  if(!isPlainObject(payload))throw new Error('匯率回應格式不正確');
  if(!validIsoDate(payload.date))throw new Error('匯率回應缺少有效日期');
  if(payload.date>addIsoDays(taipeiIsoDate(now),maxFutureDays)){
    throw new Error('匯率回應日期超出合理的未來範圍');
  }
  if(!isPlainObject(payload.twd))throw new Error('匯率回應缺少 TWD 基準報價');

  const rates={};
  for(const currency of SUPPORTED_EXCHANGE_CURRENCIES){
    rates[currency]=normalizedPositiveRate(payload.twd[currency.toLowerCase()],currency);
  }
  if(Math.abs(rates.TWD-1)>Number.EPSILON){
    throw new Error('TWD 基準匯率必須為 1');
  }

  return Object.freeze({
    rateDate:payload.date,
    baseCurrency:'TWD',
    rates:Object.freeze(rates)
  });
}

export class ExchangeRateProviderError extends Error{
  constructor(attempts){
    const summary=attempts
      .map(attempt=>`${attempt.endpoint}：${safeErrorMessage(attempt.error)}`)
      .join('；');
    super(`無法取得有效匯率資料（${summary}）`);
    this.name='ExchangeRateProviderError';
    this.attempts=attempts;
  }
}

export class ExchangeRateUnavailableError extends Error{
  constructor(message='目前沒有可用的匯率資料'){
    super(message);
    this.name='ExchangeRateUnavailableError';
    this.code='EXCHANGE_RATE_UNAVAILABLE';
  }
}

const greatestCommonDivisor=(left,right)=>{
  let a=left<0n?-left:left;
  let b=right<0n?-right:right;
  while(b!==0n)[a,b]=[b,a%b];
  return a;
};

const decimalToFraction=value=>{
  const normalized=String(value).trim();
  const match=/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(normalized);
  if(!match)throw new Error(`無效的匯率數值：${normalized}`);
  const fractionDigits=match[2]??'';
  const exponent=Number(match[3]??0);
  let numerator=BigInt(`${match[1]}${fractionDigits}`);
  let denominator=10n**BigInt(fractionDigits.length);
  if(exponent>0)numerator*=10n**BigInt(exponent);
  if(exponent<0)denominator*=10n**BigInt(-exponent);
  const divisor=greatestCommonDivisor(numerator,denominator);
  return{numerator:numerator/divisor,denominator:denominator/divisor};
};

const ratioToDecimal=(numerator,denominator,scale=15)=>{
  const factor=10n**BigInt(scale);
  const rounded=(numerator*factor+denominator/2n)/denominator;
  const whole=rounded/factor;
  const fraction=String(rounded%factor).padStart(scale,'0').replace(/0+$/u,'');
  return fraction?`${whole}.${fraction}`:String(whole);
};

export function createExchangeRateRatio(sourceRate,targetRate){
  const source=decimalToFraction(sourceRate);
  const target=decimalToFraction(targetRate);
  let numerator=target.numerator*source.denominator;
  let denominator=target.denominator*source.numerator;
  const divisor=greatestCommonDivisor(numerator,denominator);
  numerator/=divisor;
  denominator/=divisor;
  return Object.freeze({
    numerator:String(numerator),
    denominator:String(denominator),
    decimal:ratioToDecimal(numerator,denominator)
  });
}

async function fetchEndpoint({
  fetchImpl,
  endpoint,
  timeoutMs,
  setTimeoutFn,
  clearTimeoutFn
}){
  const controller=new AbortController();
  const timeoutId=setTimeoutFn(()=>controller.abort(new Error('匯率服務請求逾時')),timeoutMs);
  try{
    const response=await fetchImpl(endpoint,{
      method:'GET',
      headers:{accept:'application/json'},
      signal:controller.signal
    });
    if(!response||typeof response.ok!=='boolean'){
      throw new Error('匯率服務回應無效');
    }
    if(!response.ok)throw new Error(`匯率服務回應 HTTP ${response.status}`);
    return validateExchangeRatePayload(await response.json());
  }catch(error){
    if(controller.signal.aborted){
      const timeoutError=new Error(`匯率服務請求超過 ${timeoutMs} 毫秒`);
      timeoutError.name='ExchangeRateTimeoutError';
      throw timeoutError;
    }
    throw error;
  }finally{
    clearTimeoutFn(timeoutId);
  }
}

export async function fetchDailyExchangeRates({
  fetchImpl=globalThis.fetch,
  timeoutMs=DEFAULT_TIMEOUT_MS,
  provider=EXCHANGE_RATE_PROVIDER,
  setTimeoutFn=globalThis.setTimeout,
  clearTimeoutFn=globalThis.clearTimeout
}={}){
  if(typeof fetchImpl!=='function')throw new Error('執行環境不支援 fetch');
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('匯率請求逾時設定無效');

  const attempts=[];
  for(const [endpoint,url] of [
    ['primary',provider.primaryUrl],
    ['fallback',provider.fallbackUrl]
  ]){
    try{
      const snapshot=await fetchEndpoint({
        fetchImpl,
        endpoint:url,
        timeoutMs,
        setTimeoutFn,
        clearTimeoutFn
      });
      return{
        ...snapshot,
        provider:provider.id,
        endpoint,
        sourceUrl:url,
        fetchedAt:new Date()
      };
    }catch(error){
      attempts.push({endpoint,url,error});
    }
  }
  throw new ExchangeRateProviderError(attempts);
}

export async function ensureExchangeRateSchema(pool){
  const statements=[
    `CREATE TABLE IF NOT EXISTS exchange_rates (
      rate_date DATE NOT NULL,
      base_currency TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      rate NUMERIC(30, 15) NOT NULL CHECK (rate > 0),
      provider TEXT NOT NULL,
      source_url TEXT NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (rate_date, base_currency, quote_currency)
    )`,
    `CREATE INDEX IF NOT EXISTS exchange_rates_latest_idx
      ON exchange_rates (base_currency, rate_date DESC, quote_currency)`,
    `CREATE TABLE IF NOT EXISTS exchange_rate_sync_runs (
      id BIGSERIAL PRIMARY KEY,
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','success','failed','skipped_locked')),
      provider TEXT,
      endpoint TEXT,
      source_url TEXT,
      rate_date DATE,
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS exchange_rate_sync_runs_started_idx
      ON exchange_rate_sync_runs (started_at DESC)`
  ];
  for(const statement of statements)await pool.query(statement);
}

const runInsertSql=`INSERT INTO exchange_rate_sync_runs (reason,status,started_at)
  VALUES ($1,$2,$3) RETURNING id`;

async function recordSkippedRun(client,reason,now){
  await client.query(
    `INSERT INTO exchange_rate_sync_runs (reason,status,started_at,completed_at)
      VALUES ($1,'skipped_locked',$2,$2)`,
    [reason,now]
  );
}

async function persistSnapshot(client,runId,snapshot,now){
  await client.query('BEGIN');
  try{
    for(const currency of SUPPORTED_EXCHANGE_CURRENCIES){
      await client.query(
        `INSERT INTO exchange_rates
          (rate_date,base_currency,quote_currency,rate,provider,source_url,fetched_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
         ON CONFLICT (rate_date,base_currency,quote_currency) DO UPDATE SET
          rate=EXCLUDED.rate,
          provider=EXCLUDED.provider,
          source_url=EXCLUDED.source_url,
          fetched_at=EXCLUDED.fetched_at,
          updated_at=EXCLUDED.updated_at`,
        [
          snapshot.rateDate,
          snapshot.baseCurrency,
          currency,
          String(snapshot.rates[currency]),
          snapshot.provider,
          snapshot.sourceUrl,
          now
        ]
      );
    }
    await client.query(
      `UPDATE exchange_rate_sync_runs SET
        status='success',
        provider=$2,
        endpoint=$3,
        source_url=$4,
        rate_date=$5,
        completed_at=$6
       WHERE id=$1`,
      [runId,snapshot.provider,snapshot.endpoint,snapshot.sourceUrl,snapshot.rateDate,now]
    );
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }
}

async function recordFailedRun(client,runId,error,now){
  if(!runId)return;
  try{
    await client.query(
      `UPDATE exchange_rate_sync_runs SET
        status='failed',
        error_message=$2,
        completed_at=$3
       WHERE id=$1`,
      [runId,safeErrorMessage(error),now]
    );
  }catch{
    // 保留原始同步錯誤，避免紀錄失敗掩蓋真正原因。
  }
}

const asIsoDate=value=>{
  if(typeof value==='string')return value.slice(0,10);
  if(value instanceof Date&&!Number.isNaN(value.valueOf()))return value.toISOString().slice(0,10);
  return null;
};

export function getExchangeRateFreshness(rateDate,{now=new Date()}={}){
  const normalizedDate=asIsoDate(rateDate);
  if(!normalizedDate||!validIsoDate(normalizedDate)){
    return{
      status:'missing',
      available:false,
      stale:true,
      blocked:true,
      ageMs:null,
      rateDate:null,
      warning:'目前沒有可用的匯率資料'
    };
  }
  if(normalizedDate>addIsoDays(taipeiIsoDate(now),1)){
    return{
      status:'future',
      available:false,
      stale:true,
      blocked:true,
      ageMs:null,
      rateDate:normalizedDate,
      warning:'匯率資料日期異常，暫時無法切換幣別'
    };
  }
  const [year,month,day]=normalizedDate.split('-').map(Number);
  const taipeiDayStartUtc=Date.UTC(year,month-1,day)-TAIPEI_OFFSET_MS;
  const ageMs=Math.max(0,now.getTime()-taipeiDayStartUtc);
  if(ageMs>7*DAY_MS){
    return{
      status:'blocked',
      available:true,
      stale:true,
      blocked:true,
      ageMs,
      rateDate:normalizedDate,
      warning:'匯率資料已超過 7 天，暫時無法切換幣別'
    };
  }
  if(ageMs>72*60*60*1000){
    return{
      status:'stale',
      available:true,
      stale:true,
      blocked:false,
      ageMs,
      rateDate:normalizedDate,
      warning:'匯率資料已超過 72 小時，請確認後再切換幣別'
    };
  }
  return{
    status:'fresh',
    available:true,
    stale:false,
    blocked:false,
    ageMs,
    rateDate:normalizedDate,
    warning:null
  };
}

async function loadLatestCompleteSnapshot(queryable){
  const result=await queryable.query(
    `WITH latest_complete AS (
       SELECT rate_date
       FROM exchange_rates
       WHERE base_currency='TWD'
         AND quote_currency = ANY($1::text[])
         AND rate_date<=((now() AT TIME ZONE 'Asia/Taipei')::date+1)
       GROUP BY rate_date
       HAVING COUNT(DISTINCT quote_currency)=$2
       ORDER BY rate_date DESC
       LIMIT 1
     )
     SELECT
       er.rate_date,
       er.quote_currency,
       er.rate::text AS rate,
       er.provider,
       er.source_url,
       er.fetched_at
     FROM exchange_rates er
     JOIN latest_complete lc ON lc.rate_date=er.rate_date
     WHERE er.base_currency='TWD'
       AND er.quote_currency = ANY($1::text[])
     ORDER BY er.quote_currency`,
    [SUPPORTED_EXCHANGE_CURRENCIES,SUPPORTED_EXCHANGE_CURRENCIES.length]
  );
  if(!result.rows?.length)return null;
  const rates={};
  for(const row of result.rows)rates[row.quote_currency]=String(row.rate);
  if(SUPPORTED_EXCHANGE_CURRENCIES.some(currency=>!rates[currency]))return null;
  const first=result.rows[0];
  return{
    rateDate:asIsoDate(first.rate_date),
    baseCurrency:'TWD',
    rates,
    provider:first.provider,
    sourceUrl:first.source_url,
    fetchedAt:first.fetched_at
  };
}

export function createExchangeRateService({
  pool,
  fetchImpl=globalThis.fetch,
  timeoutMs=DEFAULT_TIMEOUT_MS,
  provider=EXCHANGE_RATE_PROVIDER,
  now=()=>new Date()
}={}){
  if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function'){
    throw new Error('建立匯率服務時必須提供 PostgreSQL pool');
  }

  const sync=async({reason='manual'}={})=>{
    const client=await pool.connect();
    let acquired=false;
    let runId=null;
    try{
      const lockResult=await client.query(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [EXCHANGE_RATE_LOCK_KEY]
      );
      acquired=Boolean(lockResult.rows?.[0]?.acquired);
      const startedAt=now();
      if(!acquired){
        await recordSkippedRun(client,reason,startedAt);
        return{ok:true,skipped:true,reason:'locked'};
      }

      const runResult=await client.query(runInsertSql,[reason,'running',startedAt]);
      runId=runResult.rows?.[0]?.id;
      const snapshot=await fetchDailyExchangeRates({fetchImpl,timeoutMs,provider});
      const completedAt=now();
      await persistSnapshot(client,runId,snapshot,completedAt);
      return{ok:true,skipped:false,snapshot};
    }catch(error){
      await recordFailedRun(client,runId,error,now());
      throw error;
    }finally{
      if(acquired){
        try{await client.query('SELECT pg_advisory_unlock($1)',[EXCHANGE_RATE_LOCK_KEY])}catch{}
      }
      client.release();
    }
  };

  const getLatestSnapshot=(queryable=pool)=>loadLatestCompleteSnapshot(queryable);

  const getHealth=async()=>{
    const snapshot=await getLatestSnapshot();
    const freshness=getExchangeRateFreshness(snapshot?.rateDate,{now:now()});
    const lastRunResult=await pool.query(
      `SELECT status,error_message,started_at,completed_at
       FROM exchange_rate_sync_runs
       ORDER BY started_at DESC
       LIMIT 1`
    );
    return{
      ...freshness,
      provider:snapshot?.provider??null,
      sourceUrl:snapshot?.sourceUrl??null,
      fetchedAt:snapshot?.fetchedAt??null,
      lastSync:lastRunResult.rows?.[0]??null
    };
  };

  const getConversionQuote=async({sourceCurrency,targetCurrency,queryable=pool}={})=>{
    const source=String(sourceCurrency??'').trim().toUpperCase();
    const target=String(targetCurrency??'').trim().toUpperCase();
    if(!SUPPORTED_EXCHANGE_CURRENCIES.includes(source)){
      throw new Error(`不支援的來源幣別：${source||'未指定'}`);
    }
    if(!SUPPORTED_EXCHANGE_CURRENCIES.includes(target)){
      throw new Error(`不支援的目標幣別：${target||'未指定'}`);
    }
    const snapshot=await getLatestSnapshot(queryable);
    if(!snapshot)throw new ExchangeRateUnavailableError();
    const freshness=getExchangeRateFreshness(snapshot.rateDate,{now:now()});
    const ratio=createExchangeRateRatio(snapshot.rates[source],snapshot.rates[target]);
    return{
      sourceCurrency:source,
      targetCurrency:target,
      rate:ratio.decimal,
      ratioNumerator:ratio.numerator,
      ratioDenominator:ratio.denominator,
      rateDate:snapshot.rateDate,
      source:snapshot.provider,
      provider:snapshot.provider,
      sourceUrl:snapshot.sourceUrl,
      fetchedAt:snapshot.fetchedAt,
      status:freshness.status,
      health:freshness
    };
  };

  return{
    ensureSchema:()=>ensureExchangeRateSchema(pool),
    sync,
    getLatestSnapshot,
    getHealth,
    getConversionQuote
  };
}

export function millisecondsUntilNextTaipeiSync(
  now=new Date(),
  {hour=DEFAULT_SYNC_HOUR,minute=DEFAULT_SYNC_MINUTE}={}
){
  const taipeiNow=new Date(now.getTime()+TAIPEI_OFFSET_MS);
  const targetUtc=Date.UTC(
    taipeiNow.getUTCFullYear(),
    taipeiNow.getUTCMonth(),
    taipeiNow.getUTCDate(),
    hour-8,
    minute,
    0,
    0
  );
  const nextTarget=targetUtc>now.getTime()?targetUtc:targetUtc+DAY_MS;
  return Math.max(1,nextTarget-now.getTime());
}

export function createExchangeRateScheduler({
  service,
  retryDelaysMs=DEFAULT_RETRY_DELAYS_MS,
  now=()=>new Date(),
  setTimeoutFn=globalThis.setTimeout,
  clearTimeoutFn=globalThis.clearTimeout,
  onError=error=>console.error('匯率同步失敗',error)
}={}){
  if(!service||typeof service.sync!=='function')throw new Error('排程器必須提供匯率服務');
  let stopped=true;
  let dailyTimer=null;
  let retryTimer=null;
  let retryResolver=null;
  let inFlight=null;

  const clearRetry=()=>{
    if(retryTimer!==null)clearTimeoutFn(retryTimer);
    retryTimer=null;
    if(retryResolver){
      const resolve=retryResolver;
      retryResolver=null;
      resolve(null);
    }
  };

  const scheduleDaily=()=>{
    if(stopped)return;
    if(dailyTimer!==null)clearTimeoutFn(dailyTimer);
    dailyTimer=setTimeoutFn(async()=>{
      dailyTimer=null;
      try{
        await runWithRetries('daily');
      }catch{
        // 錯誤已由 onError 回報；下一個每日排程仍須繼續運作。
      }finally{
        scheduleDaily();
      }
    },millisecondsUntilNextTaipeiSync(now()));
  };

  const runWithRetries=async reason=>{
    if(stopped)return null;
    if(inFlight)return inFlight;
    clearRetry();
    const execute=async attempt=>{
      try{
        const result=await service.sync({
          reason:attempt===0?reason:`${reason}:retry-${attempt}`
        });
        clearRetry();
        return result;
      }catch(error){
        onError(error);
        if(stopped||attempt>=retryDelaysMs.length)throw error;
        return new Promise(resolve=>{
          retryResolver=resolve;
          retryTimer=setTimeoutFn(()=>{
            retryTimer=null;
            retryResolver=null;
            resolve(execute(attempt+1));
          },retryDelaysMs[attempt]);
        });
      }
    };
    inFlight=execute(0).finally(()=>{inFlight=null});
    return inFlight;
  };

  const start=()=>{
    if(!stopped)return;
    stopped=false;
    void runWithRetries('startup').catch(()=>{});
    scheduleDaily();
  };

  const stop=()=>{
    stopped=true;
    if(dailyTimer!==null)clearTimeoutFn(dailyTimer);
    dailyTimer=null;
    clearRetry();
  };

  return{start,stop,runNow:()=>runWithRetries('manual')};
}

export const exchangeRateInternals=Object.freeze({
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RETRY_DELAYS_MS,
  EXCHANGE_RATE_LOCK_KEY,
  DAY_MS
});
