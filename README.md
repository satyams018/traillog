# TrailLog

Turn any trip into a story you can share: a city walk, a road trip, a trek or a week by the
sea. Upload a GPX track and your photos, and TrailLog draws your route on **3D terrain** with an **elevation profile synced to the map**, and puts
each photo **where you took it**. Share it with one link: the start and end of the route are
hidden for privacy, and the link previews nicely in WhatsApp and Slack. Press **Play the trip** to watch the
camera fly along the route as your photos and stops pop up.

> Status: in active development. GPX tracks, stats, the 3D map, photos, stories, share pages and
> the flythrough replay work; the deploy is next ([SPEC.md](SPEC.md) §14). Screenshots and a live URL come with the
> first deploy.

## Features
- Email/password accounts (django-allauth, headless) with same-origin session cookies
- Account self-service: forgot/reset password, email confirmation (with resend), a settings
  page for display name and password, and deleting the account with all its trips and files
- Trips: create, rename, delete, visibility (private / link / public)
- GPX upload, processed in a Celery background job:
  - haversine distance that ignores gaps between segments
  - elevation gain/loss with median filter + 5 m hysteresis (raw gain kept for comparison)
  - moving time vs. total time, moving pace, max altitude, timezone of the start point
  - Douglas–Peucker simplification in PostGIS (in metres, via Web Mercator)
- 3D map (MapLibre + open AWS terrain tiles) with four keyless styles (ADR-36): Terrain (land
  tinted by height with multi-direction hill shading), Satellite (Sentinel-2 cloudless by EOX),
  Topo and Dark
- Elevation chart (uPlot) synced both ways with the map
- Map-first trip page: a full-width 3D map with the title and headline numbers laid over it,
  photos in route order along its bottom edge, and the elevation chart in a band below (ADR-31)
- Optional story: stops (sight, food, stay, viewpoint…) threaded down the trip page from start
  to finish, each with a few words and its photos as polaroids that "develop" as you scroll; a
  route line fills in and a sticky elevation rail tracks where you are; stops can be reordered
  (ADR-32)
- Flythrough replay on the trip, share and landing pages (ADR-35): the camera follows the
  route at a tilt over 3D terrain, the travelled part lights up, it pauses on each photo and
  names each stop as it passes; play/pause, scrubber, 1×/2×/4×, and the elevation chart follows
- Map: route drawn as a blue-to-raspberry gradient with a soft glow, photos as round thumbnail
  pins, story stops as labelled pins
- Lifetime totals on the trips page (trips, distance, days out, photos, highest point) and a
  Share button on share pages (the phone's share sheet, else copy link)
- Share pages at `/u/<user>/<trip>` (ADR-34):
  - Private, Anyone with the link (a secret `?k=` key that can be replaced), or Public;
    private trips and wrong keys get the same 404 as trips that don't exist
  - a privacy zone hides the first and last 0–2 km of the route; photos taken there lose
    their pin, and the public payload never includes EXIF, timestamps or the owner's email
  - Django fills in link-preview tags, and a 1200×630 preview image (blurred cover, route,
    title, numbers) is drawn with Pillow the first time a preview asks for it
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

In development, emails (confirm your email, reset your password) are printed in the
`runserver` terminal instead of being sent. Their links point at `FRONTEND_URL`
(`http://localhost:5173` by default).

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
