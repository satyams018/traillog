# Design decisions

A short log of key choices: what was decided, what else was considered, and the tradeoff. Each entry is written to be explainable in an interview. Status: all **Accepted** on 2026-11-22 unless noted otherwise.

---

## ADR-1: Django + DRF + GeoDjango backend, React + TS SPA frontend
- **Decision:** a Django backend with GeoDjango; a React + TypeScript + Vite frontend.
- **Alternatives:** Node (Express/NestJS + Prisma); Next.js full stack.
- **Why:** Python/Django is my strongest stack. GeoDjango gives PostGIS fields, spatial lookups and admin map widgets out of the box. The Python GPX/EXIF/image libraries (`gpxpy`, Pillow) are mature. Prisma has no native PostGIS types, so geo queries would be raw SQL.
- **Tradeoff:** the app uses two languages, and the share page needs special handling for meta tags (ADR-12).

## ADR-2: PostGIS instead of storing coordinates as JSON
- **Decision:** tracks are stored as `LineStringZ` and photos as `PointZ` in PostGIS.
- **Alternatives:** a JSON array of `[lng, lat, ele]` in a text/JSONB column; MongoDB with GeoJSON.
- **Why:** spatial indexes (GiST) make "trips near me" (`ST_DWithin`) fast. `ST_Simplify`, `ST_LineSubstring` (privacy zones) and `ST_LineLocatePoint` (a photo's position along the route) run inside the database instead of in hand-written Python. Geometry is also validated on insert.
- **Tradeoff:** PostGIS is a heavier dependency. Hosting needs PostGIS (Neon supports it), and CI needs a PostGIS container.

## ADR-3: Session-cookie auth instead of JWT
- **Decision:** Django sessions in httpOnly, Secure, SameSite=Lax cookies, plus a CSRF token. Login is handled by `django-allauth` in headless mode (email + Google).
- **Alternatives:** JWT (SimpleJWT) access + refresh tokens.
- **Why:** the SPA and API share one origin (ADR-12), so cookies just work. httpOnly cookies can't be read by injected JavaScript, while JWTs stored in localStorage can. Logout and "log out everywhere" are a simple row delete; with JWTs, revocation needs a denylist. allauth's headless mode gives tested email verification, password reset and Google OAuth.
- **Tradeoff:** CSRF protection must be set up properly. It also ties the frontend to the same site, so a future mobile app would need token auth (allauth headless supports that too).

## ADR-4: Presigned direct uploads for photos
- **Decision:** the browser PUTs photos straight to R2 (SeaweedFS locally) using presigned URLs from Django, then calls `/complete`.
- **Alternatives:** multipart upload through Django; presigned POST policies.
- **Why:** 300 photos × ~8 MB passing through a 512 MB web machine would tie up workers and use too much memory and bandwidth. With direct upload, Django only signs URLs. **R2 doesn't support presigned POST policies**, so file size can't be capped by a policy. Instead, the presigned PUT signs `Content-Type` and `Content-Length` (the request fails if they don't match). The worker then checks the size and the file's magic bytes before using it.
- **Tradeoff:** more moving parts (the upload has three steps, and files that are signed but never uploaded need cleanup: the periodic sweep deletes `pending` photos older than 24 h). Storage needs CORS configured for PUT from the app's origin.
- **To verify (spike during the photo upload work):** that R2 really rejects a PUT whose `Content-Length` differs from the signed value. The fallback is a HEAD check in `/complete`.

## ADR-5: GPX upload goes through Django
- **Decision:** the GPX file is uploaded as multipart to Django (≤ 20 MB), stored, and then a job is enqueued.
- **Alternatives:** presigned upload like photos.
- **Why:** it's one small file per trip, and validating it right away (extension, size, XML root) gives instant error messages. That's simpler than a three-step flow.
- **Tradeoff:** a 20 MB request briefly uses a web worker, which is acceptable at this scale.

## ADR-6: Background jobs (Celery + Redis); the API returns `processing`
- **Decision:** GPX parsing, photo processing, time-matching, public-track building and OG image rendering run in Celery. Endpoints return `202` and the trip/photo status changes from `processing` to `ready` or `failed`.
- **Alternatives:** processing inside the request; Django-Q/RQ; Postgres-based queues (Procrastinate).
- **Why:** a 100k-point GPX or 300 HEIC conversions can take minutes. Doing that inside a request would block a gunicorn worker the whole time and fail when the user's mobile connection drops. Celery can retry failed jobs, rate-limit and use time limits, and it's widely known (useful for interviews). Redis also works as a cache.
- **Tradeoff:** one more process to deploy and watch (the Fly `worker` process group), and Redis is required. Jobs must be idempotent (safe to run twice).

## ADR-7: Placing photos by timestamp, with timezone and camera-clock offset
- **Decision:** order of placement: EXIF GPS → time-match → manual. EXIF times are usually local and have no timezone, so the time is converted using `OffsetTimeOriginal` if present, otherwise the trip timezone (from the start point via `timezonefinder`). Then the user's `camera_offset_s` is added and the position is interpolated between the two surrounding track points.
- **Alternatives:** assume the EXIF time is UTC (wrong by 5 h 30 m in India); ask the user for the timezone; snap to the nearest point instead of interpolating.
- **Why:** GPX times are always UTC, while camera clocks are local and often a few minutes or a whole timezone off. A slider with a live preview lets the user fix every photo at once. Interpolation adds accuracy when points are far apart (phones often log every 5–10 s). Manual placements are never overwritten.
- **Tradeoff:** photos from several cameras with different clock errors need one offset each. MVP has one offset per trip; per-camera offsets (grouped by EXIF `Model`) are a possible later improvement.

## ADR-8: Smoothing elevation before computing gain
- **Decision:** fill gaps → 5-point median filter → count gain/loss only when elevation moves ≥ 5 m from the last reference (hysteresis). Raw gain is stored too.
- **Alternatives:** raw sum; moving average; correcting with a DEM (look up each point's elevation from terrain data).
- **Why:** GPS altitude jitters ±5–15 m between points, and summing every small up-and-down overstates gain (often by 30–50%) on long, flat-ish tracks. The median filter removes spikes; the hysteresis threshold ignores the leftover noise. Storing both values gives a README metric ("raw 1,840 m → smoothed 1,210 m").
- **Tradeoff:** the 5 m threshold is a tuned constant and can slightly underestimate real rolling terrain. DEM correction would be more accurate but needs a terrain lookup for every point (possible later work).

## ADR-9: Douglas–Peucker simplification in a metric projection; full track kept
- **Decision:** simplify in EPSG:3857 with a ~5 m tolerance (corrected for latitude) for display. Stats use the full geometry.
- **Alternatives:** simplify in degrees (4326); simplify in the browser (Turf / simplify-js); Visvalingam.
- **Why:** a tolerance in degrees means different distances at different latitudes. 5 m is invisible at trek zoom levels and usually removes 70–90% of the points, which means smaller payloads and faster rendering on phones. Stats must use the full data, or distance and gain come out too low.
- **Tradeoff:** two geometries are stored per track (more storage, trivial at this scale).

## ADR-10: Privacy by design — EXIF stripping, privacy zones, private by default
- **Decision:** the only image files ever served are re-encoded WebP copies with no metadata (originals aren't kept at all, see ADR-21). Privacy zones (default 300 m) cut both ends of the public route in a precomputed `public_geom`. New trips are private.
- **Alternatives:** strip EXIF in place on the original; trim the route in the browser; zones around a user-chosen point (like Strava).
- **Why:** photo EXIF and route start points can reveal a home or hostel address. Precomputing on the server means the raw data never reaches a public client (trimming in the browser would still ship the full route). The EXIF fields needed for placement are saved in the database (not exposed publicly), so settings like the camera offset can change later without the original file.
- **Tradeoff:** the 300 m default hides a little of the route even for trailheads. Users can set 0 if they want.

## ADR-11: MapLibre + open terrain tiles instead of Cesium or Mapbox
- **Decision:** MapLibre GL JS for rendering, AWS Terrain Tiles (Terrarium encoding) for 3D terrain, MapTiler for base styles.
- **Alternatives:** Mapbox GL JS v2+ (proprietary licence, billed per map load); CesiumJS (a true 3D globe, much heavier bundle, Ion token).
- **Why:** MapLibre is open source (BSD), WebGL-based and supports 3D terrain and free-camera control for the flythrough. Terrain tiles are free with no key. The bundle is much smaller than Cesium's, which matters for the phone fps target.
- **Tradeoff:** no built-in 3D buildings or globe-scale imagery like Cesium. Terrain resolution is coarse in some Himalayan areas.

## ADR-12: SPA + server-rendered meta tags instead of full SSR (Next.js)
- **Decision:** Django serves the SPA's `index.html` for `/u/<user>/<slug>` with OG/Twitter meta tags filled in. The page then renders on the client.
- **Alternatives:** Next.js SSR; prerendering; a separate static host for the SPA.
- **Why:** WhatsApp and Instagram crawlers only read the `<head>` meta tags and don't run JavaScript, so server-filled tags are enough for good link previews. The story page is a WebGL map, which can't be server-rendered anyway. This keeps one backend, one deploy and same-origin cookies (ADR-3).
- **Tradeoff:** weaker SEO for the story text, since crawlers see only the meta description. That's acceptable; see the non-goals.

## ADR-13: Link visibility uses a share token
- **Decision:** three visibility levels. Link trips need `?k=<22-char token>`, which can be rotated. Unauthorised access returns 404.
- **Alternatives:** a boolean public flag; using the slug alone as the "secret"; a separate `/t/<token>` URL.
- **Why:** slugs like `kedarkantha-2026` are easy to guess, so "unlisted" needs a secret. Rotating the token revokes leaked links. Returning 404 (not 403) means outsiders can't tell whether a trip exists. The same `/u/<user>/<slug>` path is kept so changing visibility doesn't break the main URL.
- **Tradeoff:** Link URLs are longer and look less tidy.

## ADR-14: A private bucket with presigned GET, instead of a public bucket
- **Decision:** all objects are private. The API returns presigned GET URLs (1 h). `/og/<id>.png` redirects to a fresh presigned URL.
- **Alternatives:** a public-read `derived/` bucket behind a CDN domain.
- **Why:** if a photo is made private or deleted, a public bucket URL would keep working wherever it was shared. With presigned URLs, access is checked on every API call.
- **Tradeoff:** URLs change, so browser and CDN caching is weaker, and every image needs a signing call (cheap, local HMAC). If bandwidth becomes an issue, revisit by moving public derived files to a CDN path with unguessable keys.

## ADR-15: Preview images rendered with Pillow
- **Decision:** a Pillow composite of the blurred cover photo, the route polyline and the text.
- **Alternatives:** a headless browser screenshot of the 3D map (Playwright/Puppeteer); static-map tile APIs.
- **Why:** headless Chromium needs about 300+ MB of RAM per render, which doesn't fit a 512 MB worker machine that also decodes photos. Tile APIs cost money and add a key. Pillow is fast (< 1 s) and deterministic, and the same code makes the v1.1 story card.
- **Tradeoff:** the preview isn't a real terrain render, but a stylised route over the photo still looks good.

## ADR-16: uPlot for the elevation chart
- **Decision:** uPlot.
- **Alternatives:** Recharts (SVG, React-friendly); Chart.js.
- **Why:** it draws on canvas, the library is ~45 KB, and it handles thousands of points with 60 fps cursor sync. That matters while the map is also using the GPU during playback. Recharts renders SVG elements per point, which gets slow on phones with thousands of points (to measure, not assume, if this choice is questioned).
- **Tradeoff:** an imperative API, so it needs a small React wrapper. Styling is less declarative.

## ADR-17: MapTiler free tier for base maps
- **Decision:** MapTiler for satellite, topo and dark styles. The key is in `.env` and restricted to the app's domains.
- **Alternatives:** OpenFreeMap + Esri imagery (no key); Stadia Maps.
- **Why:** one provider and one key cover all three styles, with good India coverage and a free tier big enough for a portfolio app.
- **Tradeoff:** it's a vendor dependency with usage limits. The style URLs are kept in one config module so the provider can be swapped.

## ADR-18: Fly.io + self-hosted Redis + Neon + R2 for hosting
*(Revised 2026-11-22. The first draft chose Render + Upstash, but Render has no free background worker; its cheapest worker is about $7/month.)*
- **Decision:** one Fly.io app built from the project's Dockerfile, with two process groups: `web` (gunicorn) and `worker` (Celery worker + beat, `--concurrency=1`). A second small Fly app runs `redis:7-alpine` with a 1 GB volume (`appendonly yes`, password, reachable only on Fly's private network). Postgres is on Neon (PostGIS) and storage is on Cloudflare R2.
- **Alternatives:** Render (free web, but sleeps and the worker costs $7/month); Upstash Redis (managed, but billed per command, and an idle Celery worker sends commands non-stop); Fly Postgres (you manage it yourself); a single VPS.
- **Why:** the same Docker image and the same Redis image run locally (Compose) and in prod, so there are fewer "works on my machine" surprises. Process groups keep web and worker in one deploy. Running Redis as a container means no per-command billing. Neon gives managed Postgres with PostGIS for free. R2 has no egress fees, which matters for an image-heavy app.
- **Tradeoff:** Fly needs a card and is pay-as-you-go: a few dollars a month for three small machines, so set a spending alert. You run Redis yourself (backups don't matter much, since it only holds the job queue and cache, and the sweep re-queues lost jobs). It's more Docker/infra work than Render, which is also good interview material.

## ADR-19: Polling for processing status
- **Decision:** the SPA polls `GET /api/trips/{id}` every 2 s while the status is `processing`, stopping after 2 min.
- **Alternatives:** WebSockets (Django Channels); Server-Sent Events.
- **Why:** jobs take seconds, and only the owner waits on them. Polling needs no extra server (Channels needs ASGI and a channel layer). TanStack Query's `refetchInterval` is built in.
- **Tradeoff:** a few extra requests per upload. Revisit if real-time features (comments) need push updates.

## ADR-20: UUID primary keys
- **Decision:** UUIDv4 primary keys for user-facing models.
- **Alternatives:** auto-increment integers (+ a separate public id).
- **Why:** IDs in URLs can't be enumerated (`/api/photos/1, 2, 3…`), and the client can create them before upload if needed.
- **Tradeoff:** larger indexes and less readable IDs. Neither matters at this scale.

## ADR-21: Originals stay with the user; TrailLog stores only small copies under a quota
- **Decision:** after `process_photo` reads EXIF into the database and makes the `thumb` (400 px) and `web` (1600 px) WebP copies, the uploaded original is deleted. Each user has a 1 GB quota for stored copies (`storage_used_bytes` / `storage_quota_bytes`). The presign endpoint refuses uploads that would go over it.
- **Alternatives:** keep originals (a 300-photo trip is about 2.4 GB, so R2's 10 GB free tier fills after a few trips); pick photos from the user's Google Drive (extra OAuth work, and email-only users can't use it); link to Google Photos (its API now only gives access to picked items, through links that expire after about an hour, so share pages would break).
- **Why:** the user already has their originals on their phone or cloud. A share page only needs web-size images, at about 300 KB each, which is roughly 25 times less storage. Not keeping originals also means fewer copies of sensitive data to protect (ADR-10). Storage costs stay predictable per user.
- **Tradeoff:** there's no "download original" option, and a future bigger web size (e.g. for 4K screens) would need users to upload again. The quota needs a usage bar and a clear error.

## ADR-22: Tooling and versions
- **Decision:** Django 6.1 (the spec said 5; 6.x is current), React 19, Vite 8, Tailwind 4. The frontend linter is **oxlint** (Vite's default template) plus Prettier, not ESLint. Email verification is `optional` for now.
- **Alternatives:** pin to Django 5.2 LTS; ESLint + typescript-eslint; `mandatory` email verification.
- **Why:** starting on current majors avoids an upgrade later. oxlint is much faster and needs no config, and it covers the rules this project relies on. `mandatory` verification needs a real email provider in production, which isn't chosen yet. Until then emails go to the console, and a mandatory check would block every signup.
- **Tradeoff:** Django 6.1 isn't an LTS release, so the Django 6.2 LTS needs an upgrade when it lands. oxlint has fewer plugin rules than ESLint (e.g. no full `react-hooks` plugin). Before onboarding real users, choose an email provider (e.g. Resend or Brevo free tier) and switch verification to `mandatory`.

## ADR-23: Local storage is SeaweedFS (not MinIO); PostGIS image is `imresamu/postgis`
- **Decision:** Docker Compose runs SeaweedFS (`chrislusf/seaweedfs`, `server -s3`) as the local S3 stand-in for R2, and `imresamu/postgis:16-3.5` for PostGIS. A `manage.py ensure_bucket` command creates the bucket.
- **Alternatives:** MinIO (the spec's original choice); RustFS; Garage; LocalStack; the official `postgis/postgis` image.
- **Why:** MinIO no longer publishes Docker images (`docker pull minio/minio` fails), and the official PostGIS image has no native arm64 build, so it would run under emulation on the M1. SeaweedFS is mature (Apache-2.0), runs as one container and speaks the S3 API, so the app code is identical against R2. `imresamu/postgis` is maintained by the docker-postgis maintainer and is multi-arch. CI on Linux still uses `postgis/postgis`.
- **Tradeoff:** SeaweedFS has more knobs than MinIO. It pre-creates several volumes, so `-volume.max=20` with 64 MB volumes keeps disk use small while still allowing growth. Its bucket CORS support for presigned browser uploads gets checked when photo uploads are built; the fallback is proxying storage through Vite in dev.

## ADR-24: Bundling MapLibre's web worker
- **Decision:** in dev, `maplibre-gl` is excluded from Vite's dependency pre-bundling. In production builds, the worker is imported with `?worker&url` and passed to `setWorkerUrl()`.
- **Why:** MapLibre v6 builds its worker URL at runtime relative to its own module. Pre-bundling moves the module (which broke the worker in dev), and bundlers can't see a runtime-built URL (so production would request a worker file that was never emitted). Both problems were found by running the app and fixed this way. The production build was checked with `vite preview`.
- **Tradeoff:** two code paths (dev vs prod) for the worker. Both are verified manually now; the Playwright test (v1.0.1) should run against a production build to cover the prod path.

## ADR-25: Shared Redis cache (login rate limits)
- **Decision:** `CACHES` comes from `CACHE_URL`, which points to Redis (db 1) locally and in production. When it's unset (CI), it falls back to local memory.
- **Alternatives:** Django's default local-memory cache; a database cache.
- **Why:** allauth stores its login rate limits (5 failures per account per 5 min, 10 per IP per min) in the cache. A local-memory cache lives inside each process, so with several gunicorn workers an attacker gets the limit once per worker. Redis is already running for Celery.
- **Tradeoff:** if Redis is down, logins fail instead of silently losing rate limiting. That's acceptable, because Redis being down also stops the job queue.

## ADR-26: Map UX on the trip page
- **Decision:** `cooperativeGestures` is on: on phones one finger scrolls the page and two fingers move the map; on desktop Ctrl/⌘ + scroll zooms. The camera is fitted to the route's projected on-screen footprint (pan and zoom in pixels, three passes), rotated so the route's main direction runs across the wide map. The fit runs as soon as the terrain heights load, with a 6 s fallback. Keyless OpenFreeMap styles (dark by default) are used when there's no MapTiler key.
- **Alternatives:** `fitBounds` on the bounding box (leaves diagonal routes small); waiting for the map's `idle` event (about 20 s with a tilted view, since it waits for tiles out to the horizon); a full-screen map with no page scroll.
- **Why:** each choice fixes something found by running the app: a phone scroll trap, a route filling only a quarter of the map, a 20-second loading overlay, and a light map clashing with the dark design. Pixel-space fitting is needed because, with the map tilted, perspective makes latitude/longitude offsets non-linear.
- **Tradeoff:** desktop users need Ctrl/⌘ to zoom with the wheel (the page says so under the map). The fit math is custom code, so it's covered by the geometry unit tests and checked visually.

## ADR-27: Light, outdoorsy visual design (replaces the dark cinematic theme; palette replaced by ADR-33)
- **Decision:** a light theme: paper/white surfaces, forest-green primary, trail-orange route and accents, Plus Jakarta Sans, and generated topographic contour lines as the one signature visual. Design tokens live in `src/index.css` (`@theme`); shared button and field classes are in `components/ui.ts`.
- **Alternatives:** keep the dark theme with brighter text; light pages with only the map kept dark; a light/dark toggle.
- **Why:** user feedback was that the dark UI felt hard to read and too plain. A light theme raises contrast (body text 15:1, secondary text 5.7:1) and suits an outdoors product. Contour lines come from the subject itself (topo maps) rather than generic decoration, and the route's orange matches trail blazes, used the same way on cards and the 3D map.
- **Tradeoff:** a light map pulls attention less than a dark one; the Dark map style is still one click away. A dark mode can be added later because colours are centralised as tokens.

## ADR-28: Photo processing pipeline
- **Decision:** the browser PUTs each photo straight to the bucket using a presigned URL that signs `Content-Type` and `Content-Length`. `/complete` queues `process_photo`, which re-checks the size with HEAD, sniffs the magic bytes (JPEG / HEIC), reads EXIF with Pillow, writes 400 px and 1600 px WebP copies with no metadata, and deletes the original. The photo row is "claimed" with a conditional update (`status=pending → ready`), so a job delivered twice never counts the same bytes against the quota twice. Presign refuses a batch when `used + (pending + new uploads) × 5%` would exceed the quota, with the user row locked so parallel presigns can't both slip under it.
- **Alternatives:** upload through Django (simple, but every 25 MB photo would tie up a web worker and pass through the 512 MB machine); `exifread` for EXIF (SPEC §5 lists it); keeping originals (ADR-21 rules this out).
- **Why:** direct uploads keep the web process small. SeaweedFS was checked to reject a PUT whose type or size differs from the signed values (403), and the HEAD re-check covers any S3 provider that doesn't enforce it. Pillow already decodes the image, and its `getexif()` gives the GPS/time fields, so `exifread` would be a second parser for no gain. JPEG `draft()` decodes large photos at reduced scale, which matters on a 512 MB worker. `ensure_bucket` now sets the bucket CORS rule from `CSRF_TRUSTED_ORIGINS`, which resolves the open question in ADR-23.
- **Tradeoff:** the 5% stored-size estimate can be off for unusual images; the real size is charged after processing, so a user can end up slightly over quota but never far over it. The SPEC's periodic sweep (stuck or abandoned uploads) isn't built yet; abandoned pending uploads stop counting against the quota after 24 h.

## ADR-29: Re-matching photos synchronously when the camera offset changes
- **Decision:** `PATCH /api/trips/{id}` with a new `camera_offset_s` runs `match_photos` inside the request instead of queuing it.
- **Alternatives:** a Celery job (SPEC §6.3) with the client polling until positions change.
- **Why:** matching never opens a file: it reads the EXIF fields saved in the database and binary-searches the track's timestamps, which takes milliseconds even for 300 photos. Doing it inline means the slider's response already holds the new positions, so the UI updates in one round trip without polling. `match_photos` is still a Celery task and runs in the background when a new GPX track arrives.
- **Tradeoff:** a very large trip slows that one PATCH a little; if that ever matters it can go back to the queue without API changes.

## ADR-30: The trek's own elevation profile as the page horizon (mostly replaced by ADR-31)
- **Decision:** a `RidgeBand` component draws an elevation profile as a layered ridge under a glacier-blue sky: two softer back ranges, the real profile in forest green, and the trail in orange along its crest with a start dot and a finish flag. The landing hero uses a sample trek; each trip page uses that trip's profile, with the stats as one "summit board" standing on the ridge; the trips list uses all treks end to end, and every trip card ends in a small ridge of its own. `Trip.elevation_preview` (≤ 48 elevations) makes this possible without loading tracks. The trail draws itself once on page load; that is the only automatic motion, and it's skipped with reduced motion.
- **Alternatives:** stock mountain illustrations or photos; more cards, gradients and hover effects; a darker, more saturated theme.
- **Why:** user feedback was that the light theme felt dull. Most of the page was identical white cards, and nothing on screen came from the user's own trek. The ridge adds colour mass (sky and greens) and depth, and because it is the real climb, each trip looks different from the others. It reuses the existing palette and the map's sky colour, so the 3D map and the page match.
- **Tradeoff:** the ridge is decorative and hidden from screen readers (the numbers are in the stats board and chart). It is drawn in measured pixels via a `ResizeObserver` so strokes never stretch; the geometry lives in `lib/ridge.ts` with unit tests.

## ADR-31: Map-first layout (replaces ADR-30's page-wide ridges)
- **Decision:** the 3D map leads. The trip page opens on a full-width map nearly a screen tall, with the title, headline numbers and trip controls in a frosted panel over it (above it on phones), a strip of photos in route order along its bottom edge, and the elevation chart in a band below instead of on top of the map. The landing hero is a live, non-interactive map of the sample trek from `samples/demo-trek.gpx` that turns slowly (not with reduced motion). Trip cards use the first visible photo as a cover (`Trip.cover_url`) with the route as a small inset map. The large ridges and sky gradient are gone; only the small ridge on each trip card stays. Photo badges and menus in the grid appear on hover on devices that can hover, except "Hidden" and "Not on map", which need action.
- **Alternatives:** keep the ridge design and tune it; a photo-first "story" layout (cover photo, then the trek told in order); a static screenshot or video in the landing hero.
- **Why:** user feedback was that the UI still looked bad. The ridge appeared on every page as a heavy slab and read as decoration, while the 3D terrain map, the thing TrailLog actually does, was pushed below the fold and partly covered by the chart. A live map of a real trek shows the product instead of describing it and can't go stale like a screenshot. Photo-first was set aside because it depends on good photos; it can still shape the share page.
- **Tradeoff:** the landing page now downloads MapLibre and terrain tiles. The map, its code and the sample track (6.5 kB gzip) load in a lazy chunk after the text, so the main bundle is unchanged. The cover URL is one subquery on the trips list, not a query per trip.

## ADR-32: Story stops with many photos, threaded down the trip page
- **Decision:** a `Highlight` is one stop in an optional story: kind, title, plain-text notes and an `order`. Photos join a stop through a nullable `Photo.highlight` foreign key, so a stop can hold many photos and a photo belongs to at most one stop. A stop's place on the route is worked out from its photos (the middle of the placed ones) instead of being stored. New stops are slotted in after the last stop that comes before them on the route; the owner can then move stops up or down (`POST /highlights/order`). On the trip page the stops run down a dashed trail from Start to Finish. The trail fills in orange as you scroll, a stop's marker lights up when reached, and on wide screens a sticky rail shows the climb with a marker gliding to the stop being read. Photos are shown as polaroids with handwritten time captions (Caveat font) that "develop" from pale to full colour the first time they scroll into view. Reordering uses the View Transitions API so stops glide to their new places. Editing happens inline in the thread.
- **Alternatives:** SPEC's `Highlight.photo` (one optional photo per stop); a join table allowing a photo in several stops; storing `route_fraction` on the stop; drag-and-drop reordering; a separate editor page (SPEC's tabbed form).
- **Why:** the user asked for one stop to hold several photos, in a start-to-finish flow they control. A foreign key on `Photo` is simpler than a join table and matches how a story reads, since each photo appears once. A computed position stays right when photos are re-matched or moved by hand, with nothing to keep in sync. Scroll position is written straight to the DOM in a frame callback, so scrolling never re-renders React; only the index of the stop reached goes through state. Up/down moves in a menu are keyboard- and screen-reader-friendly; drag-and-drop can come later.
- **Tradeoff:** notes are plain paragraphs, not Markdown, until the journal work in v1.0.1. Reordering applies on screen at once and is confirmed by the server afterwards; on failure the list reloads. Browsers without View Transitions (and anyone with reduced motion) get an instant reorder, and reduced motion also skips the polaroid develop. The story code adds about 5 kB gzip to the main bundle.

## ADR-33: A travel-journal palette and wording for any kind of trip
- **Decision:** the site is for any trip, not only treks. Colours: cool map-paper `#F4F6F9`, ink-navy text `#131C2E`, atlas blue `#2449C8` for actions and the route's start, and highlighter raspberry `#E33A6E` for the route, your place on it and progress. Tokens are named by role (`brand`, `route`, `wash`, `muted`) instead of by theme (`forest`, `trail`, `lichen`, `moss`). JavaScript-side colours for MapLibre, uPlot and inline SVG come from one module, `lib/palette.ts`. Copy says "trip"; the logo is a dotted route ending at a map pin. Climb and highest point show only when a trip climbs at least 150 m (`isHilly`); otherwise distance, time and average speed lead, and flat trips get no elevation ridge. Story stops gain the types sight, food & drink and stay.
- **Alternatives:** keep the green/orange outdoors palette and only change the copy; a warm cream "travel magazine" look (the most common generated-design default); a separate theme per trip type; renaming the product.
- **Why:** user feedback was that the site read as a trekking log. Forest green and trail-blaze orange said "outdoors", and the numbers were all about climbing. Blue ink and a highlighter come from marking a route on a paper map, which fits any journey, and raspberry stands out on topo, satellite and dark maps alike. Showing climb only when there is one keeps a city walk from leading with "12 m climb". Role-based token names keep the code honest if the palette changes again.
- **Tradeoff:** the 150 m threshold is a judgement call: a hilly city can cross it, which is fine. The landing sample is still a trek, labelled as an example, until there's a good non-trek GPX to show. The product name still says "Trail".

## ADR-34: Share pages
- **Decision:** `/u/<user>/<slug>` serves the SPA with link-preview tags filled in by Django (ADR-12). The app loads the story from `/api/public/u/<user>/<slug>?k=`. Access: the owner always sees it (so they can preview a private trip); otherwise Public trips open for anyone, Link trips need the current `share_token` (checked in constant time), and everything else is the same 404 as a missing trip (ADR-13). The public payload is built by hand, not from the owner serializers: only shared photos, the privacy-trimmed route and profile (re-based to 0 km, no timestamps), photo and stop positions re-scaled to the trimmed line, no pin for photos inside a zone, photo times rounded to the minute, and no EXIF, email, token or point counts. The privacy zone is trimmed in Python by haversine distance. The 1200×630 preview image is drawn with Pillow the first time it's requested and stored under a fingerprint of what it shows. The owner manages it all in one Share dialog: who can see it, copy link, make a new link, privacy zone and preview.
- **Alternatives:** `ST_LineSubstring` in PostGIS (SPEC §6.4); rendering the preview image in a Celery job after every relevant change (SPEC §6.5, with `og_version`); reusing the owner's serializers with fields removed; a separate `/t/<token>` URL.
- **Why:** trimming in Python works on the simplified line the map already uses, keeps photo and stop fractions consistent, and is unit-testable without a database; it takes milliseconds, so it runs inside the request that changes the zone. A fingerprint key means a changed title, cover, route or stats always gets a new image URL, which matters because WhatsApp and Slack cache previews by URL. It also removes the need to hook every place that can change those things. A hand-built payload makes "what is public" one short, reviewable function instead of a list of fields to remember to exclude. Tests cover the 404 rules, token rotation, trimming, re-scaling and the absence of private fields.
- **Tradeoff:** the first preview request for a changed trip waits about 0.3 s while the image is drawn. Old preview images stay in storage until the trip is deleted. Share-page view counts (SPEC §13) aren't recorded yet. Locally, crawlers only see the tags from Django (port 8000) after `npm run build`; Vite serves the app without them.

## ADR-35: Flythrough replay and a livelier map (from a look at similar products)
- **Context:** a review of Relive, Strava (Flyover, 3D maps), Polarsteps (steps, Trip Reels), Komoot (tour pages) and FindPenguins (statistics) showed what users of this kind of product expect. Our biggest gaps were: no replay (their signature feature, and our own SPEC F7); photos shown only as plain dots; story stops missing from the map; a flat route line; no lifetime numbers; and no way for a visitor to pass a share page on.
- **Decision:** a flythrough built into `TripMap`, driven by `requestAnimationFrame`.
  - Each frame moves a distance along the route, places the camera there with `jumpTo` (tilted 64°, zoom chosen from the route length), and eases the heading toward a look-ahead point.
  - The route's `line-gradient` turns the untravelled part white. The replay holds 1.8 s on each photo, and the page shows a polaroid card for the photo and a title card for the stop.
  - A replay lasts about 45 s at 1×, whatever the route length.
  - The page gets progress about ten times a second through `onPlayback`, which drives the scrubber and the elevation chart's cursor. The camera never goes through React state.
  - Pages control it through an imperative handle (`play`, `pause`, `seek`, `setSpeed`, `exit`) wrapped in a `useReplay` hook, so the trip, share and landing pages share one implementation.
  - Moving the map by hand pauses the replay. At the end, the camera eases back to the overview.
- **Map changes:**
  - The route has a start-to-finish gradient (atlas blue to raspberry) and a blurred glow.
  - Each photo is a round, white-ringed thumbnail drawn on a canvas and registered as a map image, with the old dot as a fallback.
  - Story stops are dark pins with labels.
- **Alternatives:**
  - SPEC §10's `FreeCameraOptions` with Turf.js.
  - Recording a video server-side, as Relive does.
  - A fixed speed in km/h.
  - HTML markers for photos.
- **Why:**
  - `jumpTo` with centre, bearing and pitch is enough for a follow camera over terrain and avoids Turf. The geometry is small, pure and unit-tested (`lib/flythrough.ts`).
  - A fixed duration keeps a 3 km city walk and a 300 km road trip equally watchable.
  - Thumbnails as map images stay inside MapLibre's clustering and render in WebGL; hundreds of HTML markers would not.
  - An imperative handle avoids re-rendering the page 60 times a second.
- **Tradeoff:**
  - The ≥ 30 fps target on a mid-range Android phone (SPEC F7) hasn't been measured yet.
  - On phones the photo card is hidden during a replay so it doesn't cover the small map; stop titles still show.
  - Thumbnails need the bucket's CORS rule for GET, already set by `ensure_bucket`.
  - Lifetime totals come from a small `GET /api/trips/totals` endpoint, so they stay right beyond the first page of trips.

## ADR-36: A tinted terrain style and keyless satellite
- **Decision:** the default map style is now "Terrain":
  - OpenFreeMap's quiet Positron base.
  - A MapLibre `color-relief` layer tinting the land by height: green valleys, tan slopes, grey-brown rock, then snow.
  - A `multidirectional` hillshade lit from four directions.

  Both layers use the elevation tiles we already load, and both sit under water, roads and labels instead of on top of everything. "Satellite" no longer needs a key: it uses EOX's Sentinel-2 cloudless 2024 mosaic as an inline style, credited as required. A MapTiler key still swaps in MapTiler's sharper hybrid and outdoor styles. The "Light" style is replaced by Terrain. Every style gets the new shading, and terrain exaggeration goes from 1.3 to 1.4. Tuned by eye on the demo trek: an earthier ramp (a paler one washed everything above 3,000 m out to white), warm brown shadows, Positron's flat-white glacier fill made semi-transparent on Terrain so snowfields read as snow over relief, and photo clustering tightened (22 px radius, none above zoom 13) so photos show as thumbnails at normal zoom. Map and chart colours stay in `lib/palette.ts`; the height ramp is in `lib/mapStyles.ts`, with a test that its stops ascend.
- **Alternatives:**
  - MapTiler's outdoor and satellite styles (needs a key; the free plan is non-commercial and capped at about 5K sessions a month).
  - Esri World Imagery (sharper, but its terms are unclear without an ArcGIS account and key).
  - Stadia/Stamen terrain (needs an account in production).
  - Keeping a single north-west hillshade.
- **Why:** height tinting is what makes printed and outdoor maps read as terrain at a glance. Lighting from several directions keeps slopes that face the light from going flat. Neither needs a service or a key, so the look is the same for every visitor and in every deploy. A satellite view was the most-requested style in comparable products. Sentinel-2 is cloud-free, global and free for a non-commercial portfolio.
- **Tradeoff:**
  - Sentinel-2 is 10 m imagery: excellent for valleys and mountains at overview zoom, soft when zoomed into a town. The replay's follow camera stays around zoom 12–15, where it holds up.
  - A commercial deployment needs an EOX licence or a MapTiler key (set `VITE_MAPTILER_KEY`).
  - Positron's own land fills are pale, so the tint shows through; on Topo and Dark only the shading changes.

## ADR-37: Account self-service on allauth's headless API
- **Decision:** the SPA gets pages for:
  - forgot password (`/account/password/reset`)
  - choose a new password (`/account/password/reset/:key`)
  - confirm email (`/account/verify-email/:key`)
  - account settings (`/settings`: display name, email status with resend, change password, storage, delete account)

  The paths are the ones allauth already puts in its emails. The reset and email steps call allauth's headless endpoints directly. Deleting an account is our own `DELETE /api/me`: it asks for the password again, is limited to 5 tries a minute, logs out, deletes the user (trips, tracks, photos and stops go by CASCADE), and queues deletion of every stored file once the transaction commits. Email links are built from a `FRONTEND_URL` setting, not from the request's host.
- **Alternatives:**
  - allauth's own server-rendered account pages (a second look and feel, and they need the non-headless app).
  - Deleting accounts in an admin-only flow (users would have to email us).
  - Soft delete with a grace period.
  - Confirming the email automatically when the link opens.
- **Why:**
  - Without a reset page a forgotten password locks the user out for good.
  - A public site that stores people's photos and tracks should let them leave and take their data with them.
  - Reusing allauth keeps tokens, expiry, rate limits and the "don't reveal who has an account" behaviour in a well-tested library.
  - Confirming takes a click because mail scanners open links in emails and would otherwise confirm addresses nobody checked.
  - `FRONTEND_URL` is needed because the Vite dev proxy rewrites the Host header to the backend's port, and in production the API and the site could sit on different hosts.
- **Tradeoff:**
  - Deletion is immediate and final; there's no undo window. Files are removed by a retrying Celery job, so a storage outage delays it but doesn't stop it.
  - Old share-preview images (`og/…`) aren't deleted with the account yet; the same gap exists for trip deletion.
  - Email verification stays `optional` until a real email provider is set up for production; then it can become `mandatory`.
  - Changing the email address isn't offered yet. allauth supports it, but it needs a re-verification flow in the UI.
  - allauth's default email wording ("Hello from localhost:8000!") still needs TrailLog templates before launch.

