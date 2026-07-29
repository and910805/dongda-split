import React,{createContext,useContext,useEffect,useMemo,useState} from 'react';
import {
  createTranslator,
  languageLocale,
  persistStoredLanguage,
  resolveStoredLanguage,
  translateApiErrorMessage,
} from './i18n-core.mjs';
import {apiErrorTranslations,commonMessages} from './locales/common.mjs';
import {landingMessages} from './locales/landing.mjs';
import {productMessages} from './locales/product.mjs';
import {adminMessages} from './locales/admin.mjs';
import {expenseMessages} from './locales/expense.mjs';

const messages=Object.freeze({
  ...commonMessages,
  ...landingMessages,
  ...productMessages,
  ...adminMessages,
  ...expenseMessages,
});

export function getStoredLanguage(){
  return resolveStoredLanguage({
    windowLike:typeof window==='undefined'?undefined:window,
    navigatorLike:typeof navigator==='undefined'?undefined:navigator,
  });
}

let activeLanguage=getStoredLanguage();

export function getLanguageHeaders(headers={},language=activeLanguage){
  return {...headers,'accept-language':language==='en'?'en':'zh-TW'};
}

export function translateApiMessage(message,language=activeLanguage){
  return translateApiErrorMessage(message,language,apiErrorTranslations);
}

const I18nContext=createContext(null);

export function LanguageProvider({children}){
  const [language,setLanguageState]=useState(()=>activeLanguage);
  const setLanguage=nextLanguage=>{
    const normalized=persistStoredLanguage(
      typeof window==='undefined'?undefined:window,
      nextLanguage,
    );
    activeLanguage=normalized;
    setLanguageState(normalized);
  };
  useEffect(()=>{
    if(typeof document==='undefined')return;
    activeLanguage=language;
    document.documentElement.lang=language;
    document.documentElement.dataset.language=language;
  },[language]);
  const value=useMemo(()=>{
    const t=createTranslator(language,messages);
    return{
      language,
      locale:languageLocale(language),
      isEnglish:language==='en',
      setLanguage,
      t,
      translateApiError:message=>translateApiMessage(message,language),
    };
  },[language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(){
  const context=useContext(I18nContext);
  if(!context)throw new Error('useI18n 必須在 LanguageProvider 內使用');
  return context;
}

export function LanguageSwitcher({className=''}) {
  const {language,setLanguage,t}=useI18n();
  return <div className={`language-switcher ${className}`.trim()} role="group" aria-label={t('language.label')}>
    <button type="button" className={language==='zh-TW'?'active':''} aria-pressed={language==='zh-TW'} aria-label={t('language.zh')} title={t('language.zh')} onClick={()=>setLanguage('zh-TW')}>中</button>
    <button type="button" className={language==='en'?'active':''} aria-pressed={language==='en'} aria-label={t('language.en')} title={t('language.en')} onClick={()=>setLanguage('en')}>EN</button>
  </div>;
}
