const INVITE_PATH = /^\/invite\/([A-Za-z0-9_-]{16,128})\/?$/;

export function parseInviteLink(value, currentOrigin) {
  const input = String(value || '').trim();
  if (!input) throw new Error('請貼上旅帳邀請連結');
  if (input.length > 2048) throw new Error('邀請連結過長');

  let origin;
  let url;
  try {
    origin = new URL(currentOrigin).origin;
    url = new URL(input, `${origin}/`);
  } catch {
    throw new Error('邀請連結格式不正確');
  }

  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) {
    throw new Error('請貼上目前旅帳網域的邀請連結');
  }
  const match = INVITE_PATH.exec(url.pathname);
  if (!match || url.search || url.hash) throw new Error('請貼上 /invite/ 開頭的完整邀請連結');
  return match[1];
}
