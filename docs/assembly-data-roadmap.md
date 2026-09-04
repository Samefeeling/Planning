# Assembly board data and SharePoint list roadmap

These are design recommendations based on the current implementation. The proposed lists are not yet integrated. Prioritize shared plan storage, daily attendance, and material picking before adding more detailed master data.

## Existing data responsibilities and gaps

| Source | Responsibility | Current implementation |
| --- | --- | --- |
| Planning1.csv | Epicor orders, quantities, due dates, labor hours, and lines | Read by the board; Epicor remains the owner of due dates |
| JobMaterialReq.csv | Components consumed by each order, required quantities, and dependencies | Read; issued quantities, material sequence numbers, and unit conversions are not yet parsed |
| ASSY_Operator | Stable operator ID, name, Skills, Position, and Supervisor | Read; optional OnShift and PlannedLeave are supported, but there is no dated shift roster |
| ASSY_Production | Daily output, rejects, rework, pauses, actual starts, completion, and crew snapshots | Existing rows are read for differential writes; this is not a complete shared-plan restore path |
| OPS_PartOnhand.csv (proposed) | Warehouse inventory and available quantities | Not integrated; PlanningCsvSource currently returns empty inventory, BOM, and PO arrays |

Keep ASSY_Production at one row per order per production day, with a unique RecordKey of JobNum|YYYY-MM-DD. Historical crew snapshots must not be replaced by current assignments. See the [existing schema](sharepoint-production-schema.md).

Without VITE_PERSIST_API_URL, the complete plan is stored in browser localStorage. Writing ASSY_Production does not restore dragged dates, assignment windows, overtime approvals, or line sequences on another computer. Shared persistence needs an adapter, reload behavior, and conflict handling.

## Recommended lists

| Priority | Proposed list and record grain | Core fields | Purpose |
| --- | --- | --- | --- |
| 1 | ASSY_Plan: one row per PlanId and JobNum | PlanId, JobNum, Line, Sequence, PinnedStart, OvertimeApproved, DoubleBookApproval, Revision, Modified, ModifiedBy | Share supervisor decisions without allowing CSV refreshes to overwrite them |
| 1 | ASSY_CrewAssignment: one row per assignment window | AssignmentId, PlanId, JobNum, OperatorId, FromDay, ToDayExclusive, ApprovedOverlap | Preserve temporary assistance, partial assignments, and approved overlaps; reference stable ASSY_Operator IDs |
| 1 | ASSY_Attendance: one row per OperatorId, Date, and Shift | RecordKey, OperatorId, Date, Shift, Present, AvailableHours, CurrentLine, LeaveReason | Supply real attendance, leave, training, daily capacity, and the Team denominator |
| 2 | ASSY_MaterialPick: one row per order material line and warehouse/bin/lot | PickKey, JobNum, AssemblySeq, MtlSeq, PartNum, Warehouse, Bin, Lot, UOM, ReservedQty, PickedQty, IssuedQty, Status, ConfirmedBy, ConfirmedAt, SnapshotId | Distinguish inventory, reservations, picking, issues, and shortages; support material readiness checks |
| 2 | ASSY_Calendar: one row per date, line, and shift | Date, Line, Shift, IsWorkingDay, StartTime, EndTime, BreakMinutes, CapacityOverride, Reason | Model holidays, shutdowns, and overtime instead of relying on a fixed Monday-to-Friday calendar |

If starting with only two additional lists, implement ASSY_Plan and ASSY_Attendance. For a team of about 15 people, ASSY_Plan can initially contain each order's CrewAssignments as a JSON array of windows. Migrate to ASSY_CrewAssignment when needed; do not maintain both as competing assignment authorities.

CurrentLine describes today's placement; Skills describes long-term capability. Keep Skills in ASSY_Operator for a small team. Add ASSY_OperatorSkill only when proficiency levels, certificate expiry, or skill-specific efficiency factors are needed. Its grain would be OperatorId and SkillCode, with Level, Efficiency, and ValidUntil.

Later options include ASSY_LineConfig for parallel positions, default shifts, and effective dates, and ASSY_PlanChange for scheduling events, reasons, before/after values, and actors. Ordinary field history can initially use SharePoint version history instead of a separate audit system.

## Inventory export requirements

OPS_PartOnhand.csv should include Company/Site, PartNum, Warehouse, Bin, Lot where applicable, UOM, OnHandQty, ReservedQty or a clearly defined AvailableQty, QualityHoldQty, and SnapshotAt/ExportId.

OnHandQty alone does not establish pickable stock:

- Exclude stock reserved for other orders, quality holds, and non-pickable locations.
- If ERP AvailableQty is already net of reservations, do not subtract them again.
- Allocate or reserve shared stock across orders so the same units are not promised repeatedly.
- Clarify whether RequiredQty is an order total or a per-unit requirement. QtyPer must be multiplied by the relevant order quantity.
- Add IssuedQty, AssemblySeq/MtlSeq, and UOM to material requirements to calculate outstanding issues and distinguish repeated components within an order.
- Reconcile ERP issues/reservations and local picking records using transaction IDs and status to avoid double deductions.
- Align material and inventory exports to a consistent snapshot where possible. Missing or stale data must read as unverified, not material-ready.

To forecast when shortages will clear, also provide an open purchase/transfer supply CSV with PartNum, Site/Warehouse, OpenQty, ExpectedReceiptDate, document number, and status. These ERP facts can remain CSV/API feeds rather than manually maintained lists. Components made by preceding production orders continue to use JobMaterialReq dependencies and predecessor finish dates.

## Integration sequence and acceptance checks

1. Implement shared-plan save and restore. A second browser opening the same PlanId must obtain the same arrangement.
2. Integrate daily attendance. Absent staff must be excluded from both the Team denominator and scheduling capacity.
3. Integrate inventory and material lines, then reservation/picking status. Detect two orders competing for the same stock.
4. Replace the fixed workweek with the line calendar, then extend skill levels and change events as needed.

Shared updates require concurrency control rather than silently overwriting another supervisor's changes. Microsoft Graph listItem updates support If-Match/eTag and return 412 when the version does not match. Reload and resolve the conflict. Multi-row crew changes also need revision-based or complete-snapshot publication to prevent readers seeing a partially updated plan. See the [Microsoft Graph documentation](https://learn.microsoft.com/en-us/graph/api/listitem-update?view=graph-rest-1.0).

Creating lists only establishes storage structures. Their read paths, scheduling constraints, user interactions, and write-back behavior still need implementation.
