import { useEffect, useState } from 'react';

import {
  checkNip05Availability,
  findAvailableNip05Suggestions,
  type Nip05Availability,
} from './client';
import { validatePublicPageUsername } from '@/onboarding/publicPageUsername';

export interface NameAvailabilityViewState {
  readonly availability: Nip05Availability | null;
  readonly checking: boolean;
  readonly suggestions: readonly string[];
}

export function useNameAvailability(
  name: string,
  registeredName: string,
  delayMs = 400
): NameAvailabilityViewState {
  const [state, setState] = useState<NameAvailabilityViewState>({
    availability: null,
    checking: false,
    suggestions: [],
  });

  useEffect(() => {
    if (validatePublicPageUsername(name).kind !== 'valid') {
      setState({ availability: null, checking: false, suggestions: [] });
      return;
    }
    if (name === registeredName) {
      setState({
        availability: { status: 'available', name },
        checking: false,
        suggestions: [],
      });
      return;
    }

    let cancelled = false;
    setState({ availability: null, checking: true, suggestions: [] });
    const timer = setTimeout(() => {
      void checkNip05Availability(name).then(async (availability) => {
        if (cancelled) return;
        const shouldSuggest =
          availability.status === 'unavailable' &&
          (availability.reason === 'taken' || availability.reason === 'tombstoned');
        const suggestions = shouldSuggest
          ? await findAvailableNip05Suggestions(name)
          : [];
        if (!cancelled) setState({ availability, checking: false, suggestions });
      });
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [delayMs, name, registeredName]);

  return state;
}
