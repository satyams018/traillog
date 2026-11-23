# TrailLog

Turn any trip into a story you can share: a city walk, a road trip, a trek or a week by the
sea. Upload a GPX track and your photos, and TrailLog draws your route on **3D terrain** with an **elevation profile synced to the map**, and puts
each photo **where you took it**. Next up: a flythrough replay and a public share page.

> Status: in active development. GPX tracks, stats, the 3D map and photos work; the flythrough
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
- Map-first trip page: a full-width 3D map with the title and headline numbers laid over it,
  photos in route order along its bottom edge, and the elevation chart in a band below (ADR-31)
- Optional story: stops (camp, summit, viewpoint…) threaded down the trip page from start to
  finish, each with a few words and its photos as polaroids that "develop" as you scroll; a trail
  line fills in and a sticky elevation rail tracks where you are; stops can be reordered (ADR-32)
- Landing page hero is a live 3D map of a real sample trek; trip cards use the first photo as
  a cover with a small route map
- Photos (JPEG/HEIC, up to 25 MB, 300 per trip):
  - uploaded straight from the browser to storage with presigned PUTs and per-file progress
  - background job reads EXIF, makes 400 px / 1600 px WebP copies **without any metadata**, then
    deletes the original; a 1 GB per-user quota counts only the stored copies
  - placed on the route from photo GPS, else by matching the photo's time to the track
    (time zone aware), else placed by hand with a click on the map
  - camera-clock slider to fix photos from a camera set to the wrong time
  - clustered markers on the 3D map, hover previews, full-screen viewer (keys, swipe,
    "Show on map"), and one-click Show all / Hide all for the share page

## Architecture
```
React SPA (Vite, MapLibre, uPlot) ──/api, /_allauth──► Django + DRF + GeoDjango
                                                          │        │
                                       PostgreSQL+PostGIS ◄┘        └─► Redis ─► Celery worker
                                                                  (process_gpx, process_photo)
                                       S3 API (SeaweedFS locally, R2 in prod) ◄── GPX files, photo copies
                                                 ▲
                         browser ── presigned PUT ┘ (photo uploads skip Django)
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
Matching demo photos (GPS, time-only with a slow camera clock, and one with no EXIF) come from
`uv run --project backend python samples/make_demo_photos.py demo-photos`. The landing page's
sample track (`frontend/src/assets/sample-trek.json`) is regenerated from the same GPX with
`uv run --project backend python samples/make_landing_track.py`.

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
| Photo processing (2400×1600 JPEG → two WebP copies, Celery job) | 0.19–0.85 s |
| Main JS bundle (gzip, before MapLibre) | 137 kB |
