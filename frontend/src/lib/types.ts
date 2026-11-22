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
