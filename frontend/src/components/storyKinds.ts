import { BedDouble, Eye, Landmark, MapPin, Mountain, Tent, UtensilsCrossed } from 'lucide-react'

import type { HighlightKind } from '../lib/types'

/** Names and icons of the kinds of story stop, in the order the editor offers them. */
export const KIND: Record<HighlightKind, { label: string; icon: typeof MapPin }> = {
  sight: { label: 'Sight', icon: Landmark },
  viewpoint: { label: 'Viewpoint', icon: Eye },
  food: { label: 'Food & drink', icon: UtensilsCrossed },
  stay: { label: 'Stay', icon: BedDouble },
  camp: { label: 'Camp', icon: Tent },
  summit: { label: 'Summit', icon: Mountain },
  other: { label: 'Other', icon: MapPin },
}
