import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCHANGE_RATE_PROVIDER,
  ExchangeRateProviderError,
  SUPPORTED_EXCHANGE_CURRENCIES,
  createExchangeRateRatio,
  createExchangeRateScheduler,
  createExchangeRateService,
  fetchDailyExchangeRates,
  getExchangeRateFreshness,
  millisecondsUntilNextTaipeiSync,
  validateExchangeRatePayload
} from '../exchange-rates.mjs';

const validPayload=(overrides={})=>({
  date:'2026-07-27',
  twd:{
    twd:1,
    jpy:5.05025377,
    krw:45.27564992,
    usd:0.030868902,
    cny:0.20897796,
    thb:1.03608976
  },
  ...overrides
});

const response=(payload,{ok=true,status=200}={})=>({
  ok,
  status,
  json:async()=>payload
});

test('驗證並正規化六種 TWD 基準匯率',()=>{
  const result=validateExchangeRatePayload(validPayload());
  assert.equal(result.rateDate,'2026-07-27');
  assert.equal(result.baseCurrency,'TWD');
  assert.deepEqual(Object.keys(result.rates),SUPPORTED_EXCHANGE_CURRENCIES);
  assert.equal(result.rates.JPY,5.05025377);
  assert.equal(result.rates.USD,0.030868902);
});

test('主要端點成功時不呼叫備援端點',async()=>{
  const urls=[];
  const snapshot=await fetchDailyExchangeRates({
    fetchImpl:async url=>{
      urls.push(url);
      return response(validPayload());
    }
  });
  assert.deepEqual(urls,[EXCHANGE_RATE_PROVIDER.primaryUrl]);
  assert.equal(snapshot.endpoint,'primary');
  assert.equal(snapshot.sourceUrl,EXCHANGE_RATE_PROVIDER.primaryUrl);
});

test('主要端點失敗時改用官方 Cloudflare 鏡像',async()=>{
  const urls=[];
  const snapshot=await fetchDailyExchangeRates({
    fetchImpl:async url=>{
      urls.push(url);
      if(url===EXCHANGE_RATE_PROVIDER.primaryUrl)throw new Error('CDN 暫時無法使用');
      return response(validPayload());
    }
  });
  assert.deepEqual(urls,[
    EXCHANGE_RATE_PROVIDER.primaryUrl,
    EXCHANGE_RATE_PROVIDER.fallbackUrl
  ]);
  assert.equal(snapshot.endpoint,'fallback');
  assert.equal(snapshot.provider,'fawazahmed0');
});

test('主要端點回傳壞資料時也會嘗試備援端點',async()=>{
  const urls=[];
  const snapshot=await fetchDailyExchangeRates({
    fetchImpl:async url=>{
      urls.push(url);
      if(url===EXCHANGE_RATE_PROVIDER.primaryUrl){
        return response(validPayload({twd:{twd:1,jpy:5}}));
      }
      return response(validPayload());
    }
  });
  assert.equal(urls.length,2);
  assert.equal(snapshot.endpoint,'fallback');
});

test('兩個端點皆逾時時中止請求並回報各次嘗試',async()=>{
  let aborted=0;
  const fetchImpl=(_url,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>{
      aborted+=1;
      reject(signal.reason);
    },{once:true});
  });

  await assert.rejects(
    fetchDailyExchangeRates({fetchImpl,timeoutMs:5}),
    error=>{
      assert.ok(error instanceof ExchangeRateProviderError);
      assert.equal(error.attempts.length,2);
      assert.ok(error.attempts.every(attempt=>attempt.error.name==='ExchangeRateTimeoutError'));
      return true;
    }
  );
  assert.equal(aborted,2);
});

test('兩個端點皆為無效資料時拒絕同步',async()=>{
  await assert.rejects(
    fetchDailyExchangeRates({
      fetchImpl:async()=>response(validPayload({date:'2026-02-30'}))
    }),
    error=>{
      assert.ok(error instanceof ExchangeRateProviderError);
      assert.equal(error.attempts.length,2);
      assert.match(error.message,/缺少有效日期/);
      return true;
    }
  );
});

test('拒絕不合理的未來日期，避免錯誤資料長期壓住每日匯率',()=>{
  assert.throws(
    ()=>validateExchangeRatePayload(validPayload({date:'2099-01-01'}),{
      now:new Date('2026-07-28T00:00:00.000Z')
    }),
    /超出合理的未來範圍/
  );
  const future=getExchangeRateFreshness('2099-01-01',{
    now:new Date('2026-07-28T00:00:00.000Z')
  });
  assert.equal(future.status,'future');
  assert.equal(future.available,false);
  assert.equal(future.blocked,true);
});

test('匯率新鮮度依 72 小時與 7 天門檻回報',()=>{
  const fresh=getExchangeRateFreshness('2026-07-27',{
    now:new Date('2026-07-28T00:00:00.000Z')
  });
  assert.equal(fresh.status,'fresh');
  assert.equal(fresh.blocked,false);

  const stale=getExchangeRateFreshness('2026-07-24',{
    now:new Date('2026-07-28T00:00:01.000Z')
  });
  assert.equal(stale.status,'stale');
  assert.equal(stale.blocked,false);

  const blocked=getExchangeRateFreshness('2026-07-20',{
    now:new Date('2026-07-28T00:00:01.000Z')
  });
  assert.equal(blocked.status,'blocked');
  assert.equal(blocked.blocked,true);

  const missing=getExchangeRateFreshness(null);
  assert.equal(missing.status,'missing');
  assert.equal(missing.available,false);
});

test('以精確分數建立來源幣別至目標幣別匯率',()=>{
  const ratio=createExchangeRateRatio('5','0.03');
  assert.deepEqual(ratio,{
    numerator:'3',
    denominator:'500',
    decimal:'0.006'
  });
  assert.deepEqual(createExchangeRateRatio('1','1'),{
    numerator:'1',
    denominator:'1',
    decimal:'1'
  });
});

test('同步服務使用 advisory lock 並以 upsert 保存六種匯率',async()=>{
  const queries=[];
  let released=false;
  const client={
    query:async(sql,params=[])=>{
      queries.push({sql,params});
      if(sql.includes('pg_try_advisory_lock'))return{rows:[{acquired:true}]};
      if(sql.includes('INSERT INTO exchange_rate_sync_runs')&&sql.includes('RETURNING id')){
        return{rows:[{id:'91'}]};
      }
      return{rows:[]};
    },
    release:()=>{released=true}
  };
  const pool={
    query:async()=>({rows:[]}),
    connect:async()=>client
  };
  const service=createExchangeRateService({
    pool,
    now:()=>new Date('2026-07-28T01:00:00.000Z'),
    fetchImpl:async()=>response(validPayload())
  });
  const result=await service.sync({reason:'test'});

  assert.equal(result.ok,true);
  assert.equal(result.skipped,false);
  assert.equal(
    queries.filter(({sql})=>sql.includes('INSERT INTO exchange_rates')).length,
    SUPPORTED_EXCHANGE_CURRENCIES.length
  );
  assert.ok(queries.some(({sql})=>sql==='BEGIN'));
  assert.ok(queries.some(({sql})=>sql==='COMMIT'));
  assert.ok(queries.some(({sql})=>sql.includes('pg_advisory_unlock')));
  assert.equal(released,true);
});

test('拿不到 advisory lock 時略過同步且不呼叫供應商',async()=>{
  let fetchCalls=0;
  const client={
    query:async sql=>{
      if(sql.includes('pg_try_advisory_lock'))return{rows:[{acquired:false}]};
      return{rows:[]};
    },
    release:()=>{}
  };
  const service=createExchangeRateService({
    pool:{query:async()=>({rows:[]}),connect:async()=>client},
    fetchImpl:async()=>{
      fetchCalls+=1;
      return response(validPayload());
    }
  });
  const result=await service.sync({reason:'test'});
  assert.deepEqual(result,{ok:true,skipped:true,reason:'locked'});
  assert.equal(fetchCalls,0);
});

test('服務回傳可顯示小數與可持久化的精確換算分數',async()=>{
  const rates={
    TWD:'1',
    JPY:'5',
    KRW:'45',
    USD:'0.03',
    CNY:'0.21',
    THB:'1.04'
  };
  const pool={
    connect:async()=>{throw new Error('此測試不應連線')},
    query:async sql=>{
      if(sql.includes('WITH latest_complete')){
        return{
          rows:SUPPORTED_EXCHANGE_CURRENCIES.map(currency=>({
            rate_date:'2026-07-27',
            quote_currency:currency,
            rate:rates[currency],
            provider:'fawazahmed0',
            source_url:EXCHANGE_RATE_PROVIDER.primaryUrl,
            fetched_at:new Date('2026-07-28T00:00:00.000Z')
          }))
        };
      }
      return{rows:[]};
    }
  };
  const service=createExchangeRateService({
    pool,
    now:()=>new Date('2026-07-28T00:00:00.000Z')
  });
  const quote=await service.getConversionQuote({
    sourceCurrency:'jpy',
    targetCurrency:'usd'
  });
  assert.equal(quote.rate,'0.006');
  assert.equal(quote.ratioNumerator,'3');
  assert.equal(quote.ratioDenominator,'500');
  assert.equal(quote.rateDate,'2026-07-27');
  assert.equal(quote.source,'fawazahmed0');
  assert.equal(quote.status,'fresh');
  assert.equal(quote.health.blocked,false);
});

test('台北 08:15 排程會計算當日或隔日觸發時間',()=>{
  assert.equal(
    millisecondsUntilNextTaipeiSync(new Date('2026-07-28T00:00:00.000Z')),
    15*60*1000
  );
  assert.equal(
    millisecondsUntilNextTaipeiSync(new Date('2026-07-28T00:16:00.000Z')),
    (23*60+59)*60*1000
  );
});

test('排程失敗後依序安排 5 分鐘、30 分鐘與 2 小時重試',async()=>{
  const delays=[];
  const callbacks=[];
  let attempts=0;
  const service={
    sync:async()=>{
      attempts+=1;
      if(attempts<4)throw new Error(`第 ${attempts} 次失敗`);
      return{ok:true};
    }
  };
  const scheduler=createExchangeRateScheduler({
    service,
    now:()=>new Date('2026-07-28T00:00:00.000Z'),
    setTimeoutFn:(callback,delay)=>{
      delays.push(delay);
      callbacks.push(callback);
      return callbacks.length;
    },
    clearTimeoutFn:()=>{},
    onError:()=>{}
  });

  scheduler.start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(delays.includes(5*60*1000));
  const firstRetryIndex=delays.indexOf(5*60*1000);
  callbacks[firstRetryIndex]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(delays.includes(30*60*1000));
  const secondRetryIndex=delays.indexOf(30*60*1000);
  callbacks[secondRetryIndex]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(delays.includes(2*60*60*1000));
  const thirdRetryIndex=delays.indexOf(2*60*60*1000);
  callbacks[thirdRetryIndex]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(attempts,4);
  scheduler.stop();
});
