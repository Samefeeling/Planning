/**
 * Fetches the two Epicor exports as text: `Planning1.csv` (the orders) and
 * `JobMaterialReq.csv` (what each order consumes, which is where the
 * dependency chain comes from).
 *
 * Three paths each, in order: a file the planner picked from disk (works
 * today, with no auth), a plain URL (an export dropped on a share or served by
 * the task schedule), and finally Microsoft Graph if the file lives in the
 * SharePoint document library.
 *
 * The orders are required; the material links are not. A site that has not
 * exported them simply gets a board where every order stands on its own.
 */

import { ok, err, type Result } from '@/lib/result';
import {
  graphFile,
  type SharePointConfig,
} from '@/data/excel/sharepoint.client';

let manualCsv: string | null = null;
let manualJobMaterialCsv: string | null = null;

/** Stash a `Planning1.csv` the user picked from disk. */
export function setManualCsv(text: string): void {
  manualCsv = text;
}

export function getManualCsv(): string | null {
  return manualCsv;
}

/** Stash a `JobMaterialReq.csv` the user picked from disk. */
export function setManualJobMaterialCsv(text: string): void {
  manualJobMaterialCsv = text;
}

export function getManualJobMaterialCsv(): string | null {
  return manualJobMaterialCsv;
}

export interface CsvSourceConfig {
  /** Direct URL to the order export, if it is served over plain HTTP. */
  url: string;
  /** Path in the SharePoint drive, used when no URL is set. */
  filePath: string;
  /** Direct URL to the material-link export. */
  linksUrl?: string;
  /** Drive path for the material-link export; empty disables the fetch. */
  linksFilePath?: string;
}

export function readCsvConfigFromEnv(): CsvSourceConfig {
  const env = import.meta.env;
  return {
    url: env.VITE_PLANNING_CSV_URL ?? '',
    filePath: env.VITE_PLANNING_CSV_PATH ?? '/Shared Documents/Planning1.csv',
    linksUrl: env.VITE_JOB_MATERIAL_CSV_URL ?? '',
    linksFilePath:
      env.VITE_JOB_MATERIAL_CSV_PATH ?? '/Shared Documents/JobMaterialReq.csv',
  };
}

/** GET a file as text, naming it in any error so the banner is actionable. */
async function fetchText(
  label: string,
  url: string,
  token: string | null,
): Promise<Result<string, string>> {
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      return err(`${label} fetch failed: ${res.status} ${res.statusText}`);
    }
    return ok(await res.text());
  } catch (e) {
    return err(
      `${label} fetch error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
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

  const url = viaGraph ? graphFile(sp, cfg.filePath) : cfg.url;
  return fetchText('Planning1.csv', url, viaGraph ? sp.token : null);
}

/**
 * The material-link export, or `ok(null)` when the site has not configured
 * one. Missing links are not an error — they only mean no order is held
 * behind another.
 */
export async function fetchJobMaterialCsv(
  cfg: CsvSourceConfig,
  sp: SharePointConfig,
): Promise<Result<string | null, string>> {
  const manual = getManualJobMaterialCsv();
  if (manual !== null) return ok(manual);

  if (cfg.linksUrl) return fetchText('JobMaterialReq.csv', cfg.linksUrl, null);
  if (!cfg.linksFilePath || !sp.siteUrl || !sp.token) return ok(null);

  return fetchText(
    'JobMaterialReq.csv',
    graphFile(sp, cfg.linksFilePath),
    sp.token,
  );
}
