import crypto from 'node:crypto';

const KEY_VERSION=1;
const KEY_BYTES=32;
const IV_BYTES=12;
const AUTH_TAG_BYTES=16;
const KEY_DOMAIN='dongda-split:bank-account:key:v1';
const AAD_DOMAIN='dongda-split:bank-account:aad:v1';

const fail=message=>{throw new Error(message)};
const trimmedString=(value,message)=>{
  if(typeof value!=='string')fail(message);
  return value.trim();
};
const characterCount=value=>Array.from(value).length;

export function normalizeBankAccount(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('銀行帳戶資料格式不正確');

  const bankCode=trimmedString(input.bankCode,'銀行代碼必須是 3 位數字');
  if(!/^\d{3}$/.test(bankCode))fail('銀行代碼必須是 3 位數字');

  const bankName=trimmedString(input.bankName,'銀行名稱必須是 1 至 60 個字');
  if(characterCount(bankName)<1||characterCount(bankName)>60)fail('銀行名稱必須是 1 至 60 個字');

  let branchCode=null;
  if(input.branchCode!==undefined&&input.branchCode!==null){
    const value=trimmedString(input.branchCode,'分行代碼必須留空或是 3 至 7 位數字');
    if(value){
      if(!/^\d{3,7}$/.test(value))fail('分行代碼必須留空或是 3 至 7 位數字');
      branchCode=value;
    }
  }

  const accountHolderName=trimmedString(input.accountHolderName,'戶名必須是 1 至 80 個字');
  if(characterCount(accountHolderName)<1||characterCount(accountHolderName)>80)fail('戶名必須是 1 至 80 個字');

  if(typeof input.accountNumber!=='string')fail('帳號移除空白與連字號後，必須是 6 至 20 位數字');
  const accountNumber=input.accountNumber.replace(/[\s-]/gu,'');
  if(!/^\d{6,20}$/.test(accountNumber))fail('帳號移除空白與連字號後，必須是 6 至 20 位數字');

  return{bankCode,bankName,branchCode,accountHolderName,accountNumber};
}

function decodeEncryptionKey(keyBase64){
  const encoded=typeof keyBase64==='string'?keyBase64.trim():'';
  if(!encoded||encoded.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)){
    fail('BANK_ACCOUNT_ENCRYPTION_KEY 必須是 32-byte base64');
  }
  const key=Buffer.from(encoded,'base64');
  if(key.length!==KEY_BYTES||key.toString('base64')!==encoded){
    fail('BANK_ACCOUNT_ENCRYPTION_KEY 必須是 32-byte base64');
  }
  return key;
}

function resolveEncryptionKey(keyBase64,fallbackSecret){
  if(typeof keyBase64==='string'&&keyBase64.trim())return decodeEncryptionKey(keyBase64);
  if(typeof fallbackSecret!=='string'||!fallbackSecret.trim())fail('銀行帳戶加密金鑰未設定');
  return crypto.createHash('sha256')
    .update(KEY_DOMAIN,'utf8')
    .update('\0','utf8')
    .update(fallbackSecret,'utf8')
    .digest();
}

function aadForUser(userId){
  if(typeof userId!=='string'||!userId.trim())fail('使用者識別碼不可空白');
  return Buffer.from(`${AAD_DOMAIN}\0${userId.trim()}`,'utf8');
}

function encryptedBuffer(value){
  return Buffer.isBuffer(value)?value:null;
}

export function createBankAccountCipher({keyBase64,fallbackSecret}={}){
  const key=resolveEncryptionKey(keyBase64,fallbackSecret);

  const encrypt=(userId,bankAccount)=>{
    const normalized=normalizeBankAccount(bankAccount);
    const iv=crypto.randomBytes(IV_BYTES);
    const cipher=crypto.createCipheriv('aes-256-gcm',key,iv,{authTagLength:AUTH_TAG_BYTES});
    cipher.setAAD(aadForUser(userId));
    const ciphertext=Buffer.concat([
      cipher.update(JSON.stringify(normalized),'utf8'),
      cipher.final()
    ]);
    return{ciphertext,iv,authTag:cipher.getAuthTag(),keyVersion:KEY_VERSION};
  };

  const decrypt=(userId,row)=>{
    const ciphertext=encryptedBuffer(row?.ciphertext);
    const iv=encryptedBuffer(row?.iv);
    const authTag=encryptedBuffer(row?.authTag);
    if(Number(row?.keyVersion)!==KEY_VERSION||!ciphertext||!iv||!authTag||!ciphertext.length||iv.length!==IV_BYTES||authTag.length!==AUTH_TAG_BYTES){
      fail('銀行帳戶加密資料格式不正確');
    }
    try{
      const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv,{authTagLength:AUTH_TAG_BYTES});
      decipher.setAAD(aadForUser(userId));
      decipher.setAuthTag(authTag);
      const plaintext=Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');
      return normalizeBankAccount(JSON.parse(plaintext));
    }catch{
      fail('銀行帳戶資料無法解密');
    }
  };

  return{encrypt,decrypt};
}
