/**
 * Fetches `Planning1.csv` as text.
 *
 * Three paths, in order: a CSV the planner picked from disk (works today, with
 * no auth), a plain URL (`VITE_PLANNING_CSV_URL` — an export dropped on a share
 * or served by the task schedule), and finally Microsoft Graph if the file
 * lives in the SharePoint document library.
 */

import { ok, err, type Result } from '@/lib/result';
import type { SharePointConfig } from '@/data/excel/sharepoint.client';

let manualCsv: string | null = null;

/** Stash a CSV the user picked from disk. */
export function setManualCsv(text: string): void {
  manualCsv = text;
}

export function getManualCsv(): string | null {
  return manualCsv;
}

export interface CsvSourceConfig {
  /** Direct URL to the export, if it is served over plain HTTP. */
  url: string;
  /** Path in the SharePoint drive, used when no URL is set. */
  filePath: string;
}

export function readCsvConfigFromEnv(): CsvSourceConfig {
  const env = import.meta.env;
  return {
    url: env.VITE_PLANNING_CSV_URL ?? '',
    filePath: env.VITE_PLANNING_CSV_PATH ?? '/Shared Documents/Planning1.csv',
  };
}

function graphFileUrl(sp: SharePointConfig, filePath: string): string {
  const u = new URL(sp.siteUrl);
  const path = filePath.startsWith('/') ? filePath : `/${filePath}`;
  return (
    `https://graph.microsoft.com/v1.0/sites/${u.hostname}:${u.pathname.replace(/\/$/, '')}:` +
    `/drive/root:${encodeURI(path)}:/content`
  );
}

export async function fetchPlanningCsv(
  cfg: CsvSourceConfig,
  sp: SharePointConfig,
): Promise<Result<string, string>> {
  const manual = getManualCsv();
  if (manual !== null) return ok(manual);

  const viaGraph = !cfg.url;
  if (viaGraph && !sp.siteUrl) {
    return err(
      'No Planning1.csv available: set VITE_PLANNING_CSV_URL, configure ' +
        'SharePoint, or load the file by hand.',
    );
  }
  if (viaGraph && !sp.token) {
    return err('Missing Graph access token (VITE_GRAPH_TOKEN).');
  }

  const url = viaGraph ? graphFileUrl(sp, cfg.filePath) : cfg.url;
  try {
    const res = await fetch(url, {
      headers: viaGraph ? { Authorization: `Bearer ${sp.token}` } : {},
    });
    if (!res.ok) {
      return err(`Planning1.csv fetch failed: ${res.status} ${res.statusText}`);
    }
    return ok(await res.text());
  } catch (e) {
    return err(
      `Planning1.csv fetch error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
