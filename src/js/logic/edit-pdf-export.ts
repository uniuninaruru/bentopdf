// Turns the PDF editor's active document into final PDF bytes: applies pending
// redactions, flattens FreeText so non-Latin text survives in every reader,
// embeds fonts, and scrubs redacted text from document data. Shared by the
// web PDF Editor page and the desktop app window.

import type { PluginRegistry } from 'bentopdf-viewer';
import type {
  AnnotationPluginLite,
  AppliedRedactionTracker,
  FreeTextSystemFontAnnotation,
  RedactionPluginLite,
} from '@/types';
import { trText } from '../i18n/i18n.js';
import { needsFontEmbedding } from '../utils/freetext-script.js';

const FREETEXT_SUBTYPE = 3;

export function trackAppliedRedactions(
  redaction: RedactionPluginLite
): AppliedRedactionTracker {
  const pendingByDoc = new Map<string, Map<string, string | undefined>>();
  const appliedByDoc = new Map<string, Map<string, string | undefined>>();
  const lastLeftPendingByDoc = new Map<string, string[]>();
  const getAppliedRedactions = (documentId: string) => {
    let applied = appliedByDoc.get(documentId);
    if (!applied) {
      applied = new Map();
      appliedByDoc.set(documentId, applied);
    }
    return applied;
  };

  redaction.onPendingChange(({ documentId, pending }) => {
    const previous = pendingByDoc.get(documentId) ?? new Map();
    const next = new Map<string, string | undefined>();
    for (const items of Object.values(pending)) {
      for (const item of items) {
        next.set(item.id, item.text ?? previous.get(item.id));
      }
    }
    const applied = getAppliedRedactions(documentId);
    const leftPending: string[] = [];
    for (const [id, text] of previous) {
      if (!next.has(id)) {
        applied.set(id, text);
        leftPending.push(id);
      }
    }
    for (const id of next.keys()) applied.delete(id);
    pendingByDoc.set(documentId, next);
    lastLeftPendingByDoc.set(documentId, leftPending);
  });

  redaction.onRedactionEvent((event) => {
    const applied = appliedByDoc.get(event.documentId);
    if (event.type === 'remove' && event.id) {
      applied?.delete(event.id);
    } else if (event.type === 'clear') {
      for (const id of lastLeftPendingByDoc.get(event.documentId) ?? []) {
        applied?.delete(id);
      }
    }
  });

  return {
    appliedTexts: (documentId) => [
      ...(appliedByDoc.get(documentId)?.values() ?? []),
    ],
    forget: (documentId) => {
      pendingByDoc.delete(documentId);
      appliedByDoc.delete(documentId);
      lastLeftPendingByDoc.delete(documentId);
    },
  };
}

export function redactionScrubTerms(
  texts: Iterable<string | undefined>
): string[] {
  const terms = new Map<string, string>();
  for (const text of texts) {
    for (const line of text?.split(/[\r\n]+/) ?? []) {
      const term = line.trim();
      const key = term.toLowerCase();
      if (term && !terms.has(key)) terms.set(key, term);
    }
  }
  return [...terms.values()].sort((a, b) => b.length - a.length);
}

export async function scrubRedactedText(
  bytes: Uint8Array,
  terms: string[]
): Promise<Uint8Array> {
  const { redactDocumentData } =
    await import('../utils/redact-document-data.js');
  return redactDocumentData(bytes, terms);
}

export function collectAllFreeTexts(
  annotationPlugin: AnnotationPluginLite | null
): FreeTextSystemFontAnnotation[] {
  if (!annotationPlugin) return [];
  try {
    const state = annotationPlugin.getState();
    const out: FreeTextSystemFontAnnotation[] = [];
    for (const tracked of Object.values(state.byUid)) {
      const obj = tracked.object;
      if (obj.type !== FREETEXT_SUBTYPE) continue;
      if (obj.intent === 'FreeTextCallout') continue;
      if (!obj.id || obj.pageIndex == null || !obj.rect) continue;
      out.push({
        id: obj.id,
        pageIndex: obj.pageIndex,
        contents: obj.contents ?? '',
        fontSize: obj.fontSize ?? 12,
        fontColor: obj.fontColor ?? '#000000',
        textAlign: obj.textAlign ?? 0,
        verticalAlign: obj.verticalAlign ?? 0,
        opacity: obj.opacity ?? 1,
        backgroundColor: obj.color ?? obj.backgroundColor,
        rect: obj.rect,
        fontPostScriptName: obj.fontPostScriptName ?? '',
        rotation: obj.rotation ?? 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export interface ExportEditedPdfOptions {
  registry: PluginRegistry;
  /** Document being exported. It must be the active document. */
  documentId: string | null;
  redactionPlugin: RedactionPluginLite | null;
  redactionTracker: AppliedRedactionTracker | null;
  /** Asks the user to confirm; resolves false to cancel the export. */
  confirm: (
    title: string,
    message: string,
    confirmLabel: string
  ) => Promise<boolean>;
  showAlert: (title: string, message: string) => void;
  showLoader?: (message: string) => void;
  hideLoader?: () => void;
  /** Label of the confirm button for applying pending redactions. */
  applyLabel?: string;
}

/**
 * Exports the active document. Resolves null when the user cancelled or the
 * export cannot be completed safely (the reason is reported via showAlert).
 */
export async function exportEditedPdf(
  opts: ExportEditedPdfOptions
): Promise<Uint8Array | null> {
  const { registry, documentId, redactionPlugin, redactionTracker } = opts;
  const pendingCount = redactionPlugin?.getState().pendingCount ?? 0;
  if (redactionPlugin && pendingCount > 0) {
    const shouldApply = await opts.confirm(
      trText('Apply redactions?'),
      pendingCount === 1
        ? trText(
            "This document has 1 redaction mark that hasn't been applied. Until a mark is applied, the content under it is still in the file. Apply all marks and download?"
          )
        : trText(
            "This document has {{count}} redaction marks that haven't been applied. Until a mark is applied, the content under it is still in the file. Apply all marks and download?",
            { count: pendingCount }
          ),
      opts.applyLabel ?? trText('Apply and download')
    );
    if (!shouldApply) return null;
    try {
      await redactionPlugin.commitAllPending().toPromise();
    } catch (err) {
      console.error('Applying redactions failed:', err);
    }
    if (redactionPlugin.getState().pendingCount > 0) {
      opts.showAlert(
        'Redaction Failed',
        'Some redaction marks could not be applied, so the file was not downloaded. Apply or remove them in the editor and try again.'
      );
      return null;
    }
  }

  const exportPlugin = registry.getPlugin('export').provides();
  const arrayBuffer = await exportPlugin.saveAsCopy().toPromise();
  let outBytes = new Uint8Array(arrayBuffer);

  let annotationPlugin: AnnotationPluginLite | null;
  try {
    annotationPlugin = registry
      .getPlugin('annotation')
      .provides() as unknown as AnnotationPluginLite;
  } catch {
    annotationPlugin = null;
  }
  const allFreeTexts = collectAllFreeTexts(annotationPlugin);
  let pending = allFreeTexts;
  if (pending.length > 0) {
    try {
      const { flattenFreeTextToPageText } =
        await import('../utils/freetext-flatten.js');
      const res = await flattenFreeTextToPageText(outBytes, pending);
      if (res.flattened > 0) {
        outBytes = res.bytes;
        pending = [];
      }
    } catch (err) {
      console.error('Flatten pass failed:', err);
    }
  }
  const customFontAnnots = pending.filter(
    (a) => a.fontPostScriptName.trim() !== '' || needsFontEmbedding(a.contents)
  );
  if (customFontAnnots.length > 0) {
    try {
      const { embedFreeTextSystemFonts } =
        await import('../utils/freetext-font-embed.js');
      outBytes = await embedFreeTextSystemFonts(outBytes, customFontAnnots);
    } catch (err) {
      console.error('Font embed pass failed:', err);
    }
  }

  const appliedTexts =
    documentId && redactionTracker
      ? redactionTracker.appliedTexts(documentId)
      : [];
  if (appliedTexts.length > 0) {
    const { PDFDocument } = await import('pdf-lib');
    const exported = await PDFDocument.load(outBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    if (exported.isEncrypted) {
      const proceed = await opts.confirm(
        trText('Encrypted file'),
        trText(
          "Your redactions are applied to the pages, but this file is encrypted, so BentoPDF can't also remove copies of the redacted text from its properties, bookmarks, and attachments. For a full cleanup, redact an unencrypted copy and add a password afterwards with Protect PDF. Download anyway?"
        ),
        trText('Download anyway')
      );
      if (!proceed) return null;
    } else {
      opts.showLoader?.('Removing redacted text from document data...');
      try {
        outBytes = await scrubRedactedText(
          outBytes,
          redactionScrubTerms(appliedTexts)
        );
      } catch (err) {
        console.error('Redaction cleanup failed:', err);
        opts.showAlert(
          'Error',
          'Could not remove the redacted text from the document data, so the file was not downloaded.'
        );
        return null;
      } finally {
        opts.hideLoader?.();
      }
    }
  }
  return outBytes;
}
