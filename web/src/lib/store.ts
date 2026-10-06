import { create } from 'zustand';
import { api, ApiError } from './api';
import type { Car, Spotted } from './types';

interface GarageState {
  cars: Car[];
  spotted: Spotted[];
  loaded: boolean;
  /** null until the first check; false when the local API can't be reached. */
  online: boolean | null;
  load: () => Promise<void>;
  addCar: (car: Omit<Car, 'id' | 'createdAt'>) => Promise<Car>;
  updateCar: (id: string, patch: Partial<Car>) => Promise<Car>;
  removeCar: (id: string) => Promise<void>;
  addSpotted: (s: Omit<Spotted, 'id' | 'createdAt'>) => Promise<Spotted>;
  updateSpotted: (id: string, patch: Partial<Spotted>) => Promise<Spotted>;
  removeSpotted: (id: string) => Promise<void>;
}

export const useGarage = create<GarageState>((set, get) => ({
  cars: [],
  spotted: [],
  loaded: false,
  online: null,
  load: async () => {
    try {
      const [cars, spotted] = await Promise.all([api.get<Car[]>('/cars'), api.get<Spotted[]>('/spotted')]);
      set({ cars, spotted, loaded: true, online: true });
    } catch (e) {
      set({ loaded: true, online: !(e instanceof ApiError && e.status === 0) });
    }
  },
  addCar: async (car) => {
    const saved = await api.post<Car>('/cars', car);
    set({ cars: [saved, ...get().cars] });
    return saved;
  },
  updateCar: async (id, patch) => {
    const saved = await api.patch<Car>(`/cars/${id}`, patch);
    set({ cars: get().cars.map((c) => (c.id === id ? saved : c)) });
    return saved;
  },
  removeCar: async (id) => {
    await api.del(`/cars/${id}`);
    set({ cars: get().cars.filter((c) => c.id !== id) });
  },
  addSpotted: async (s) => {
    const saved = await api.post<Spotted>('/spotted', s);
    set({ spotted: [saved, ...get().spotted] });
    return saved;
  },
  updateSpotted: async (id, patch) => {
    const saved = await api.patch<Spotted>(`/spotted/${id}`, patch);
    set({ spotted: get().spotted.map((s) => (s.id === id ? saved : s)) });
    return saved;
  },
  removeSpotted: async (id) => {
    await api.del(`/spotted/${id}`);
    set({ spotted: get().spotted.filter((s) => s.id !== id) });
  },
}));

/** "2016–2018 Honda Civic", "2018 Honda Civic". */
export function carName(i: Car['identity'], withYear = true): string {
  if (!i) return 'Unidentified car';
  const year = i.year ?? (i.yearFrom === i.yearTo ? i.yearFrom : null);
  const years = year ? `${year}` : `${i.yearFrom}–${String(i.yearTo).slice(-2)}`;
  return `${withYear ? `${years} ` : ''}${i.make} ${i.model}`;
}
