/**
 * Reads a SharePoint list through Microsoft Graph.
 *
 * The operator roster lives in the `ASSY_Operator` list rather than the
 * workbook, so this is separate from `data/excel/sharepoint.client.ts` (which
 * fetches file bytes). Graph returns list rows under `value[].fields`, paged at
 * 200 by default — `@odata.nextLink` is followed until exhausted.
 */

import { ok, err, type Result } from '@/lib/result';
import type { SharePointConfig } from '@/data/excel/sharepoint.client';

/** One list row: the column values, keyed by internal column name. */
export type ListItemFields = Record<string, unknown>;

interface GraphListResponse {
  value?: { fields?: ListItemFields }[];
  '@odata.nextLink'?: string;
}

/** `https://graph.microsoft.com/v1.0/sites/{host}:{/sites/PMD}:` */
function graphSitePrefix(cfg: SharePointConfig): string {
  const u = new URL(cfg.siteUrl);
  return `https://graph.microsoft.com/v1.0/sites/${u.hostname}:${u.pathname.replace(/\/$/, '')}:`;
}

/**
 * Fetch every row of a list by display name or id. Returns an error result
 * rather than throwing, so a roster outage degrades to "no crew available"
 * instead of an empty board.
 */
export async function fetchListItems(
  cfg: SharePointConfig,
  listName: string,
): Promise<Result<ListItemFields[], string>> {
  if (!cfg.siteUrl) return err('SharePoint site URL not configured.');
  if (!cfg.token) return err('Missing Graph access token (VITE_GRAPH_TOKEN).');

  const rows: ListItemFields[] = [];
  let url =
    `${graphSitePrefix(cfg)}/lists/${encodeURIComponent(listName)}/items` +
    `?expand=fields&$top=200`;

  try {
    // Bounded so a malformed nextLink can never spin forever.
    for (let page = 0; page < 50 && url; page++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      if (!res.ok) {
        return err(
          `Graph list "${listName}" failed: ${res.status} ${res.statusText}`,
        );
      }
      const body = (await res.json()) as GraphListResponse;
      for (const item of body.value ?? []) {
        if (item.fields) rows.push(item.fields);
      }
      url = body['@odata.nextLink'] ?? '';
    }
    return ok(rows);
  } catch (e) {
    return err(
      `Graph list "${listName}" error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
