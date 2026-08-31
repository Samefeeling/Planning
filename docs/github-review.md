# GitHub reference review

Reviewed before this iteration (31 August 2026). Network search was blocked in
the build environment, so the review uses the established upstream project
URLs below rather than claiming a current exhaustive GitHub search.

| Project | Useful pattern | Decision for Resero Planning |
| --- | --- | --- |
| [frappe/gantt](https://github.com/frappe/gantt) | Simple, readable Gantt interaction and view-scale controls | Adopt a compact day-width slider while retaining Resero's crew-driven scheduling engine. |
| [frappe/erpnext](https://github.com/frappe/erpnext) | Manufacturing work orders, job cards, downtime and quality records | Keep Complete, Reject, Rework, Quality Check and Pause details together as a daily production record. |
| [frePPLe/frepple](https://github.com/frePPLe/frepple) | Capacity-aware planning, operation dependencies and exceptions | Retain Resero's predecessor/material gates and expose staffing/exception information directly on the schedule. |
| [neuronetio/gantt-schedule-timeline-calendar](https://github.com/neuronetio/gantt-schedule-timeline-calendar) | Expandable rows and zoomable scheduling timelines | Add collapsible production units and a continuously adjustable day scale. |

The projects are references rather than dependencies. The current board is
small (one shift and roughly 15 people), so importing a general planning suite
would add considerably more complexity than the focused React/Zustand model
needs.
