export type Visibility = 'private' | 'link' | 'public'
export type TripStatus = 'draft' | 'processing' | 'ready' | 'failed'

export interface TripStats {
  distance_m: number
  gain_m: number | null
  loss_m: number | null
  raw_gain_m: number | null
  max_ele_m: number | null
  min_ele_m: number | null
  total_s: number | null
  moving_s: number | null
  pace_s_per_km: number | null
  avg_moving_speed_kmh: number | null
  points_raw: number
  points_simplified: number
  segments: number
  has_elevation: boolean
  has_time: boolean
}

export interface Trip {
  id: string
  kind: 'gpx' | 'travel'
  title: string
  slug: string
  description: string
  visibility: Visibility
  share_token: string
  status: TripStatus
  error: string
  stats: Partial<TripStats>
  timezone: string
  camera_offset_s: number
  privacy_zone_m: number
  start_date: string | null
  end_date: string | null
  has_track: boolean
  track_updated_at: string | null
  /** Small [lng, lat] outline for trip cards */
  preview: [number, number][]
  /** <= 48 elevations (m), start to finish, for small ridge drawings */
  elevation_preview: number[]
  photo_count: number
  /** Web-size copy of the trip's first photo, for its card. */
  cover_url: string | null
  created_at: string
  updated_at: string
}

/** One chart sample: [distance_m, elevation_m, epoch_s, lng, lat] */
export type ProfileRow = [number, number | null, number | null, number, number]

export interface TrackData {
  geometry: { type: 'LineString'; coordinates: [number, number, number][] }
  bbox: [number, number, number, number]
  profile: ProfileRow[]
  waypoints: { name: string; lat: number; lon: number; ele: number | null }[]
}

export interface Me {
  id: string
  username: string
  email: string
  display_name: string
  storage_used_bytes: number
  storage_quota_bytes: number
}

export interface Page<T> {
  next: string | null
  previous: string | null
  results: T[]
}

export type PhotoStatus = 'pending' | 'ready' | 'failed'
export type Placement = 'exif' | 'time' | 'manual' | 'unplaced'

export interface Photo {
  id: string
  filename: string
  status: PhotoStatus
  error: string
  /** Short-lived signed URLs of the EXIF-free WebP copies */
  thumb_url: string | null
  web_url: string | null
  width: number | null
  height: number | null
  taken_at: string | null
  /** [lng, lat, ele] */
  location: [number, number, number] | null
  placement: Placement
  /** Position along the route, 0..1 */
  route_fraction: number | null
  caption: string
  is_public: boolean
  order: number
  /** The story stop this photo belongs to, if any */
  highlight: string | null
  stored_bytes: number
  created_at: string
}

export interface PresignedUpload {
  photo_id: string
  filename: string
  put_url: string
  headers: Record<string, string>
}

export type HighlightKind = 'sight' | 'viewpoint' | 'food' | 'stay' | 'camp' | 'summit' | 'other'

/** One stop in a trip's story: a titled note with the photos taken there. */
export interface Highlight {
  id: string
  kind: HighlightKind
  label: string
  body: string
  order: number
  /** In route order */
  photo_ids: string[]
  /** Middle of its placed photos along the route, or null if none are placed */
  route_fraction: number | null
}

export interface HighlightInput {
  kind: HighlightKind
  label: string
  body: string
  photo_ids: string[]
}

/** What a share page receives (GET /api/public/u/<user>/<slug>): privacy-trimmed, no EXIF. */
export interface PublicTrip {
  trip: {
    id: string
    title: string
    slug: string
    description: string
    visibility: Visibility
    owner: { username: string; display_name: string }
    start_date: string | null
    end_date: string | null
    timezone: string
    stats: Partial<TripStats>
    privacy_zone_m: number
    cover_url: string | null
  }
  /** Null when the route is shorter than both privacy zones together. */
  track: TrackData | null
  photos: PublicPhoto[]
  highlights: Highlight[]
}

export type PublicPhoto = Pick<
  Photo,
  | 'id'
  | 'thumb_url'
  | 'web_url'
  | 'width'
  | 'height'
  | 'caption'
  | 'taken_at'
  | 'location'
  | 'route_fraction'
  | 'highlight'
>

/** Lifetime numbers across a user's ready trips (GET /api/trips/totals). */
export interface Totals {
  trips: number
  distance_m: number
  gain_m: number
  highest_m: number | null
  days: number
  photos: number
}
