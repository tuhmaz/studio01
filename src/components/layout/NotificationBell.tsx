"use client";

/**
 * Glocke im Kopf der Web-App: ungelesene Benachrichtigungen (alle 60 s und beim
 * Zurückkehren in den Tab), Liste im Popover, Klick öffnet die passende Seite.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Item {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

function ago(iso: string) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=30', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      setItems(json.data ?? []);
      setUnread(json.unread ?? 0);
    } catch {
      /* offline – nächster Versuch */
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const markRead = async (body: { ids?: string[]; all?: true }) => {
    await fetch('/api/notifications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).catch(() => undefined);
    load();
  };

  const openItem = (item: Item) => {
    if (!item.read) markRead({ ids: [item.id] });
    setOpen(false);
    if (item.link) router.push(item.link);
  };

  return (
    <Popover open={open} onOpenChange={value => { setOpen(value); if (value) load(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Benachrichtigungen${unread ? ` (${unread} ungelesen)` : ''}`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="font-bold text-sm">Benachrichtigungen</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => markRead({ all: true })}>
              <CheckCheck className="h-3.5 w-3.5 mr-1" /> Alle gelesen
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground text-center">Keine Benachrichtigungen</p>
        ) : (
          <ScrollArea className="max-h-[420px]">
            {items.map(item => (
              <button
                key={item.id}
                onClick={() => openItem(item)}
                className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted/60 flex gap-3 ${item.read ? '' : 'bg-primary/5'}`}
              >
                <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${item.read ? 'bg-transparent' : 'bg-primary'}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.title}</span>
                  <span className="block text-xs text-muted-foreground break-words">{item.body}</span>
                  <span className="block text-[11px] text-muted-foreground/70 mt-1">{ago(item.created_at)}</span>
                </span>
              </button>
            ))}
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
