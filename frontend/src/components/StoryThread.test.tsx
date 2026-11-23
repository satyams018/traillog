import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { Highlight, Photo, Trip } from '../lib/types'
import StoryThread from './StoryThread'

beforeAll(() => {
  // jsdom has no IntersectionObserver; polaroids only need it to start developing.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})

const trip = {
  id: 't1',
  title: 'Hampta Pass',
  start_date: '2026-05-10',
  end_date: '2026-05-11',
  timezone: 'Asia/Kolkata',
  stats: { distance_m: 28226, gain_m: 1580 },
  elevation_preview: [3000, 3500, 4270, 3800],
} as unknown as Trip

const photo = (id: string, fraction: number): Photo =>
  ({
    id,
    filename: `${id}.jpg`,
    status: 'ready',
    thumb_url: `/t/${id}`,
    web_url: `/w/${id}`,
    taken_at: '2026-05-10T03:05:00Z',
    route_fraction: fraction,
    caption: '',
    highlight: null,
  }) as unknown as Photo

const stop = (id: string, label: string, photoIds: string[]): Highlight => ({
  id,
  kind: 'camp',
  label,
  body: 'First night.\n\nChai at six.',
  order: 0,
  photo_ids: photoIds,
  route_fraction: 0.5,
})

function renderThread(highlights: Highlight[], onEdit = vi.fn()) {
  render(
    <StoryThread
      trip={trip}
      highlights={highlights}
      photos={[photo('a', 0.2), photo('b', 0.4), photo('c', 0.9)]}
      editing={null}
      saving={false}
      error=""
      onEdit={onEdit}
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onMove={vi.fn()}
      onOpenPhoto={vi.fn()}
      onShowOnMap={vi.fn()}
    />,
  )
  return onEdit
}

describe('StoryThread', () => {
  it('invites the owner to add a first stop when the story is empty', () => {
    const onEdit = renderThread([])
    fireEvent.click(screen.getByRole('button', { name: /add the first stop/i }))
    expect(onEdit).toHaveBeenCalledWith('new')
  })

  it('threads stops from start to finish with their photos as polaroids', () => {
    renderThread([stop('s1', 'Jwara camp', ['a', 'b']), stop('s2', 'Hampta Pass', ['c'])])
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['Jwara camp', 'Hampta Pass'])

    const first = document.getElementById('stop-s1')!
    expect(within(first).getAllByRole('button', { name: /^open/i })).toHaveLength(2)
    // Two paragraphs from the blank line in the notes, and a caption from the photo's time.
    expect(within(first).getByText('Chai at six.')).toBeTruthy()
    expect(within(first).getAllByText(/10 May/)).toHaveLength(2)

    expect(screen.getByText('Start')).toBeTruthy()
    expect(screen.getByText('Finish')).toBeTruthy()
  })
})
