'use client';

/** Anzeige eines Leistungsnachweises: Kennzahlen + Einsätze mit Leistungen und Fotos. */
import { CheckCircle2, CircleDashed, Image as ImageIcon, Loader2, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  STATUS_TEXT,
  fmtReportDate,
  fmtReportTime,
  type ItemStatus,
  type LeistungsnachweisReport,
} from '@/lib/leistungsnachweis-types';

function StatusIcon({ status }: { status: ItemStatus }) {
  if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
  if (status === 'not_possible') return <XCircle className="w-4 h-4 text-red-600 shrink-0" />;
  return <CircleDashed className="w-4 h-4 text-gray-400 shrink-0" />;
}

interface Props {
  report: LeistungsnachweisReport | null;
  loading: boolean;
  monthLabel: string;
  emptyHint?: string;
}

export function LeistungsnachweisView({ report, loading, monthLabel, emptyHint }: Props) {
  const t = report?.totals;
  const showTeam = report?.showWorkerNames ?? true;

  return (
    <div className="space-y-6">
      {t && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Erfüllungsquote', value: t.compliancePercent == null ? '—' : `${t.compliancePercent.toLocaleString('de-DE')} %`, strong: true },
            { label: 'Erledigt', value: `${t.done} / ${t.planned}` },
            { label: 'Nicht möglich', value: String(t.notPossible) },
            { label: 'Ohne Rückmeldung', value: String(t.open) },
            { label: 'Einsätze', value: String(t.visits) },
          ].map(card => (
            <Card key={card.label} className={`rounded-2xl border-none shadow-sm ${card.strong ? 'bg-primary text-white' : ''}`}>
              <CardContent className="p-4">
                <p className={`text-[10px] font-black uppercase tracking-widest ${card.strong ? 'text-white/70' : 'text-muted-foreground'}`}>{card.label}</p>
                <p className="text-2xl font-black mt-1">{card.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="rounded-3xl border-none shadow-lg overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !report || report.visits.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16 px-6">
              Keine Einsätze mit Leistungen für dieses Objekt in {monthLabel}.
              {emptyHint ? ` ${emptyHint}` : ''}
            </p>
          ) : (
            <div className="divide-y">
              {report.visits.map(v => (
                <div key={v.id} className="p-5 grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
                  <div>
                    <p className="font-black">{fmtReportDate(v.date)}</p>
                    {showTeam && <p className="text-xs text-muted-foreground mt-1">{v.workers.join(', ') || 'ohne Team'}</p>}
                  </div>
                  <ul className="space-y-2">
                    {v.items.map(item => (
                      <li key={item.code} className="flex items-start gap-3">
                        <StatusIcon status={item.status} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold">{item.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.status === 'open'
                              ? 'keine Rückmeldung'
                              : [STATUS_TEXT[item.status], fmtReportTime(item.checkedAt), item.employeeName].filter(Boolean).join(' · ')}
                            {item.reason ? ` — ${item.reason}` : ''}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {item.beforeUrl && (
                            <a href={item.beforeUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1">
                              <ImageIcon className="w-3.5 h-3.5" /> vorher
                            </a>
                          )}
                          {item.afterUrl && (
                            <a href={item.afterUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1">
                              <ImageIcon className="w-3.5 h-3.5" /> nachher
                            </a>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
