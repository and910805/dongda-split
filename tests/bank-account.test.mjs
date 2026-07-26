import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createBankAccountCipher,normalizeBankAccount} from '../bank-account.mjs';

const keyA=Buffer.alloc(32,0x11).toString('base64');
const keyB=Buffer.alloc(32,0x22).toString('base64');
const validAccount={
  bankCode:'004',
  bankName:'臺灣銀行',
  branchCode:' 1234 ',
  accountHolderName:' 王小明 ',
  accountNumber:' 0012-3456 7890 '
};

test('normalizes and round-trips a bank account with AES-256-GCM',()=>{
  const cipher=createBankAccountCipher({keyBase64:keyA,fallbackSecret:'ignored'});
  const encrypted=cipher.encrypt('user-1',validAccount);
  assert.equal(encrypted.keyVersion,1);
  assert.ok(Buffer.isBuffer(encrypted.ciphertext));
  assert.ok(Buffer.isBuffer(encrypted.iv));
  assert.ok(Buffer.isBuffer(encrypted.authTag));
  assert.equal(encrypted.iv.length,12);
  assert.equal(encrypted.authTag.length,16);
  assert.deepEqual(cipher.decrypt('user-1',encrypted),{
    bankCode:'004',
    bankName:'臺灣銀行',
    branchCode:'1234',
    accountHolderName:'王小明',
    accountNumber:'001234567890'
  });
});

test('preserves leading zeroes and accepts an empty branch code',()=>{
  const normalized=normalizeBankAccount({
    bankCode:'007',
    bankName:'第一銀行',
    branchCode:'   ',
    accountHolderName:'陳測試',
    accountNumber:'000-001 234'
  });
  assert.equal(normalized.bankCode,'007');
  assert.equal(normalized.branchCode,null);
  assert.equal(normalized.accountNumber,'000001234');
});

test('rejects invalid bank account fields with API-ready Error messages',()=>{
  const cases=[
    ['銀行帳戶資料格式不正確',null],
    ['銀行代碼必須是 3 位數字',{...validAccount,bankCode:'04'}],
    ['銀行代碼必須是 3 位數字',{...validAccount,bankCode:'0004'}],
    ['銀行代碼必須是 3 位數字',{...validAccount,bankCode:'0A4'}],
    ['銀行代碼必須是 3 位數字',{...validAccount,bankCode:4}],
    ['銀行名稱必須是 1 至 60 個字',{...validAccount,bankName:'   '}],
    ['銀行名稱必須是 1 至 60 個字',{...validAccount,bankName:'銀'.repeat(61)}],
    ['分行代碼必須留空或是 3 至 7 位數字',{...validAccount,branchCode:'12'}],
    ['分行代碼必須留空或是 3 至 7 位數字',{...validAccount,branchCode:'12345678'}],
    ['分行代碼必須留空或是 3 至 7 位數字',{...validAccount,branchCode:'12A'}],
    ['戶名必須是 1 至 80 個字',{...validAccount,accountHolderName:''}],
    ['戶名必須是 1 至 80 個字',{...validAccount,accountHolderName:'人'.repeat(81)}],
    ['帳號移除空白與連字號後，必須是 6 至 20 位數字',{...validAccount,accountNumber:'12345'}],
    ['帳號移除空白與連字號後，必須是 6 至 20 位數字',{...validAccount,accountNumber:'1'.repeat(21)}],
    ['帳號移除空白與連字號後，必須是 6 至 20 位數字',{...validAccount,accountNumber:'00123A456'}],
    ['帳號移除空白與連字號後，必須是 6 至 20 位數字',{...validAccount,accountNumber:123456}]
  ];
  for(const [message,input] of cases){
    assert.throws(()=>normalizeBankAccount(input),error=>error instanceof Error&&error.constructor===Error&&error.message===message);
  }
});

test('prefers a configured key over the fallback secret',()=>{
  const encrypted=createBankAccountCipher({keyBase64:keyA,fallbackSecret:'first'}).encrypt('user-1',validAccount);
  const decrypted=createBankAccountCipher({keyBase64:keyA,fallbackSecret:'second'}).decrypt('user-1',encrypted);
  assert.equal(decrypted.accountNumber,'001234567890');
});

test('derives a domain-separated key from the fallback secret',()=>{
  const cipher=createBankAccountCipher({fallbackSecret:'fallback-secret'});
  const encrypted=cipher.encrypt('derived-user',validAccount);
  assert.equal(cipher.decrypt('derived-user',encrypted).bankCode,'004');

  const rawSecretHash=crypto.createHash('sha256').update('fallback-secret').digest().toString('base64');
  assert.throws(
    ()=>createBankAccountCipher({keyBase64:rawSecretHash}).decrypt('derived-user',encrypted),
    error=>error instanceof Error&&error.message==='銀行帳戶資料無法解密'
  );
});

test('rejects malformed or incorrectly sized configured keys without falling back',()=>{
  for(const keyBase64 of ['not base64',Buffer.alloc(31).toString('base64'),keyA.replace(/=$/,'')]){
    assert.throws(
      ()=>createBankAccountCipher({keyBase64,fallbackSecret:'must-not-fallback'}),
      error=>error instanceof Error&&error.message==='BANK_ACCOUNT_ENCRYPTION_KEY 必須是 32-byte base64'
    );
  }
});

test('fails closed when no key or fallback secret is available',()=>{
  assert.throws(
    ()=>createBankAccountCipher({}),
    error=>error instanceof Error&&error.message==='銀行帳戶加密金鑰未設定'
  );
  assert.throws(
    ()=>createBankAccountCipher({fallbackSecret:'   '}),
    error=>error instanceof Error&&error.message==='銀行帳戶加密金鑰未設定'
  );
});

test('rejects decryption with the wrong key',()=>{
  const encrypted=createBankAccountCipher({keyBase64:keyA}).encrypt('user-1',validAccount);
  assert.throws(
    ()=>createBankAccountCipher({keyBase64:keyB}).decrypt('user-1',encrypted),
    error=>error instanceof Error&&error.message==='銀行帳戶資料無法解密'
  );
});

test('binds ciphertext to userId and key version through AAD/envelope validation',()=>{
  const cipher=createBankAccountCipher({keyBase64:keyA});
  const encrypted=cipher.encrypt('user-1',validAccount);
  assert.throws(
    ()=>cipher.decrypt('user-2',encrypted),
    error=>error instanceof Error&&error.message==='銀行帳戶資料無法解密'
  );
  assert.throws(
    ()=>cipher.decrypt('user-1',{...encrypted,keyVersion:2}),
    error=>error instanceof Error&&error.message==='銀行帳戶加密資料格式不正確'
  );
});

test('detects ciphertext, IV, and authentication-tag tampering',()=>{
  const cipher=createBankAccountCipher({keyBase64:keyA});
  const encrypted=cipher.encrypt('user-1',validAccount);
  for(const field of ['ciphertext','iv','authTag']){
    const changed=Buffer.from(encrypted[field]);
    changed[0]^=0x01;
    assert.throws(
      ()=>cipher.decrypt('user-1',{...encrypted,[field]:changed}),
      error=>error instanceof Error&&error.message==='銀行帳戶資料無法解密',
      `${field} tampering should be rejected`
    );
  }
});
