# Board interaction rules

## Date filtering

Each timeline date has an order-count button. Select it to show orders with
work on that day; select it again to return to five working days. The header
also provides a date input and a Today shortcut. All orders and 5 working
days remain available.

Counts use positive scheduled crew hours or recorded production output, once
per order. Idle gaps, unstaffed orders and unapproved weekends do not count.
PMD context orders use their source bars because their crews are managed
outside assembly. Counts include collapsed lines and use the same rows as
the filter. Historical results only include orders still loaded on the board;
this is not a complete production-history report.

## Row order

Initial display sorts each line by ascending start time. Editing starts,
changing crews and background recalculation preserve existing row order.
New orders append to their line; removed orders disappear. Filtering does
not discard the full row-order snapshot, so clearing a filter restores it.
An order moved outside the active date filter no longer matches that filter.

Clicking a sortable date heading explicitly reorders rows. Manual Refresh
waits for the source load and then sorts by ascending start time again.
Automatic refresh preserves the current row order. Display order is separate
from the scheduler's resource and dependency sequence.

## Crew orders

The button fills orders that have remaining work and no crew. It preserves
manual allocations and the supervisor's current line placement of workers.

1. Use the current production-line roster. Do not silently transfer workers
   from another line based on an old Skills value.
2. Within that roster, prefer matching line skills and work-kind trades.
   Current line placement remains authoritative if no skill match is listed.
3. Among equally skilled candidates, prefer availability, then fewer existing
   bookings, then original roster order for deterministic results.
4. Prefer one person for up to 7.5 remaining standard labour hours, two for
   more than 7.5 through 50 hours, and three for more than 50 hours.
5. Table assembly prefers three people at any positive workload.

Team sizes are preferences: use fewer people when the current roster is
smaller. Exclude people off shift or on leave today. Busy workers can queue
behind their existing work; recompute the schedule between waves and remove
suggestions that would still overlap. Workers are never duplicated within a
crew. A line with no available roster remains unstaffed.

Skills are categorical because the current operator data does not contain a
numeric skill level. These preferences do not claim to optimize efficiency or
certification. Future dated attendance remains a separate integration need.
