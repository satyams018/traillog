# TrailLog

Turn a trek into a story you can share. Upload a GPX track (and soon photos), and TrailLog
draws your route on **3D terrain** with an **elevation profile synced to the map**. Next up: a
flythrough replay, photos placed where you took them, and a public share page.

> Status: in active development. GPX tracks, stats and the 3D map work; photos, the flythrough
> and share pages are next ([SPEC.md](SPEC.md) §14). Screenshots and a live URL come with the
> first deploy.

## Features
- Email/password accounts (django-allauth, headless) with same-origin session cookies
- Trips: create, rename, delete, visibility (private / link / public)
- GPX upload, processed in a Celery background job:
  - haversine distance that ignores gaps between segments
  - elevation gain/loss with median filter + 5 m hysteresis (raw gain kept for comparison)
  - moving time vs. total time, moving pace, max altitude, timezone of the start point
  - Douglas–Peucker simplification in PostGIS (in metres, via Web Mercator)
- 3D map (MapLibre + open AWS terrain tiles), satellite / topo / dark styles
- Elevation chart (uPlot) synced both ways with the map

## Architecture
```
React SPA (Vite, MapLibre, uPlot) ──/api, /_allauth──► Django + DRF + GeoDjango
                                                          │        │
                                       PostgreSQL+PostGIS ◄┘        └─► Redis ─► Celery worker
                                                                               (process_gpx)
                                       S3 API (SeaweedFS locally, R2 in prod) ◄── GPX files
```
Design decisions and their tradeoffs are in [docs/decisions.md](docs/decisions.md).

## Tech stack
Django 6 · DRF · GeoDjango · PostgreSQL 16 + PostGIS · Celery + Redis · django-allauth ·
React 19 + TypeScript + Vite · Tailwind CSS 4 · lucide icons · TanStack Query · MapLibre GL · uPlot ·
pytest · Vitest · ruff + black · oxlint + prettier · GitHub Actions · Docker Compose (local services)

## Run locally
Prerequisites (macOS, Apple Silicon): `uv`, Node 22+, Homebrew `gdal`, and a Docker runtime
(Colima: `brew install colima docker docker-compose`).

```bash
cp .env.example .env            # then set DJANGO_SECRET_KEY (and VITE_MAPTILER_KEY if you have one)
colima start --cpu 2 --memory 2 # skip if Docker is already running
docker-compose up -d            # PostGIS, Redis, SeaweedFS (local S3)

cd backend
uv sync
uv run python manage.py migrate
uv run python manage.py ensure_bucket      # creates the local storage bucket once
uv run python manage.py runserver          # http://localhost:8000
uv run celery -A config worker -l info --concurrency=2   # in a second terminal

cd ../frontend
npm install
npm run dev                                # http://localhost:5173
```

Stop everything when done: `docker-compose stop && colima stop`.

A synthetic 2-day demo trek for testing is in `samples/demo-trek.gpx` (regenerate with
`uv run --no-project --python 3.12 samples/make_demo_gpx.py > samples/demo-trek.gpx`).

## Tests and linting
```bash
cd backend && uv run pytest && uv run ruff check . && uv run black --check .
cd frontend && npm test && npm run lint && npm run format:check && npm run build
```

## Metrics
Measured locally on an M1 MacBook Air (8 GB) with the synthetic demo trek; real-trek numbers
and flythrough fps / Lighthouse come with the first deploy.

| Metric | Value |
|---|---|
| GPX processing (6,000 points, Celery job) | 0.45 s |
| Points after Douglas–Peucker (5 m tolerance) | 6,000 → 937 (−84%) |
| Elevation gain, raw GPS sum vs. smoothed | 13,678 m → 1,580 m |
| Main JS bundle (gzip, before MapLibre) | 130 kB |
