/**
 * Hält den Postausgang am Laufen: sendet beim Start, wenn die App wieder in den
 * Vordergrund kommt, wenn das Netz zurückkommt und regelmäßig, solange etwas
 * wartet. Stellt Zähler für die Anzeige bereit.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { useAuth } from '@/context/AuthContext';
import { flushWinterQueue, queuedEntries } from '@/api/winter';
import {
  discardFailed, failedOps, flush, onOutboxChange, pendingOps, retryFailed, type FailedOp,
} from '@/sync/outbox';

interface SyncState {
  online: boolean;
  syncing: boolean;
  /** Wartende Vorgänge inkl. Winterdienst-Einträge. */
  pending: number;
  failed: FailedOp[];
  lastSyncAt: string | null;
  syncNow: () => Promise<void>;
  retry: (op: FailedOp) => Promise<void>;
  discard: (op: FailedOp) => Promise<void>;
}

const SyncContext = createContext<SyncState>({
  online: true, syncing: false, pending: 0, failed: [], lastSyncAt: null,
  syncNow: async () => {}, retry: async () => {}, discard: async () => {},
});

const POLL_MS = 15000;

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<FailedOp[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const busy = useRef(false);
  const wasOnline = useRef(true);

  const refreshCounts = useCallback(async () => {
    if (!user) { setPending(0); setFailed([]); return; }
    const [ops, winter, bad] = await Promise.all([pendingOps(user.id), queuedEntries(), failedOps(user.id)]);
    setPending(ops.length + winter.length);
    setFailed(bad);
  }, [user]);

  const syncNow = useCallback(async () => {
    if (!user || busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      const net = await Network.getNetworkStateAsync().catch(() => null);
      const isOnline = net?.isConnected !== false;
      setOnline(isOnline);
      wasOnline.current = isOnline;
      if (!isOnline) return;
      // Reihenfolge: erst Zeiterfassung/Checkliste/Notizen, dann Winterdienst.
      await flush(user.id);
      await flushWinterQueue().catch(() => null);
      setLastSyncAt(new Date().toISOString());
    } finally {
      busy.current = false;
      setSyncing(false);
      await refreshCounts();
    }
  }, [user, refreshCounts]);

  // Änderungen im Postausgang → Zähler aktualisieren.
  useEffect(() => onOutboxChange(() => { void refreshCounts(); }), [refreshCounts]);

  // Start + regelmäßig (nur wenn etwas wartet oder wir offline waren).
  useEffect(() => {
    void refreshCounts().then(() => syncNow());
    const id = setInterval(async () => {
      const net = await Network.getNetworkStateAsync().catch(() => null);
      const isOnline = net?.isConnected !== false;
      const cameBack = !wasOnline.current && isOnline;
      wasOnline.current = isOnline;
      setOnline(isOnline);
      if (isOnline && (cameBack || pending > 0)) void syncNow();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refreshCounts, syncNow, pending]);

  // App wieder im Vordergrund → senden.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void syncNow(); });
    return () => sub.remove();
  }, [syncNow]);

  const retry = useCallback(async (op: FailedOp) => { await retryFailed(op); await syncNow(); }, [syncNow]);
  const discard = useCallback(async (op: FailedOp) => { await discardFailed(op); await refreshCounts(); }, [refreshCounts]);

  return (
    <SyncContext.Provider value={{ online, syncing, pending, failed, lastSyncAt, syncNow, retry, discard }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}
