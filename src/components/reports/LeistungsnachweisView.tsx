'use client';

/** Anzeige eines Leistungsnachweises: Kennzahlen + Einsätze mit Leistungen und Fotos. */
import { CheckCircle2, CircleDashed, Image as ImageIcon, Loader2, Undo2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  fmtMonthLabel,
  isYearPeriod,
  fmtReportDate,
  itemStatusText,
  fmtReportTime,
  type ItemStatus,
  type LeistungsnachweisReport,
} from '@/lib/leistungsnachweis-types';

function StatusIcon({ status, byOffice }: { status: ItemStatus; byOffice?: boolean }) {
  if (status === 'done') return <CheckCircle2 className={`w-4 h-4 shrink-0 ${byOffice ? 'text-emerald-600/50' : 'text-emerald-600'}`} />;
  if (status === 'not_possible') return <XCircle className="w-4 h-4 text-red-600 shrink-0" />;
  return <CircleDashed className="w-4 h-4 text-gray-400 shrink-0" />;
}

interface Props {
  report: LeistungsnachweisReport | null;
  loading: boolean;
  monthLabel: string;
  emptyHint?: string;
  /** Nur intern (Verwaltung): offene Leistungen eines vergangenen Einsatzes nachtragen / zurücknehmen. */
  onNachtrag?: (assignmentId: string) => void;
  onUndo?: (assignmentId: string) => void;
  busyId?: string | null;
}

function berlinToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function LeistungsnachweisView({ report, loading, monthLabel, emptyHint, onNachtrag, onUndo, busyId }: Props) {
  const today = berlinToday();
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

      {!loading && report && isYearPeriod(report.month) && report.byMonth.length > 0 && (
        <Card className="rounded-3xl border-none shadow-lg overflow-hidden">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-3">Monat</th>
                  <th className="text-right px-3 py-3">Einsätze</th>
                  <th className="text-right px-3 py-3">Erledigt</th>
                  <th className="text-right px-3 py-3">Nicht möglich</th>
                  <th className="text-right px-3 py-3">Ohne Rückmeldung</th>
                  <th className="text-left px-5 py-3 w-[28%]">Quote</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.byMonth.map(m => (
                  <tr key={m.month}>
                    <td className="px-5 py-2.5 font-bold">
                      <a href={`#monat-${m.month}`} className="hover:underline">{fmtMonthLabel(m.month)}</a>
                    </td>
                    <td className="text-right px-3 tabular-nums">{m.visits}</td>
                    <td className="text-right px-3 tabular-nums">{m.done} / {m.planned}</td>
                    <td className="text-right px-3 tabular-nums">{m.notPossible}</td>
                    <td className="text-right px-3 tabular-nums">{m.open}</td>
                    <td className="px-5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-emerald-600" style={{ width: `${m.compliancePercent ?? 0}%` }} />
                        </div>
                        <span className="text-xs font-bold tabular-nums w-12 text-right">{(m.compliancePercent ?? 0).toLocaleString('de-DE')} %</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-3xl border-none shadow-lg overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !report || report.visits.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16 px-6">
              Keine Einsätze mit Leistungen für dieses Objekt im Zeitraum {monthLabel}.
              {emptyHint ? ` ${emptyHint}` : ''}
            </p>
          ) : (
            <div className="divide-y">
              {report.visits.map((v, index) => (
                <div key={v.id}>
                {isYearPeriod(report.month) && v.date.slice(0, 7) !== report.visits[index - 1]?.date.slice(0, 7) && (
                  <p id={`monat-${v.date.slice(0, 7)}`} className="px-5 py-2 bg-muted/50 text-xs font-black uppercase tracking-widest text-muted-foreground scroll-mt-20">
                    {fmtMonthLabel(v.date.slice(0, 7))}
                  </p>
                )}
                <div className="p-5 grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
                  <div>
                    <p className="font-black">{fmtReportDate(v.date)}</p>
                    {showTeam && <p className="text-xs text-muted-foreground mt-1">{v.workers.join(', ') || 'ohne Team'}</p>}
                    {onNachtrag && v.date <= today && v.items.some(i => i.status === 'open') && (
                      <Button
                        variant="outline" size="sm" className="mt-3 h-8 rounded-lg text-xs font-bold gap-1.5"
                        disabled={busyId === v.id}
                        onClick={() => onNachtrag(v.id)}
                      >
                        {busyId === v.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Als erledigt nachtragen
                      </Button>
                    )}
                    {onUndo && v.items.some(i => i.byOffice) && (
                      <Button
                        variant="ghost" size="sm" className="mt-2 h-7 rounded-lg text-xs text-muted-foreground gap-1.5"
                        disabled={busyId === v.id}
                        onClick={() => onUndo(v.id)}
                      >
                        <Undo2 className="w-3.5 h-3.5" /> Nachtrag zurücknehmen
                      </Button>
                    )}
                  </div>
                  <ul className="space-y-2">
                    {v.items.map(item => (
                      <li key={item.code} className="flex items-start gap-3">
                        <StatusIcon status={item.status} byOffice={item.byOffice} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold">{item.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.status === 'open'
                              ? 'keine Rückmeldung'
                              : [itemStatusText(item), item.byOffice ? null : fmtReportTime(item.checkedAt), item.employeeName].filter(Boolean).join(' · ')}
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
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
