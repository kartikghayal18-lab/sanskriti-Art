/** Input validation helpers. Each throws a 400 with a readable message. */
import { bad } from './http.js';

export function str(v, label, { max = 200, required = false, min = 0 } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' && typeof v !== 'number') throw bad(`${label} must be text.`);
  const s = String(v).trim();
  if (required && !s) throw bad(`${label} is required.`);
  if (s && s.length < min) throw bad(`${label} is too short.`);
  if (s.length > max) throw bad(`${label} must be ${max} characters or fewer.`);
  return s;
}
export function int(v, label, { min = 0, max = 10_000_000, required = true, nullable = false } = {}) {
  if (v === '' || v === null || v === undefined) {
    if (nullable) return null;
    if (required) throw bad(`${label} is required.`);
    return 0;
  }
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`${label} must be a whole number.`);
  if (n < min || n > max) throw bad(`${label} must be between ${min} and ${max}.`);
  return n;
}
export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
export function oneOf(v, label, options) {
  if (!options.includes(v)) throw bad(`${label} is not valid.`);
  return v;
}
export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
export function slug(v, fallbackFrom, label = 'Slug') {
  const s = slugify(v || fallbackFrom || '');
  if (!s) throw bad(`${label} is required.`);
  return s;
}
export function phone(v) {
  const digits = String(v || '').replace(/[^\d+]/g, '');
  const bare = digits.replace(/^\+/, '');
  if (bare.length < 10 || bare.length > 15) throw bad('Please enter a valid phone number.');
  return digits;
}
export function email(v, { required = false } = {}) {
  const s = str(v, 'Email', { max: 160, required });
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Please enter a valid email address.');
  return s;
}
/** Image/asset URLs: our own uploads or site assets only. */
export function assetUrl(v, label = 'Image') {
  const s = str(v, label, { max: 300 });
  if (s && !/^\/(uploads|assets)\/[\w\-./]+$/.test(s)) throw bad(`${label} must be an uploaded image.`);
  if (s.includes('..')) throw bad(`${label} is not valid.`);
  return s;
}
export function url(v, label) {
  const s = str(v, label, { max: 300 });
  if (s && !/^https:\/\/[^\s]+$/.test(s)) throw bad(`${label} must start with https://`);
  return s;
}
