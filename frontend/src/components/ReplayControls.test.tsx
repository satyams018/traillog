import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { Highlight } from '../lib/types'
import type { Replay } from '../lib/useReplay'
import { PlayButton, ReplayOverlay } from './ReplayControls'

beforeAll(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})

function fakeReplay(over: Partial<Replay> = {}): Replay {
  return {
    controllerRef: { current: null },
    playback: { fraction: 0.5, playing: true },
    active: true,
    speed: 1,
    stopCard: null,
    photoCard: null,
    onPlayback: vi.fn(),
    onReach: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setSpeed: vi.fn(),
    exit: vi.fn(),
    ...over,
  }
}

const stop: Highlight = {
  id: 's1',
  kind: 'food',
  label: 'Chai at the dhaba',
  body: '',
  order: 0,
  photo_ids: [],
  route_fraction: 0.4,
}

describe('replay controls', () => {
  it('starts a replay from the call to action', () => {
    const replay = fakeReplay({ active: false })
    render(<PlayButton replay={replay} />)
    fireEvent.click(screen.getByRole('button', { name: /play the trip/i }))
    expect(replay.play).toHaveBeenCalled()
  })

  it('shows progress, the stop just reached, and wires pause, speed, seek and close', () => {
    const replay = fakeReplay({ stopCard: { kind: 'stop', id: 's1', key: 1 } })
    render(<ReplayOverlay replay={replay} distanceM={10_000} photos={[]} highlights={[stop]} />)

    expect(screen.getByText('Chai at the dhaba')).toBeTruthy()
    expect(screen.getByText('Stop 1 of 1')).toBeTruthy()
    expect(screen.getByText('5.00 km')).toBeTruthy() // halfway along 10 km

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(replay.pause).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: '4×' }))
    expect(replay.setSpeed).toHaveBeenCalledWith(4)
    fireEvent.change(screen.getByRole('slider', { name: /position/i }), {
      target: { value: '250' },
    })
    expect(replay.seek).toHaveBeenCalledWith(0.25)
    fireEvent.click(screen.getByRole('button', { name: /close replay/i }))
    expect(replay.exit).toHaveBeenCalled()
  })

  it('renders nothing outside a replay', () => {
    const { container } = render(
      <ReplayOverlay replay={fakeReplay({ active: false })} photos={[]} />,
    )
    expect(container.innerHTML).toBe('')
  })
})
