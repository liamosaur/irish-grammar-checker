import { APP_NAME } from './config.ts';
import { en, type StringKey } from './strings/en.ts';
import { ga } from './strings/ga.ts';

const locales: Record<string, Partial<Record<StringKey, string>>> = { en, ga };

function pickLocale(): string {
  try {
    const l = new URLSearchParams(location.search).get('lang');
    if (l && l in locales) return l;
  } catch { /* not in a page */ }
  return 'en';
}

const current = pickLocale();

const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

export function t(key: StringKey, vars: Record<string, string | number> = {}): string {
  return fill(locales[current][key] ?? en[key], { app: APP_NAME, ...vars });
}

/** Picks key.one for a count of 1 and key.other otherwise. */
export function tn(key: string, n: number, vars: Record<string, string | number> = {}): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}` as StringKey, { n, ...vars });
}

/** True when the chosen locale has every key, so <html lang> can honestly claim it. */
export const localeIsComplete = () => (Object.keys(en) as StringKey[]).every((k) => k in locales[current]);
export const currentLocale = () => current;

/** Writes text with [label](url) links into an element, without ever using innerHTML. */
export function setRich(el: Element, text: string): void {
  el.textContent = '';
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) el.append(text.slice(last, m.index));
    const url = m[2];
    if (/^(https:\/\/|#)/.test(url)) {
      const a = document.createElement('a');
      a.textContent = m[1];
      a.href = url;
      if (url.startsWith('http')) { a.rel = 'noopener noreferrer'; a.target = '_blank'; }
      el.append(a);
    } else el.append(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) el.append(text.slice(last));
}

/** Fills every [data-i18n], [data-i18n-rich] and [data-i18n-<attr>] element. */
export function applyStrings(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n as StringKey); });
  root.querySelectorAll<HTMLElement>('[data-i18n-rich]').forEach((el) => setRich(el, t(el.dataset.i18nRich as StringKey)));
  for (const attr of ['placeholder', 'aria-label', 'content']) {
    const ds = `data-i18n-${attr}`;
    root.querySelectorAll<HTMLElement>(`[${ds}]`).forEach((el) => el.setAttribute(attr, t(el.getAttribute(ds) as StringKey)));
  }
}
