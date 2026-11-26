export function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return false;
  const allowed = String(allowedOrigins || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;

  let url;
  try { url = new URL(origin); } catch { return false; }
  if (url.origin !== origin || url.protocol !== 'https:' || url.port !== '') return false;

  return allowed.some((pattern) => {
    if (!/^https:\/\/\*-[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(pattern)) return false;
    const suffix = pattern.slice('https://*'.length);
    if (!url.hostname.endsWith(suffix)) return false;
    const prefix = url.hostname.slice(0, -suffix.length);
    return url.hostname.split('.')[0].length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(prefix);
  });
}
