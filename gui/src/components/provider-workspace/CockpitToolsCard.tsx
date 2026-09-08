import { useRef, useState } from "react";
import { useT } from "../../i18n/shared";
import { IconClipboard } from "../../icons";

const COCKPIT_IMPORT_MAX_BYTES = 256 * 1024;

const COCKPIT_RESULT_KEYS = new Set([
  "totalCount",
  "importedCount",
  "updatedCount",
  "failedCount",
  "unsupportedCount",
  "results",
]);

const COCKPIT_RESULT_STATUSES = new Set(["imported", "updated", "failed", "unsupported"]);
const COCKPIT_STATUS_CODES: Record<string, ReadonlySet<string>> = {
  imported: new Set(["imported"]),
  updated: new Set(["updated"]),
  failed: new Set(["invalid_record", "credential_rejected", "identity_mismatch", "missing_project", "persist_failed"]),
  unsupported: new Set(["unsupported_provider", "unsupported_format"]),
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export type CockpitImportResult = {
  totalCount: number;
  importedCount: number;
  updatedCount: number;
  failedCount: number;
  unsupportedCount: number;
  results: Array<{ index: number; status: string; code: string }>;
};

function safeCockpitImportResult(value: unknown): CockpitImportResult | null {
  if (!isPlainObject(value) || Object.keys(value).some(key => !COCKPIT_RESULT_KEYS.has(key))) return null;
  const { totalCount, importedCount, updatedCount, failedCount, unsupportedCount, results } = value;
  if (
    !isSafeCount(totalCount)
    || !isSafeCount(importedCount)
    || !isSafeCount(updatedCount)
    || !isSafeCount(failedCount)
    || !isSafeCount(unsupportedCount)
    || !Array.isArray(results)
    || results.length !== totalCount
    || importedCount + updatedCount + failedCount + unsupportedCount !== totalCount
  ) return null;
  const observed = { imported: 0, updated: 0, failed: 0, unsupported: 0 };
  for (const [index, result] of results.entries()) {
    if (!isPlainObject(result) || Object.keys(result).some(key => !["index", "status", "code"].includes(key))) return null;
    const status = String(result.status);
    const code = String(result.code);
    if (result.index !== index || !COCKPIT_RESULT_STATUSES.has(status)) return null;
    const allowedCodes = COCKPIT_STATUS_CODES[status];
    if (!allowedCodes || !allowedCodes.has(code)) return null;
    observed[status as keyof typeof observed] += 1;
  }
  if (
    observed.imported !== importedCount
    || observed.updated !== updatedCount
    || observed.failed !== failedCount
    || observed.unsupported !== unsupportedCount
  ) return null;
  return {
    totalCount, importedCount, updatedCount, failedCount, unsupportedCount,
    results: results as Array<{ index: number; status: string; code: string }>,
  };
}

export interface CockpitToolsCardProps {
  apiBase: string;
  onImportSuccess?: () => void | Promise<void>;
  className?: string;
}

export default function CockpitToolsCard({
  apiBase,
  onImportSuccess,
  className = "",
}: CockpitToolsCardProps) {
  const t = useT();
  const [importBusy, setImportBusy] = useState(false);
  const [importStatus, setImportStatus] = useState<"idle" | "invalid" | "failed" | "complete">("idle");
  const [importResult, setImportResult] = useState<CockpitImportResult | null>(null);
  const [showManualPaste, setShowManualPaste] = useState(false);
  const [manualPasteText, setManualPasteText] = useState("");
  const importFileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const importCockpitJson = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || importBusy || busyRef.current) return;
    busyRef.current = true;
    setImportBusy(true);
    setImportStatus("idle");
    setImportResult(null);
    try {
      if (new TextEncoder().encode(text).byteLength > COCKPIT_IMPORT_MAX_BYTES) {
        setImportStatus("invalid");
        return;
      }
      let document: unknown;
      try {
        document = JSON.parse(text) as unknown;
      } catch {
        try {
          const sanitized = text.replace(/,\s*([}\]])/g, "$1");
          document = JSON.parse(sanitized) as unknown;
        } catch {
          setImportStatus("invalid");
          return;
        }
      }
      if (isPlainObject(document)) {
        document = [document];
      }
      const response = await fetch(`${apiBase}/api/oauth/accounts/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google-antigravity", format: "cockpit-tools", document }),
      });
      if (!response.ok) {
        setImportStatus("failed");
        return;
      }
      const result = safeCockpitImportResult(await response.json().catch(() => null));
      if (!result) {
        setImportStatus("failed");
        return;
      }
      setImportResult(result);
      setImportStatus("complete");
      setShowManualPaste(false);
      setManualPasteText("");
      try {
        await onImportSuccess?.();
      } catch {
        /* Preserve the completed import state */
      }
    } catch {
      setImportStatus("failed");
    } finally {
      if (importFileRef.current) importFileRef.current.value = "";
      setImportBusy(false);
      busyRef.current = false;
    }
  };

  const importCockpitFile = async (file: File | undefined) => {
    if (!file || importBusy || busyRef.current) return;
    if (!file.name.toLowerCase().endsWith(".json") || file.size > COCKPIT_IMPORT_MAX_BYTES) {
      setImportStatus("invalid");
      setImportResult(null);
      if (importFileRef.current) importFileRef.current.value = "";
      return;
    }
    try {
      const text = await file.text();
      await importCockpitJson(text);
    } catch {
      setImportStatus("failed");
      setImportResult(null);
    } finally {
      if (importFileRef.current) importFileRef.current.value = "";
    }
  };

  const importCockpitClipboard = async () => {
    if (importBusy || busyRef.current) return;
    setImportStatus("idle");
    setImportResult(null);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.readText === "function") {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          await importCockpitJson(text);
          return;
        }
      }
    } catch {
      setShowManualPaste(true);
      return;
    }
    setShowManualPaste(true);
  };

  return (
    <div className={`pwi-cockpit-card ${className}`.trim()}>
      <div className="pwi-cockpit-card-top">
        <div className="pwi-cockpit-card-brand">
          <img
            src="/provider-icons/cockpit-tools.png"
            alt=""
            aria-hidden="true"
            className="pwi-cockpit-card-icon"
          />
          <div className="pwi-cockpit-card-titles">
            <span className="pwi-cockpit-card-title">{t("pws.cockpitCardTitle")}</span>
            <span className="pwi-cockpit-card-subtitle">{t("pws.cockpitCardSubtitle")}</span>
          </div>
        </div>
        <div className="pwi-cockpit-card-actions">
          <label className="sr-only" htmlFor="cockpit-import-file">{t("pws.cockpitImportFileLabel")}</label>
          <input
            ref={importFileRef}
            id="cockpit-import-file"
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-describedby="cockpit-import-description cockpit-import-status"
            disabled={importBusy}
            onChange={event => { void importCockpitFile(event.currentTarget.files?.[0]); }}
          />
          <button
            type="button"
            id="cockpit-import-clipboard-btn"
            className="btn btn-primary btn-sm"
            disabled={importBusy}
            onClick={() => { void importCockpitClipboard(); }}
          >
            <IconClipboard width={14} height={14} aria-hidden="true" />
            {" "}
            {t("pws.cockpitImportPasteClipboard")}
          </button>
          <button
            type="button"
            id="cockpit-import-choose-file-btn"
            className="btn btn-ghost btn-sm"
            disabled={importBusy}
            onClick={() => importFileRef.current?.click()}
          >
            {importBusy ? t("pws.cockpitImporting") : t("pws.cockpitImportFileShort")}
          </button>
          <button
            type="button"
            id="cockpit-import-manual-btn"
            className="btn btn-ghost btn-sm"
            disabled={importBusy}
            onClick={() => setShowManualPaste(prev => !prev)}
          >
            {t("pws.cockpitImportPasteManual")}
          </button>
        </div>
      </div>
      {showManualPaste && (
        <div className="pwi-cockpit-card-manual">
          <textarea
            id="cockpit-import-manual-text"
            className="pwi-cockpit-card-textarea"
            rows={3}
            value={manualPasteText}
            onChange={e => setManualPasteText(e.target.value)}
            placeholder={t("pws.cockpitImportPastePlaceholder")}
            disabled={importBusy}
            autoFocus
          />
          <div className="pwi-cockpit-card-manual-actions">
            <button
              type="button"
              id="cockpit-import-submit-btn"
              className="btn btn-primary btn-sm"
              disabled={importBusy || !manualPasteText.trim()}
              onClick={() => void importCockpitJson(manualPasteText)}
            >
              {importBusy ? t("pws.cockpitImporting") : t("pws.cockpitImportSubmit")}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={importBusy}
              onClick={() => { setShowManualPaste(false); setManualPasteText(""); }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
      <div className="pwi-cockpit-card-divider" />
      <div id="cockpit-import-status" className="pwi-cockpit-card-footer" role="status" aria-live="polite">
        {importStatus === "invalid" && <span className="pws-status-warn">{t("pws.cockpitImportInvalid")}</span>}
        {importStatus === "failed" && <span className="pws-status-warn">{t("pws.cockpitImportFailed")}</span>}
        {importStatus === "complete" && importResult && (
          <span className="pws-status-ok">
            {t("pws.cockpitImportComplete", {
              imported: importResult.importedCount,
              updated: importResult.updatedCount,
              failed: importResult.failedCount,
              unsupported: importResult.unsupportedCount,
            })}
          </span>
        )}
        {importStatus === "idle" && (
          <>
            <span className="pwi-cockpit-card-dot" aria-hidden="true" />
            <span>{t("pws.cockpitCardFootnote")}</span>
          </>
        )}
      </div>
      <div id="cockpit-import-description" className="sr-only">
        {t("pws.cockpitImportDescription")}
      </div>
    </div>
  );
}
