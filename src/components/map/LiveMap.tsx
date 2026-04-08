'use client';

// Leaflet CSS must be imported here — the whole component is loaded with ssr:false
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Loader2, MapPin, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// Fix Leaflet's broken default icon paths when bundled by webpack/Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MapSite {
  id: string;
  name: string;
  address: string;
  city: string;
  lat: number | null;
  lng: number | null;
  routeCode?: string | null;
  /** Status of today's assignment (if any) */
  status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null;
  /** Number of completed assignments this month */
  monthlyCompletions?: number;
  /** Dates of completions this month (iso strings) */
  monthlyDates?: string[];
  workers?: string[];
  categories?: string[];
}

interface LiveMapProps {
  sites: MapSite[];
  onGeocode?: () => void;
  isGeocoding?: boolean;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  COMPLETED:        '#16a34a',  // green-600  – today completed
  IN_PROGRESS:      '#3b82f6',  // blue-500   – today in progress
  PENDING:          '#f59e0b',  // amber-500  – today pending
  monthly:          '#cd3915',  // custom red – completed earlier this month (not today)
  none:             '#727373',  // custom gray – no assignment
};

const STATUS_LABEL: Record<string, string> = {
  COMPLETED:        'Heute abgeschlossen',
  IN_PROGRESS:      'In Bearbeitung',
  PENDING:          'Ausstehend',
  monthly:          'Diesen Monat erledigt',
  none:             'Kein Einsatz',
};

/** Resolve the effective display key for a site */
function resolveKey(site: MapSite): string {
  if (site.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (site.status === 'PENDING')     return 'PENDING';
  if (site.status === 'COMPLETED')   return 'COMPLETED';
  if ((site.monthlyCompletions ?? 0) > 0) return 'monthly';
  return 'none';
}

// ── Custom SVG marker icon ─────────────────────────────────────────────────────

function makeIcon(color: string, label: string) {
  const svg = `
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="
        background:${color};color:#fff;font-family:system-ui,sans-serif;
        font-size:9px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;
        padding:2px 7px;border-radius:999px;white-space:nowrap;
        box-shadow:0 2px 8px rgba(0,0,0,.28);margin-bottom:2px;
        max-width:110px;overflow:hidden;text-overflow:ellipsis;
      ">${label}</div>
      <svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
        <path d="M13 0C5.82 0 0 5.82 0 13c0 9.1 13 21 13 21S26 22.1 26 13C26 5.82 20.18 0 13 0z" fill="${color}"/>
        <circle cx="13" cy="13" r="5.5" fill="white" opacity=".88"/>
      </svg>
    </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [26, 56], iconAnchor: [13, 54], popupAnchor: [0, -56] });
}

// ── Auto-fit bounds helper (must be inside MapContainer) ───────────────────────

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (!positions.length) return;
    try {
      map.fitBounds(positions, { padding: [48, 48], maxZoom: 14 });
    } catch { /* ignore */ }
  }, [map, positions]);
  return null;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function LiveMap({ sites, onGeocode, isGeocoding = false }: LiveMapProps) {
  const locatedSites = sites.filter(s => s.lat != null && s.lng != null);
  const missingCoords = sites.filter(s => s.lat == null || s.lng == null);

  const positions = locatedSites.map(s => [s.lat!, s.lng!] as [number, number]);

  // Default centre: Magdeburg
  const defaultCenter: [number, number] = [52.12, 11.63];

  return (
    <div className="rounded-3xl overflow-hidden shadow-2xl border-none bg-white flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 bg-primary/5 border-b border-primary/10">
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-primary" />
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-primary">Live-Map</p>
            <p className="text-xs text-muted-foreground font-medium">
              {locatedSites.length} von {sites.length} Standorten geortet
            </p>
          </div>
        </div>
        {missingCoords.length > 0 && onGeocode && (
          <Button
            size="sm"
            variant="outline"
            className="font-black text-xs h-9 border-primary/20 hover:bg-primary/5"
            onClick={onGeocode}
            disabled={isGeocoding}
          >
            {isGeocoding
              ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Geortet...</>
              : <><RefreshCw className="w-3 h-3 mr-2" />{missingCoords.length} georeferenzieren</>}
          </Button>
        )}
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-5 px-6 py-3 bg-white border-b border-gray-100">
        {(Object.entries(STATUS_LABEL) as [string, string][]).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full border border-black/10" style={{ background: STATUS_COLOR[key] }} />
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{label}</span>
          </div>
        ))}
      </div>

      {/* ── Map ── */}
      <div className="relative" style={{ height: 520 }}>
        {locatedSites.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gray-50">
            <div className="w-16 h-16 bg-muted/30 rounded-full flex items-center justify-center">
              <MapPin className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <div className="text-center">
              <p className="text-sm font-black text-foreground/80 uppercase">Keine Koordinaten vorhanden</p>
              {onGeocode && (
                <p className="text-xs text-muted-foreground mt-1">Klicken Sie auf &bdquo;Georeferenzieren&ldquo; oben rechts.</p>
              )}
            </div>
          </div>
        ) : (
          <MapContainer
            center={defaultCenter}
            zoom={10}
            style={{ height: '100%', width: '100%' }}
            zoomControl
            scrollWheelZoom
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              maxZoom={19}
            />
            <FitBounds positions={positions} />
            {locatedSites.map(site => {
              const key   = resolveKey(site);
              const color = STATUS_COLOR[key];
              const label = STATUS_LABEL[key];
              return (
                <Marker
                  key={site.id}
                  position={[site.lat!, site.lng!]}
                  icon={makeIcon(color, site.routeCode || site.name.slice(0, 14))}
                >
                  <Popup maxWidth={300} className="leaflet-popup-custom">
                    <div style={{ fontFamily: 'system-ui,sans-serif', minWidth: 220 }}>
                      {/* Status badge */}
                      <div style={{
                        background: color, color: '#fff',
                        padding: '7px 12px', borderRadius: '8px 8px 0 0',
                        margin: '-8px -12px 12px',
                        fontSize: 10, fontWeight: 900,
                        textTransform: 'uppercase', letterSpacing: '.1em',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <span>{label}</span>
                        {(site.monthlyCompletions ?? 0) > 0 && (
                          <span style={{
                            background: 'rgba(0,0,0,.15)', borderRadius: 999,
                            padding: '1px 7px', fontSize: 10, fontWeight: 900,
                          }}>
                            {site.monthlyCompletions}× diesen Monat
                          </span>
                        )}
                      </div>

                      {/* Site info */}
                      <p style={{ fontWeight: 900, fontSize: 14, margin: '0 0 3px' }}>{site.name}</p>
                      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px' }}>{site.address}, {site.city}</p>

                      {/* Monthly completion dates */}
                      {site.monthlyDates && site.monthlyDates.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          <p style={{ fontSize: 9, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 4px' }}>
                            Erledigte Einsätze diesen Monat
                          </p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {site.monthlyDates.map(d => (
                              <span key={d} style={{
                                background: '#dcfce7', color: '#166534',
                                fontSize: 9, fontWeight: 800,
                                padding: '2px 7px', borderRadius: 999,
                              }}>
                                {new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Today's categories */}
                      {site.categories && site.categories.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                          {site.categories.map(c => (
                            <span key={c} style={{
                              background: '#f1f5f9', color: '#475569',
                              fontSize: 9, fontWeight: 800, padding: '2px 8px',
                              borderRadius: 999, textTransform: 'uppercase',
                            }}>{c}</span>
                          ))}
                        </div>
                      )}

                      {/* Workers */}
                      {site.workers && site.workers.length > 0 && (
                        <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, margin: 0 }}>
                          👤 {site.workers.join(', ')}
                        </p>
                      )}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        )}

        {/* Geocoding overlay */}
        {isGeocoding && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center z-[2000]">
            <div className="bg-white rounded-3xl shadow-2xl p-8 flex flex-col items-center gap-4 max-w-xs text-center">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <div>
                <p className="text-sm font-black uppercase">Adressen werden geokodiert</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {missingCoords.length} Standort{missingCoords.length !== 1 ? 'e' : ''} werden über OpenStreetMap verortet…
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Missing sites ── */}
      {missingCoords.length > 0 && (
        <div className="px-6 py-4 border-t border-gray-100 bg-amber-50/50">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-2 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {missingCoords.length} Standort{missingCoords.length !== 1 ? 'e' : ''} ohne Koordinaten
          </p>
          <div className="flex flex-wrap gap-2">
            {missingCoords.slice(0, 8).map(s => (
              <Badge key={s.id} variant="outline" className="text-[9px] font-black border-amber-200 text-amber-700 bg-amber-50">
                {s.name}
              </Badge>
            ))}
            {missingCoords.length > 8 && (
              <Badge variant="outline" className="text-[9px] font-black border-amber-200 text-amber-700 bg-amber-50">
                +{missingCoords.length - 8} weitere
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
