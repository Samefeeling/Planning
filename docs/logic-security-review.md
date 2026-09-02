# Planning board logic and security review

Reviewed against branch `claude/loving-cannon-w3j8cq` in September 2026.

## Corrected in this change

- Added explicit actual-start and completion transitions. Planned dates are no
  longer used as proof that work started.
- Made production entry, progress update and completion crew release one atomic
  store update; every daily entry retains an immutable crew snapshot.
- Added a source progress baseline so a later Epicor refresh does not deduct
  the same locally-booked quantity twice.
- Treats missing release and kit-readiness fields as unknown rather than ready.
  Starting outside the normal gate needs Supervisor unlock and a reason; an
  order can never start with zero crew.
- Locks a started order against drag/line moves and validates non-negative
  quantities, maximum Complete, and mutually exclusive Pause/Completed states.
- Makes SharePoint rows deterministic with `RecordKey`, detects duplicates,
  blocks fallback demo employee ids, and retries transient write failures.
- Removed the pull-job side column, limited detail opening to order blocks, and
  made the employee picker a single global pop-up.
- Updated SheetJS to 0.20.3 and Vitest to a patched release.

## Deployment risks that code alone cannot close

1. **Public repository data:** `src/data/mock/seed.json` contains realistic
   production, purchasing and named-worker data. Confirm it is approved for
   public disclosure; otherwise make the repository private and purge the file
   from Git history.
2. **Browser secrets:** `VITE_GRAPH_TOKEN` and `VITE_SUPERVISOR_PASSWORD` are
   compiled into the browser bundle. They are operational conveniences, not an
   authentication boundary. Production write-back needs a backend/token broker
   using short-lived user/app credentials and least-privilege SharePoint access.
3. **Concurrent editors:** deterministic keys and unique constraints prevent
   duplicate daily rows, but direct browser Graph writes do not yet provide a
   full transaction or user audit identity. A backend should add ETag-based
   optimistic concurrency and an append-only audit log.
4. **Branch governance:** require pull-request review, passing CI, secret
   scanning and dependency updates on the production branch.

The current tree contained no committed private keys, JWTs, `eval`, or unsafe
raw-HTML rendering in the reviewed source. That does not replace repository
secret scanning or runtime penetration testing.
