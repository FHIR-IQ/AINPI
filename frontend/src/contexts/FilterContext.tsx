'use client';

import { createContext, useContext, useState, ReactNode, useCallback } from 'react';

export interface NPDFilters {
  state: string | null;
  city: string | null;
  specialty: string | null;
  orgId: string | null;
}

interface FilterContextValue {
  filters: NPDFilters;
  setState: (state: string | null) => void;
  setCity: (city: string | null) => void;
  setSpecialty: (specialty: string | null) => void;
  setOrg: (orgId: string | null) => void;
  clearAll: () => void;
  isFiltered: boolean;
  activeCount: number;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<NPDFilters>({
    state: null,
    city: null,
    specialty: null,
    orgId: null,
  });

  const setState = useCallback((state: string | null) => {
    // Clearing state also clears city (hierarchical)
    setFilters((f) => state === null ? { ...f, state: null, city: null } : { ...f, state });
  }, []);

  const setCity = useCallback((city: string | null) => {
    setFilters((f) => ({ ...f, city }));
  }, []);

  const setSpecialty = useCallback((specialty: string | null) => {
    setFilters((f) => ({ ...f, specialty }));
  }, []);

  const setOrg = useCallback((orgId: string | null) => {
    setFilters((f) => ({ ...f, orgId }));
  }, []);

  const clearAll = useCallback(() => {
    setFilters({ state: null, city: null, specialty: null, orgId: null });
  }, []);

  const activeCount = [filters.state, filters.city, filters.specialty, filters.orgId].filter(Boolean).length;

  return (
    <FilterContext.Provider
      value={{
        filters,
        setState,
        setCity,
        setSpecialty,
        setOrg,
        clearAll,
        isFiltered: activeCount > 0,
        activeCount,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within FilterProvider');
  return ctx;
}
