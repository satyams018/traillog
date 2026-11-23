# TrailLog — Specification

Status: draft v1, 2026-11-22. Built from `traillog-prompt.md` and the feature Q&A (`FEATURES.md`).
Reasons behind each choice are in [`docs/decisions.md`](docs/decisions.md) (cited as ADR-n).

---

## 1. Goal

TrailLog turns a trek or trip into a story you can share. Upload a GPX track and your photos. TrailLog builds a 3D flythrough over real terrain, with photos placed where they were taken and an elevation profile that stays in sync with the map. You then share a good-looking public story page.

**Users:** college trekking and travel clubs, friends back from a trip, solo travellers.
**MVP success:** a live URL where a real trek (GPX + photos) can be uploaded, replayed and shared, with metrics in the README (§13). Real trek-club users come later (§14).

## 2. Non-goals

- Live GPS recording or a native mobile app. TrailLog imports tracks; it doesn't record them.
- Route planning or navigation.
- A full social network: no follow system, feed or DMs.
- Offline/PWA, AI features, and video or audio uploads (not now; see `FEATURES.md`).
- Getting full scores for perfect SEO. Share pages get correct meta tags, not full SSR (ADR-12).

## 3. Release tiers

| Tier | When | Features |
|---|---|---|
| **MVP** | First release | F1–F11 below |
| **v1.0.1** | Right after the MVP | Google sign-in, journal bodies on highlights, Playwright E2E, editor polish, onboard the trek club |
| **v1.1** | After v1.0.1 | Day chapters, travel trips without GPX, likes & comments, story-card export, budget breakdown, how-to-reach, minimal profile page |
| **v1.2** | After v1.1 | Co-authors, personal stats dashboard, badges, Explore nearby trips |

### MVP features

| # | Feature | Acceptance criteria |
|---|---|---|
| F1 | **Auth** | Sign up and log in with email/password (with email verification; emails go to the console in dev). Google sign-in moves to v1.0.1, but allauth makes it a config change, not new code. Sessions use httpOnly cookies (ADR-3). Users can access only their own trips. |
| F2 | **GPX upload & processing** | Upload a `.gpx` file up to 20 MB. A background job parses tracks, segments and waypoints and computes stats (§6.1). The trip shows `processing`, then `ready` or `failed` with a readable error. |
| F3 | **Photo upload** | Upload up to 300 JPEG/HEIC photos (25 MB each) per trip, straight to storage via presigned PUT (ADR-4), with a per-file progress bar. Thumbnails and web-size versions are made in the background, and then the **uploaded original is deleted**: originals stay on the user's own phone or drive (ADR-21). Each user has a **1 GB quota** for stored copies, shown as a usage bar. Uploads over quota are refused before they start. |
| F4 | **Photo placement** | Placement uses EXIF GPS first, then time-matching to the track, then manual placement (§6.3). The owner can set a camera-clock offset with live preview. Changing it re-runs the matching. Unplaced photos appear in a tray and can be dropped onto the map or the chart. |
| F5 | **3D map** | MapLibre terrain (ADR-11) with the route, start/end markers, photo markers and a satellite / topo / dark style switcher. |
| F6 | **Photo clusters + gallery** | Markers cluster when zoomed out. A full-screen lightbox supports swipe, keyboard and "show on map". |
| F7 | **Flythrough** | The camera follows the route with play/pause, 1×/2×/4× speed and a scrubber. Photos and highlights open as the camera passes them. Runs at ≥ 30 fps on a mid-range Android phone. |
| F8 | **Elevation chart** | Synced both ways: hovering or scrubbing the chart moves a marker on the map, and hovering the route highlights the chart. Shows the flythrough position during playback. |
| F9 | **Story editor** | Edit the title, description, cover photo and captions. Choose which photos are public with a per-photo toggle, **multi-select, and one-click "Show all / Hide all"** for the whole trip (photos are public by default; the trip itself is private until shared). Add highlights (label, type: sight/viewpoint/food/stay/camp/summit/other, notes, and any number of the trip's photos; ADR-32). For the MVP the editor is a simple tabbed form next to the map; the polished split view and **journal bodies** (Markdown) come in v1.0.1. Changes are saved with a Save button (autosave comes later). |
| F10 | **Share page** | `/u/<username>/<slug>` opens without login. Django renders the meta tags (`og:*`, `twitter:card`) and an auto-generated 1200×630 preview image (ADR-12, ADR-15). Visibility is Private / Link / Public (§8). |
| F11 | **Privacy** | Public photo files never contain EXIF. A privacy zone hides the first and last X m of the route (default 300 m). New trips are private (§8). |

### v1.1 / v1.2 features (specified briefly; detailed spec before each tier starts)

- **Day chapters:** split the track automatically wherever there's a gap of over 3 h without movement. The owner can adjust split points and give each day a title and notes. The story page scrolls chapter by chapter, and the map flies to each one.
- **Travel trips (`kind=travel`):** pin places in order (search or click), joined by curved arcs. Photos are placed by EXIF GPS or assigned to a place. There is no flythrough; instead the map "hops" between places.
- **Likes & comments:** signed-in users can like or comment on trips and photos. The owner can delete comments or turn them off per trip. Rate-limited.
- **Story card:** a 1080×1920 PNG (cover + route + key stats) for Instagram/WhatsApp stories. Made by the same Pillow pipeline as the preview image.
- **Budget:** cost-per-person line items by category (travel/stay/food/gear/permits/other) in INR, with a total and a pie chart.
- **How to reach:** ordered transport legs (mode, from → to, duration, cost, notes).
- **Profile page:** `/u/<username>` lists Public trips and lifetime totals. Needed because Public trips are "listed on your profile".
- **Co-authors (v1.2):** the owner invites friends by link. Editors can add photos and journal entries but can't change visibility or delete the trip.
- **Stats dashboard (v1.2):** distance, elevation and trip count per month, plus a heatmap of all your routes.
- **Badges (v1.2):** computed when a trip becomes `ready` (e.g. first 4000 m peak, 100 km total, 5 states visited).
- **Explore (v1.2):** public trips near a point, found with PostGIS `ST_DWithin` on each trip's privacy-trimmed start point.

## 4. Tech stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12, Django 5 + DRF + GeoDjango, `django-allauth` (headless mode) for email and Google login |
| Database | PostgreSQL 16 + PostGIS 3 (ADR-2) |
| Jobs | Celery + Redis 7 (`redis:7-alpine` container, same image locally and in prod) (ADR-6) |
| GPX / photos | `gpxpy`, Pillow + `pillow-heif` (Pillow also reads EXIF, ADR-28), `timezonefinder` |
| Storage | S3 API via `boto3`. SeaweedFS locally (ADR-23), Cloudflare R2 in prod. Private bucket (ADR-14) |
| Frontend | React 19 + TypeScript + Vite, React Router, TanStack Query, Tailwind CSS 4, lucide-react icons |
| Map | MapLibre GL JS, AWS Terrain Tiles (Terrarium) for 3D, MapTiler for base styles (ADR-17), Turf.js |
| Chart | uPlot (ADR-16) |
| Quality | pytest + pytest-django, Vitest + React Testing Library, Playwright (one end-to-end test), ruff + black, eslint + prettier |
| Local infra | Docker Compose (Colima): postgis, redis, SeaweedFS only. Django, Celery and Vite run natively to save RAM on the 8 GB M1 |
| Deploy | Fly.io: one app with `web` and `worker` process groups, plus a separate small Redis app with a volume. Neon (Postgres + PostGIS), Cloudflare R2 (ADR-18). GitHub Actions CI |

## 5. Architecture

```
Browser ── same origin ────────────────────────────────────────────────
  React SPA (MapLibre 3D, flythrough, uPlot chart)
     │ /api/*  (session cookie + CSRF)        ▲ presigned GET (1 h)
     ▼                                        │
  Django (gunicorn) ──── presigned PUT ─────► Object storage (R2 / SeaweedFS)
   ├─ DRF API                                  uploads/ (temp)  derived/  og/
   ├─ allauth headless (/_allauth/*)              ▲
   ├─ share-page view /u/<user>/<slug> (meta tags + SPA shell)
   └─ enqueue ──► Redis ──► Celery worker ──────┘
                             process_gpx, process_photo, match_photos,
                             build_public_track, render_og_image
   ▼
  PostgreSQL + PostGIS
```

- **One origin.** In production, Django serves the built SPA (`index.html` + hashed assets via WhiteNoise), so session cookies need no CORS. In development, Vite proxies `/api` and `/_allauth` to Django.
- **Share pages.** Django handles `/u/<username>/<slug>`. It checks visibility and injects meta tags into the SPA's `index.html`. React then hydrates and loads the story from `/api/public/...` (ADR-12).
- **Processing status.** The API answers `202 Accepted` and sets `status=processing`. The SPA polls the trip every 2 s until the status changes (ADR-19).

## 6. Processing pipeline

### 6.1 `process_gpx(trip_id)`
1. Load the GPX from storage and parse it with `gpxpy`. If the file has no `<trk>`, use `<rte>`. Waypoints become suggested highlights.
2. Join segments into one point list in time order, remembering where each segment breaks (no distance is counted across a break).
3. **Distance:** haversine sum (2D) over consecutive points.
4. **Elevation:** fill missing values by interpolation, remove spikes with a 5-point median filter, then count gain/loss only after the elevation moves at least 5 m from the last reference point (hysteresis) (ADR-8). Raw gain is also stored for comparison.
5. **Time:** total = last − first. Moving time = intervals where speed ≥ 0.3 m/s and the gap is ≤ 60 s. Also compute moving pace (min/km), average moving speed, and max altitude (after smoothing).
6. **Timezone** of the start point via `timezonefinder` (stored on Trip, used in §6.3).
7. **Simplify:** transform to EPSG:3857 and apply `ST_SimplifyPreserveTopology` with a ~5 m tolerance (corrected for latitude), then transform back. Keep the full geometry for stats (ADR-9). Log how many points were removed (metric).
8. **Profile:** downsample to ≤ 2,000 `[dist_m, ele_m, t]` samples for the chart.
9. Run `build_public_track` and `render_og_image`, then set `status=ready`. On any error, set `status=failed` with the error message; the job retries at most twice for errors that are only temporary.

### 6.2 `process_photo(photo_id)`
1. Run HEAD on the object and check the size, then read the first bytes to check the file type (JPEG/HEIC). If it's invalid, delete it and mark the photo `failed`.
2. Read EXIF: `DateTimeOriginal`, `OffsetTimeOriginal`, GPS, camera model and orientation. Save the fields needed later into `Photo.exif` in the database, so re-matching never needs the original file.
3. Make `thumb` (400 px) and `web` (1600 px, ~300 KB) WebP versions with orientation applied. Re-encoding **drops all metadata**, so derived files contain no EXIF (F11).
4. **Delete the uploaded original** from `uploads/` and add the derived sizes to `User.storage_used_bytes` (ADR-21).
5. Place the photo (§6.3), then set `status=ready`.

### 6.3 Photo placement (ADR-7)
1. **EXIF GPS present and plausible** (within 2 km of the track, or there's no track) → `placement=exif`.
2. Otherwise, **match by time**:
   - Convert to UTC: if `OffsetTimeOriginal` exists, use it. Otherwise treat the EXIF time as local time in the trip's timezone. Then add `trip.camera_offset_s`.
   - Binary-search the track's timestamps and interpolate the position between the two surrounding points → `placement=time`.
   - If the time is more than 30 min outside the track's time range, the photo is left `unplaced`.
3. **Manual:** the owner drops the photo on the map or chart → `placement=manual`. Later time-matching never overwrites a manual placement.
4. Each placed photo also stores `route_fraction`, its position along the route from 0 to 1 (the nearest point on the line). The flythrough uses this to open photos as it passes them.
5. Changing `camera_offset_s` runs `match_photos(trip_id)` again for photos placed by time or not yet placed.
6. **Accuracy metric:** for photos with both GPS and a timestamp, compute the time-match position as well and record the distance error.

### 6.4 `build_public_track(trip_id)`
Runs whenever the track or privacy zone changes. It cuts the privacy zone from each end of the simplified line (in Python by haversine distance rather than `ST_LineSubstring`, so it's unit-testable without a database; ADR-34) and trims the profile to match, re-based to start at 0 km and without timestamps. Photo and stop positions on the share page are re-scaled to the trimmed line. If the route is shorter than 2 × the zone, nothing is shown publicly except stats. The result is stored as `Track.public_geom` and `Track.public_profile`.

### 6.5 `render_og_image(trip_id)`
Pillow, 1200×630: the cover photo blurred and darkened as the background, the public route drawn in the projected bounding box, plus the title and three key stats. No map tiles are fetched (ADR-15). The image is stored at `og/<trip_uuid>-<fingerprint>.png`, where the fingerprint hashes everything drawn on it. It's rendered on the first request for that fingerprint instead of by a job after every change (ADR-34); `Trip.og_version` is unused.

## 7. Data model

All primary keys are UUIDs, so IDs can't be guessed or enumerated (ADR-20). SRID is 4326 unless noted.

**MVP**
```
User (custom AbstractUser)
  id, email (unique), username (unique, lowercase, [a-z0-9_-]{3,30}), display_name, avatar_key, created_at
  storage_used_bytes (bigint), storage_quota_bytes (default 1 GB)

Trip
  id, owner→User, kind [gpx|travel] (default gpx), title, slug (unique per owner), description
  visibility [private|link|public] (default private), share_token (22-char random, rotatable)
  status [draft|processing|ready|failed], error, cover_photo→Photo (nullable)
  stats JSONB {distance_m, gain_m, loss_m, raw_gain_m, total_s, moving_s, pace_s_per_km, max_ele_m, points_raw, points_simplified}
  timezone, camera_offset_s (int, default 0), privacy_zone_m (0–2000, default 300)
  start_date, end_date, og_version, comments_enabled (v1.1), created_at, updated_at
  index: (owner, slug) unique; (visibility); GiST on Track geoms

Track (1:1 Trip)
  trip→Trip, gpx_key, geom LineStringZ, times float8[] (epoch s, same order as geom points)
  segment_breaks int[], simplified_geom LineStringZ, profile JSONB
  public_geom LineStringZ (nullable), public_profile JSONB, start_point Point (privacy-trimmed; used by Explore)

Photo
  id, trip→Trip, uploaded_by→User, upload_key (temporary; null once processed), sizes JSONB {thumb, web}
  content_type, original_bytes, stored_bytes, exif JSONB {datetime_raw, offset, gps, camera_model, width, height}
  status [pending|ready|failed], taken_at (UTC, nullable)
  location PointZ (nullable), placement [exif|time|manual|unplaced], route_fraction float (nullable)
  caption, is_public (default true; only applies once the trip is shared), order, created_at

Highlight (a story stop, ADR-32)
  id, trip→Trip, kind [sight|viewpoint|food|stay|camp|summit|other], label, body (plain paragraphs now; Markdown later), order, created_at
  photos: Photo.highlight→Highlight (nullable), so a stop has many photos and a photo is in at most one stop
  route_fraction: worked out from its photos (the middle of the placed ones), not stored
```

**v1.1:** `Chapter(trip, day_no, title, notes, start_fraction, end_fraction, date)`, `Place(trip, order, name, point, date, note)`, `Comment(id, author, trip, photo?, body ≤ 1000, created_at, deleted_at)`, `Like(user, trip?, photo?)` with exactly one target set (check constraint) and a unique (user, target) pair, `BudgetItem(trip, category, label, amount_inr, per_person)`, `TransportLeg(trip, order, mode, from_name, to_name, duration_min, cost_inr, notes)`.
**v1.2:** `TripMember(trip, user, role [editor])`, `TripInvite(trip, token, expires_at)`, `Badge(code, name, description)`, `UserBadge(user, badge, trip, awarded_at)`.

## 8. Privacy & access model

| Visibility | Who can view | Listed on profile / Explore | Indexed by search engines |
|---|---|---|---|
| Private (default) | Owner (+ co-authors in v1.2) | No | No |
| Link | Anyone with `/u/<user>/<slug>?k=<share_token>` | No | No (`noindex`) |
| Public | Anyone with `/u/<user>/<slug>` | Yes | Yes |

- **Why Link trips need `?k=`:** slugs like `hampta-pass` are easy to guess. The token keeps Link trips truly unlisted, and rotating it revokes old links (ADR-13). *Deviation from the prompt*, which shows only `/u/<user>/<trip-slug>`.
- A private trip, or a wrong/missing token, returns **404 exactly like a trip that doesn't exist**, so outsiders can't tell whether a trip exists.
- **Public payload only:** the public track and profile (privacy-trimmed), stats, public photos, highlights, and chapters. Never the `exif` field, the raw track, `times`, the owner's email, or the photos' exact `taken_at` (only date and time rounded to the minute).
- **Photos:** TrailLog keeps no originals (ADR-21). Everyone, the owner included, sees the `derived/` files, which have no EXIF. Photos whose location falls inside a privacy zone appear in the gallery **without a map marker**.
- **Storage:** one private bucket with object keys `uploads/<trip>/<photo>` (deleted after processing), `derived/<trip>/<photo>/{thumb,web}.webp`, `og/...`. Presigned GETs expire after 1 h. Deleting a trip deletes its objects and frees the user's quota (Celery job).
- **Stats** come from the full track. Distance and elevation totals don't reveal a location.

## 9. API

All under `/api/`, JSON, session auth + CSRF. Errors use the shape `{"error": {"code", "message", "fields"?}}`. Lists are paginated with a cursor.

**Auth (allauth headless):** `/_allauth/browser/v1/auth/{signup,login,session}`, `/_allauth/browser/v1/auth/provider/redirect` (Google), plus email verification and password reset.

| Method | Path | Purpose |
|---|---|---|
| GET / PATCH | `/api/me` | Profile (username, display name) |
| GET / POST | `/api/trips` | List my trips / create a draft |
| GET / PATCH / DELETE | `/api/trips/{id}` | Detail; edit title, description, cover, visibility, privacy_zone_m, camera_offset_s. Changing the offset → `match_photos`; changing the zone → `build_public_track` |
| POST | `/api/trips/{id}/gpx` | Multipart GPX upload → `202`, `status=processing` (ADR-5) |
| GET | `/api/trips/{id}/track` | Owner view: simplified GeoJSON + profile + segment breaks |
| POST | `/api/trips/{id}/share-token/rotate` | New Link token |
| POST | `/api/trips/{id}/photos/presign` | Body `[{filename, content_type, bytes}]` (≤ 50 per call) → `[{photo_id, put_url, headers}]`. Returns `409 quota_exceeded` if the estimated stored size (~5% of upload size) would go over the quota |
| POST | `/api/trips/{id}/photos/bulk` | Body `{photo_ids \| "all", is_public}`: show or hide many photos at once |
| POST | `/api/photos/{id}/complete` | Client finished its PUT → enqueue `process_photo` |
| GET | `/api/trips/{id}/photos` | Photos with presigned thumb/web URLs and placement |
| PATCH / DELETE | `/api/photos/{id}` | Caption, is_public, order, manual `location` or `route_fraction` |
| GET / POST | `/api/trips/{id}/highlights` | List / create |
| PATCH / DELETE | `/api/highlights/{id}` | Edit / remove |
| POST | `/api/trips/{id}/highlights/order` | Reorder the story (`ids`: every highlight once) |
| GET | `/api/public/u/{username}/{slug}?k=` | Public story payload (§8) |

**Non-API Django routes:** `GET /u/{username}/{slug}` (SPA shell + meta tags), `GET /og/{trip_id}.png` (302 redirect to a fresh presigned URL of the latest OG image).

**Limits (DRF throttles):** login/signup 10/min per IP, presign 20/min per user, comments 10/min per user (v1.1). Upload limits: GPX 20 MB / 200k points, photos 25 MB, 300 per trip.

**Later:** `chapters`, `places`, `comments`, `likes`, `budget-items`, `transport-legs`, `story-card` (v1.1); `members`, `invites`, `/api/me/stats`, `/api/me/badges`, `/api/explore?lat&lng&radius_km` (v1.2).

## 10. Frontend

**Routes:** `/` landing (a demo trip playing the flythrough as the hero) · `/login` · `/signup` · `/trips` my trips · `/trips/new` upload wizard (GPX → photos → offset check) · `/trips/:id/edit` editor · `/u/:user/:slug` story · `/u/:user` profile (v1.1) · `/explore` (v1.2).

**Look & feel: a travel journal on a map** (revised 2026-11-23 so the site suits any trip, not only treks; ADR-33, replacing the outdoorsy palette of ADR-27)
- **Palette:** cool map-paper `#F4F6F9` background, white cards, atlas blue `#2449C8` for actions, links and the route's start, highlighter raspberry `#E33A6E` for the route, your place on it and progress (`#A9184B` for raspberry text), ink `#131C2E` / muted `#556074` text, wash `#E7EDF6` for tinted surfaces. Every text pair passes WCAG AA. Map and chart colours come from `lib/palette.ts`.
- **Any kind of trip:** copy says "trip", not "trek". Climb and highest point show only for hilly trips (≥ 150 m of climbing); otherwise distance, time and average speed lead. Story stops can be a sight, viewpoint, food & drink, stay, camp, summit or other.
- **Type:** Plus Jakarta Sans throughout, sentence-case labels, tabular numbers for stats.
- **Signature:** the 3D map itself (ADR-31). The landing hero is a live, slowly turning map of a real sample trip (a trek, labelled as an example); the trip page opens on a full-width map. A small elevation ridge closes each hilly trip's card (ADR-30). Topographic contour lines stay as the texture behind the map's loading state and the auth card.
- **Trip page:** a full-width map nearly a screen tall. A frosted panel over it holds the title, dates, distance / time (and climb, for hilly trips) in large numerals, and the trip controls; on phones that panel sits above the map. Photos run along the map's bottom edge in route order (hover one to see where it was taken). The elevation chart and the times sit in a band under the map. Terrain base map by default: a light base with the land tinted by height and multi-direction shading (Satellite, Topo and Dark one click away, all keyless; ADR-36).
- **Motion:** respects `prefers-reduced-motion`. **Accessibility:** visible focus rings, keyboard-operable player, menu and dialogs, AA contrast.

**Flythrough:** precompute the route length with Turf. On each `requestAnimationFrame`, move the distance d forward by speed × Δt, find the point at d (`along`) and a look-ahead point ~300 m further, and set the camera with `FreeCameraOptions` (position behind and above, bearing toward the look-ahead point). Photos or highlights whose `route_fraction` is crossed open in a side card. The flythrough pauses while the tab is hidden.

**Editor:** a split view with the map and chart on one side and a tabbed panel on the other (Details · Photos · Highlights · Privacy). The privacy tab previews the trimmed route live. The offset tool shows a photo next to its matched position with a ± minutes/hours slider.

## 11. Non-functional requirements

| Area | Target |
|---|---|
| GPX processing | 10,000-point track processed in < 3 s by the worker |
| Story page | LCP < 2.5 s on simulated 4G mid-range phone; Lighthouse performance ≥ 80 on mobile |
| Flythrough | ≥ 30 fps on a mid-range Android (measured, in README) |
| Bundle | Map and chart code lazy-loaded; landing JS < 150 KB gz before MapLibre |
| Security | CSRF on unsafe methods, ownership checks on every object, presigned PUT signs content type + length, file type checked by magic bytes, Markdown sanitised (no raw HTML), secrets only in `.env` |
| Reliability | Jobs are idempotent (safe to retry); failed jobs leave a readable error on the trip/photo. A periodic sweep (Celery beat, every 10 min) re-queues trips/photos stuck in `processing` for > 15 min and deletes `pending` uploads older than 24 h |
| Memory | Dev: only postgis/redis/SeaweedFS in Docker; worker runs with `--concurrency=2`. Prod: worker `--concurrency=1` on a 512 MB machine (HEIC decoding is the peak) |

## 12. Testing

- **Backend (pytest):** unit tests for haversine, smoothing, moving time and simplification counts on fixture GPX files (a real trek, a file with multiple segments, a file with no elevation, a broken file). Tests for timezone/offset matching edge cases (DST, missing offset, outside the track's time range), privacy trimming, the visibility/404 rules, quota checks, the original being deleted after processing, the bulk show/hide action, and permission tests for every endpoint. Celery runs in eager mode in tests.
- **Frontend (Vitest + RTL):** chart↔map sync state, player controls, editor forms, and flythrough maths (pure functions).
- **E2E (Playwright, one test, v1.0.1):** sign up → create trip → upload GPX + 3 photos → wait for ready → set visibility to Link → open the share URL logged out → play the flythrough. Until then, this flow is checked by hand after each milestone.
- **CI (GitHub Actions):** ruff, black --check, eslint, prettier --check, pytest (PostGIS service container), vitest, build. Playwright is added to PRs to `main` in v1.0.1.
- **MVP test focus:** backend tests cover the logic that's easy to get wrong (stats, smoothing, time matching, privacy trimming, visibility/404, permissions, quota). Frontend tests cover the flythrough and sync maths. UI components get tests in v1.0.1.

## 13. Metrics (for README and resume)

GPX processing time and points removed by simplification · photo placement error (time-match vs. EXIF GPS, median and p90 in metres) · raw vs. smoothed elevation gain · flythrough fps on a phone · Lighthouse scores · users, trips created and share-page views (counted server-side in the share-page view).

## 14. Milestones

Claude writes most of the code; you review each piece, test it with your own GPX files and photos, and handle account setup. Each milestone ends in a working, committed state on its own branch.

| Milestone | Scope | Done when |
|---|---|---|
| **Accounts** (you, ~1 h) | GitHub repo, Fly.io (card + spending alert), Neon (enable PostGIS), Cloudflare R2 (bucket + API token + CORS), MapTiler key. Gather 1–2 real GPX files with matching photos | All keys are in a local `.env` |
| **Tracks & 3D map** ✅ | Repo, Compose (postgis/redis/SeaweedFS), CI, lint/format. Django + DRF + GeoDjango, email auth, Trip CRUD, GPX upload, `process_gpx` (stats, smoothing, simplify, profile). React app, 3D terrain map with route, elevation chart synced both ways, style switcher, light outdoorsy design | A real trek GPX shows the correct route, stats and synced chart on 3D terrain |
| **Photos & flythrough** (photos ✅, flythrough ✅) | Presigned photo uploads + quota, `process_photo` (EXIF → DB, WebP copies, delete original), placement (EXIF → time-match → manual), camera-offset slider, photo markers + clusters + lightbox, flythrough with photo pop-ups | Photos from a real trip land in the right places and pop up during the flythrough |
| **Story, sharing & deploy** (story ✅, sharing ✅, deploy next) | Story editor (simple form), highlights, Show all / Hide all, share token, privacy zones (`build_public_track`), share page + meta tags + OG image, deploy to Fly, smoke test on a phone, README (screenshots, GIF, metrics) | A share link from the live URL previews on WhatsApp and replays the trek on a phone |
| **v1.0.1** | Google sign-in, journal bodies, Playwright E2E, editor polish, demo video, onboard the trek club, real-usage metrics | — |

**If behind schedule, cut in this order:** OG image (fall back to the cover photo as `og:image`) → manual drag placement (keep the offset slider) → photo clusters → style switcher (keep one style). **Never cut** privacy (F11), visibility/404 rules, or the deploy.

**Branches:** `feat/tracks-and-map`, `feat/photos`, `feat/story-and-sharing`, each merged to `main` when its milestone is done (commits only with your OK).

## 15. Deviations from `traillog-prompt.md`

1. Link-visibility trips add `?k=<token>` to the share URL (§8, ADR-13).
2. Added to the MVP: style switcher, clusters + lightbox, 3-level visibility (journal entries planned, moved to v1.0.1).
3. `Trip` gains `kind`, `visibility` (replaces a boolean), `share_token`, `timezone`, `camera_offset_s`. `Track` gains `public_geom`, `public_profile` and `start_point`.
4. Chart library fixed as uPlot (the prompt allowed Recharts or uPlot).
5. A minimal profile page `/u/<user>` (v1.1) was added because Public trips are listed there. There's still no follow system.
6. Hosting moved from Render + Upstash to **Fly.io + a self-hosted Redis container** (Render has no free background worker; ADR-18).
7. Photo originals are **not stored**. Only EXIF-free derived copies are kept, under a per-user quota (ADR-21).
8. **Shorter MVP timeline than the prompt's 4 weeks.** Moved to v1.0.1: Google sign-in, journal bodies, the Playwright E2E test, editor autosave/polish, the demo video, and onboarding real users.

## 16. Open items (need you, not decisions)

- **Google OAuth client (v1.0.1):** create one in Google Cloud Console (localhost + prod redirect URIs) when you add Google sign-in.
- **Accounts:** see §14. Missing keys would block the deploy.
- **MapTiler key:** a free account; restrict the key to the app's domains.
- **Domain:** `traillog.app` costs money. Until then, use the `*.fly.dev` URL and update the meta tags when the domain changes.
- **Fly.io billing:** needs a card on file. It's pay-as-you-go with no permanent free tier: three small machines (web, worker, Redis) plus a 1 GB volume are expected to cost a few dollars a month. Check current prices at fly.io/pricing and set a spending alert before deploying.
- **Spike with the photo milestone:** confirm that R2 rejects a presigned PUT whose `Content-Length` doesn't match the signed value (ADR-4). If it doesn't, check the size with HEAD in `/complete` and reject.
