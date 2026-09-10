# legacy/

Code that is no longer part of how this project runs, kept rather than deleted.

Nothing here was thrown away. Every file keeps its original name and its
position relative to the tree it came from, so a path written in an old commit
message, a README or a comment still reads correctly with `legacy/` in front of
it.

## Why any of this is retired

The console used to be served by an Express process that also owned the API, and
that Express layer called out to two Python services of its own. All three are
gone. The console is now served by Vite alone and reaches **orca-core** — a
single FastAPI backend — through a proxy declared in `vite.config.ts`.

## What is here

### `express-backend/server/`

The Express API, and the Vite middleware that used to serve the frontend inside
it. Its routes are answered by orca-core now, in the same shapes, so the console
did not have to change when it was switched off.

Two of its ideas were ported rather than dropped: the task-graph executor with
deterministic replanning, and source-disagreement detection. Both live in
orca-core as Python.

### `ml-service/ml/`

The XGBoost risk API, the BGE-M3 and Qdrant retrieval service, and the training
pipeline behind them.

The risk model is not used, and should not be revived as it stands: its training
label was computed from each row's own wind and wave by a fixed threshold
function, and those same columns were then fed back in as features, with no time
shift anywhere. The target was a deterministic function of the inputs at the
same timestamp, so its accuracy was arithmetic rather than skill. Its metadata
also records training on NOAA NDBC data — US buoys — while the configuration
lists Indian coastal locations.

Retrieval was rebuilt in orca-core as BM25 over documents that must be fetched
successfully before they can enter the corpus. The embedding stack it replaced
needed roughly 2.2 GB of model against a 512 MB host.

### `dev-scripts/scripts/`

Test and sync scripts, nearly all of which drive the Express or ML services.
They are excluded from the TypeScript program, so their relative imports —
written for the old layout — no longer resolve. Anyone reviving one will need to
repoint those paths; the code itself is untouched.

### `unused-frontend/src/`

Four source files that nothing in the console imports. `riskService.ts`,
`satelliteService.ts` and `realOceanColorService.ts` were imported only by the
Express server, and `Header.tsx` is referenced nowhere at all.

This was checked by walking the import graph from `src/main.tsx` rather than by
reading imports. An earlier attempt using a bundler's own graph was wrong: that
build failed on an unresolved dependency and produced a partial answer that
called five live UI components dead. They render on the landing page.

### `data/data/`

Qdrant's on-disk storage, the evidence corpus the retired retrieval service
used, and cached realtime telemetry.

## What is still live

```
frontend/       the console, and everything it needs to build
  src/  public/  index.html  vite.config.ts  tsconfig.json  package.json
```

The frontend moved into its own folder to match the ORCA repository, where each
surface — `frontend/`, `backend/`, `orca-core/` — owns its own package.json and
config. Spreading it across the repository root made sense when the root was
also an Express server and two Python services; those are here now, so the root
holds one thing and says so.

```bash
cd frontend && npm run dev:console
```

Port 3001, with `/api` proxied to orca-core on 8100. Start orca-core first.

## Running anything in here

Every retired npm script still exists, prefixed `legacy:` and repointed at these
paths — `npm run legacy:dev` for the Express server, `npm run legacy:dev:ml` for
the risk API, and so on. They live in `frontend/package.json` and reach back out
with `../legacy/`, because npm runs a script from the directory its package.json
sits in. They were left runnable rather than removed, because a
script that fails with "file not found" tells you less than one that runs and
shows you what it did.

`legacy/` is excluded from `tsconfig.json`, so nothing here is typechecked with
the console.
