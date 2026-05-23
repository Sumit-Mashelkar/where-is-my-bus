# TransitPulse

Real-time bus tracking app — search routes between stops, view live bus locations on a map, and crowd-source GPS position updates via WebSockets.

## Run & Operate

- `bash /home/runner/workspace/artifacts/api-server/start.sh` — run the Python API (port 8080)
- `pnpm --filter @workspace/transitpulse run dev` — run the React frontend (port 18711)
- `pnpm install` — install all workspace packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite 7, Tailwind v4, react-leaflet, react-router-dom, socket.io-client, axios
- Backend: Python Flask 3.1 + python-socketio 5 (ASGI via uvicorn)
- DB: SQLite (file: `artifacts/api-server/transitpulse.db`)

## Where things live

- `artifacts/api-server/server.py` — Flask API + socket.io server (all routes at `/api/*`)
- `artifacts/api-server/requirements.txt` — Python deps
- `artifacts/transitpulse/src/` — React frontend source
  - `src/pages/Home.jsx` — main map page
  - `src/components/MapView.jsx` — Leaflet map
  - `src/components/BusDetailSheet.jsx` — bus details slide-over
  - `src/components/AddBusDialog.jsx` — add bus with route stops + GPS share
  - `src/components/UpdateLocationDialog.jsx` — crowd-sourced bus location update
  - `src/lib/api.js` — axios wrapper (base: `/api`)
  - `src/lib/socket.js` — socket.io client connecting on `/api/socket.io`

## Architecture decisions

- Python backend replaces the default Node.js API server template; only the artifact.toml path binding is kept.
- Socket.io runs under `/api/socket.io` so the proxy routes it through the same `/api` path entry — no extra path needed.
- SQLite used instead of PostgreSQL since the app is self-contained and single-process.
- Demo seed data (4 buses + 12 NYC stops) is inserted on first run if the DB is empty.

## Product

- Full-screen interactive map (light/dark) showing live bus positions with status-colored markers
- Route search: type origin + destination stop name, get matching buses with ETA
- Polyline route visualization on the map
- Crowd-sourced live GPS updates via socket.io (any rider can broadcast bus position)
- Add new buses (with ordered stop selection) and stops via dialogs
- Dark mode toggle with localStorage persistence

## User preferences

_Populate as you build._

## Gotchas

- Python packages must be pre-installed before starting the api-server workflow (already done in this env).
- The `start.sh` uses an absolute path in the artifact.toml `run` command — relative paths fail.
- Socket.io emits from Flask route handlers use `asyncio.run_coroutine_threadsafe` to bridge the sync WSGI world with the async ASGI event loop.
