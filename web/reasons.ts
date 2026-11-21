// Why a rule applies (grammar/reasons.tsv, built into data/rules/reasons.json): an explanation
// in English and, once written, Irish, with the section of An Caighdeán Oifigiúil (2017).
import reasons from '../data/rules/reasons.json';
import { currentLocale } from './strings.ts';

export interface Reason {
  co17?: string;
  en: string;
  ga?: string;
}

const all: Record<string, Reason> = reasons;

/** The explanation for a reason id in the interface language (English if it has no Irish yet). */
export function reasonFor(id: string | undefined): { text: string; lang: string; co17?: string } | null {
  const r = id ? all[id] : undefined;
  if (!r) return null;
  if (currentLocale() === 'ga' && r.ga) return { text: r.ga, lang: 'ga', co17: r.co17 };
  return { text: r.en, lang: 'en', co17: r.co17 };
}
