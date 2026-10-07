import { api } from './api';
import type { Candidate, Identity, PaintColor, Spec, SpecSheet, VinDetails } from './types';

export interface IdentifyResult {
  photo: string;
  found: boolean;
  kind?: string;
  box?: [number, number, number, number];
  size?: [number, number];
  share?: number;
  candidates: (Candidate & { year?: number; vclass?: string })[];
  color?: PaintColor;
  ms: number;
}

export interface VinResult {
  vin: string;
  found?: boolean;
  checkDigit: boolean;
  decoded: boolean;
  family: { make: string; model: string; year: number } | null;
  make: string;
  model: string | null;
  year: string | null;
  trim: string | null;
  body: string | null;
  details?: VinDetails;
  tried?: string[];
}

export const identifyPhoto = (file: Blob) => api.upload<IdentifyResult>('/identify', file);

/** The best match in a photo as an identity (with the runners-up), or null when no car was found. */
export function identityFrom(r: IdentifyResult): Identity | null {
  const top = r.candidates[0];
  if (!r.found || !top) return null;
  return {
    make: top.make,
    model: top.model,
    yearFrom: top.yearFrom,
    yearTo: top.yearTo,
    year: top.year ?? top.yearTo,
    confidence: top.confidence,
    source: 'photo',
    alternatives: r.candidates.slice(1, 5).map(({ make, model, yearFrom, yearTo, confidence }) => ({ make, model, yearFrom, yearTo, confidence })),
  };
}

/** The two figures a spotted car is listed with: engine and economy (or range, for an EV). */
export function headlineSpecs(sheet: SpecSheet): Spec[] {
  return sheet.groups
    .flatMap((g) => g.items)
    .filter((i) => ['Engine', 'Combined', 'Range'].includes(i.label))
    .slice(0, 2);
}
export const readVinPhoto = (file: Blob) => api.upload<VinResult>('/vin/read', file);
export const lookupVin = (vin: string) => api.get<VinResult>(`/vin/${encodeURIComponent(vin.trim().toUpperCase())}`);

export function fetchSpecs(p: { year: number; make: string; model: string; variant?: number | null; vin?: string | null }) {
  const q = new URLSearchParams({ year: String(p.year), make: p.make, model: p.model });
  if (p.variant) q.set('variant', String(p.variant));
  if (p.vin) q.set('vin', p.vin);
  return api.get<SpecSheet>(`/specs?${q}`);
}

export const catalog = {
  makes: () => api.get<string[]>('/catalog/makes'),
  models: (make: string) => api.get<{ model: string; yearFrom: number; yearTo: number }[]>(`/catalog/models?make=${encodeURIComponent(make)}`),
  years: (make: string, model: string) =>
    api.get<number[]>(`/catalog/years?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`),
};

/** "VIN" letters a VIN can't contain and what they almost always are. */
export function cleanVin(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/I/g, '1').replace(/[OQ]/g, '0').slice(0, 17);
}
