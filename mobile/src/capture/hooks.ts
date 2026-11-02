import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useDatabase } from '../db/DatabaseProvider';
import { readPendingNotifications } from './readPending';
import { countSuggestions, listRecent, listSuggestions } from './store';

const key = (name: string) => ['local', 'capture', name] as const;

/**
 * Reads what the native service kept - now, and every time the app comes back to the front - so a payment made
 * while the app was closed is waiting as a suggestion when it opens.
 */
export function useReadCapturedNotifications(): () => Promise<void> {
  const database = useDatabase();
  const queryClient = useQueryClient();
  const read = useCallback(async () => {
    const added = await readPendingNotifications(database);
    if (added > 0) await queryClient.invalidateQueries({ queryKey: ['local', 'capture'] });
  }, [database, queryClient]);

  useEffect(() => {
    void read();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void read();
    });
    return () => subscription.remove();
  }, [read]);
  return read;
}

export function useSuggestions() {
  const database = useDatabase();
  return useQuery({ queryKey: key('suggestions'), queryFn: () => listSuggestions(database) });
}

export function useSuggestionCount() {
  const database = useDatabase();
  return useQuery({ queryKey: key('count'), queryFn: () => countSuggestions(database) });
}

export function useCapturedLog() {
  const database = useDatabase();
  return useQuery({ queryKey: key('log'), queryFn: () => listRecent(database) });
}
