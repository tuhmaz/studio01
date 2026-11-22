'use client';

/**
 * PDF-Vorschau vor dem Herunterladen. Das PDF wird im Browser erzeugt und als
 * Blob angezeigt (nichts verlässt das Gerät). Browser ohne eingebauten
 * PDF-Viewer (z. B. Chrome auf Android) bekommen „In neuem Tab öffnen“.
 */
import { useEffect, useState } from 'react';
import { Download, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { downloadPdf, type LeistungsnachweisPdf } from '@/lib/leistungsnachweis-pdf';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdf: LeistungsnachweisPdf | null;
  title: string;
  error?: string | null;
}

export function PdfPreviewDialog({ open, onOpenChange, pdf, title, error }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [inline, setInline] = useState(true);

  useEffect(() => {
    setInline((window.navigator as { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false);
  }, []);

  useEffect(() => {
    if (!pdf) { setUrl(null); return; }
    const next = URL.createObjectURL(pdf.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [pdf]);

  const sizeKb = pdf ? Math.max(1, Math.round(pdf.blob.size / 1024)) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b flex-row items-center justify-between space-y-0 gap-3 pr-12">
          <div className="min-w-0">
            <DialogTitle className="text-base font-black truncate">{title}</DialogTitle>
            <DialogDescription className="text-xs truncate">
              {pdf ? `${pdf.filename} · ${sizeKb.toLocaleString('de-DE')} KB` : 'PDF wird erstellt …'}
            </DialogDescription>
          </div>
          <div className="flex gap-2 shrink-0">
            {url && (
              <Button variant="outline" size="sm" className="h-9 rounded-xl gap-1.5" asChild>
                <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" /> Neuer Tab</a>
              </Button>
            )}
            <Button size="sm" className="h-9 rounded-xl font-black gap-1.5" disabled={!pdf} onClick={() => pdf && downloadPdf(pdf)}>
              <Download className="w-4 h-4" /> Herunterladen
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 bg-muted/40 min-h-0">
          {error ? (
            <p className="p-10 text-center text-sm text-destructive">{error}</p>
          ) : !url ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-sm">PDF wird erstellt – bei vielen Fotos kann das etwas dauern …</p>
            </div>
          ) : inline ? (
            <iframe src={`${url}#view=FitH`} title={title} className="w-full h-full border-0" />
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
              <FileText className="w-12 h-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground max-w-sm">
                Dieser Browser zeigt PDFs nicht direkt an. Öffnen Sie die Datei in einem neuen Tab oder laden Sie sie herunter.
              </p>
              <Button variant="outline" className="rounded-xl gap-2" asChild>
                <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" /> In neuem Tab öffnen</a>
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
