# ASSY_Production schema and migration

Do this before enabling `VITE_PRODUCTION_LIST` in production. The application
uses one deterministic record per order per local production day.

| Internal name | SharePoint type | Rule |
| --- | --- | --- |
| `RecordKey` | Single line text | Required, indexed and unique; `Job|YYYY-MM-DD` |
| `Title` | Single line text | Job number |
| `Date` | Date only | Production day |
| `Line` | Single line text | Current planned line |
| `Operators`, `OperatorIds` | Single line text | Immutable crew snapshot for the row |
| `StartDate`, `ActualStartAt`, `DueDate`, `ExpectDate`, `CompletedAt` | Date and time | Preserve time and UTC value |
| `StartOverrideReason` | Multiple lines text | Required by the UI when the normal start gate is overridden |
| `OrderQty`, `RemainingQty`, `ShiftOutput`, `Complete`, `Reject`, `Rework` | Number | Zero or greater |
| `JobCompleted`, `Paused` | Yes/No | Both must not be true on one row |
| `PauseReason`, `Notes` | Multiple lines text | Daily entry detail |

Migration:

1. Find and resolve duplicate `Title` + `Date` rows. The sync deliberately
   refuses ambiguous duplicates and will show them in the board warning banner.
2. Add the new columns. Backfill `RecordKey` for every existing row, then turn
   on its unique-value constraint and index.
3. Grant the app identity access only to this site/list. Do not use a broad
   tenant Graph token in the browser.
4. Test create, update, completion and retry behavior in a non-production list.
5. Set `VITE_PRODUCTION_LIST` only after the schema and permissions are ready.

Historical `Operators` and `OperatorIds` are daily snapshots. Removing or
reallocating the active crew must never rewrite older rows. On a completion
save, the completion row retains its snapshot while the live allocation is
released atomically in the plan store.
