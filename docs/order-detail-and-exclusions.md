# Order detail and local exclusions

Schedule dates use plain text rows in dd/mm/yyyy format.

The warehouse pick list joins JobMtl_PartNum to Part_PartNum in OnHandInventory.csv.
On hand uses Calculated_OnHand; Demand uses Calculated_Demand. Missing demand is
shown as a dash rather than zero. Repeated part rows are summed, matching the
on-hand aggregation. Hovering a part shows Part_PartDescription (or Description)
when present in the inventory export.

Unlock Supervisor to ignore orders outside the current production scope.
Use Ignore on an unplaced order card, or Review orders beside Crew orders.
Ignored unplaced orders leave the visible queue; ignored unstaffed orders leave
crew suggestions and their count. Existing scheduled rows and dependency data
are retained. Restore is available in Review orders.

Exclusions are stored in this browser's local storage, survive refreshes, and
are not yet shared through SharePoint. No production record is deleted or
marked completed by ignoring it.
