import React, {useState} from 'react';

const PATHS = Object.freeze({
  edit: 'm15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-4-4L4 15v5Z',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  right: 'm9 5 7 7-7 7',
  calendar: 'M8 3v4m8-4v4M4 11h16M4 5h16v16H4Z',
  food: 'M5 3v7m3-7v7m3-7v7M5 8v2a3 3 0 0 0 6 0V8m-3 5v8m10-18v18m0-18c-4 4-4 10 0 10',
  info: 'M12 11v6m0-10v.3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  equal: 'M5 8h14M5 16h14',
  coins: 'M15 9A6 6 0 1 1 3 9a6 6 0 0 1 12 0M14 8a6 6 0 1 1-6 6m1-8v6m-2-1h4',
  split: 'M5 4v5a3 3 0 0 0 3 3h8a3 3 0 0 1 3 3v5M5 20v-5a3 3 0 0 1 3-3m8-6 3-3 3 3m-3-3v6',
  ratio: 'M5 20V10m7 10V4m7 16v-6',
  lock: 'M5 10h14v11H5ZM8 10V7a4 4 0 1 1 8 0v3m-4 5v2',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Zm-5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
});

export function EntryIcon({name, className = ''}) {
  return <svg viewBox="0 0 24 24" className={`es-icon ${className}`} aria-hidden="true" focusable="false"><path d={PATHS[name] || PATHS.info}/></svg>;
}

export function EntryAvatar({person, currentUserId, index = 0}) {
  const [failedUrl, setFailedUrl] = useState(null);
  const name = String(person.id) === String(currentUserId) ? 'You' : person.displayName || 'Member';
  return <span className={`es-avatar es-tone-${index % 4}`} aria-hidden="true">
    {person.pictureUrl && person.pictureUrl !== failedUrl
      ? <img src={person.pictureUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(person.pictureUrl)}/>
      : Array.from(name)[0]}
  </span>;
}

export function EntrySectionTitle({number, id, children, extra}) {
  return <div className="es-section-heading"><h3 id={id} tabIndex={-1}><span className="es-section-number" aria-hidden="true">{number}</span>{children}</h3>{extra}</div>;
}
