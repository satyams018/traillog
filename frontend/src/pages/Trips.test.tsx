import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Trips from './Trips'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/trips']}>
        <Routes>
          <Route path="/trips" element={<Trips />} />
          <Route path="/trips/:id" element={<p>Trip page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('New trip button', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.cookie = 'csrftoken=test-token'
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/trips' && init?.method === 'POST') {
        return json({ id: 'new-id', title: JSON.parse(String(init.body)).title }, 201)
      }
      return json({ next: null, previous: null, results: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('is clickable with an empty name and explains what is needed', async () => {
    renderPage()
    const button = screen.getByRole('button', { name: 'New trip' })
    expect(button).toBeEnabled()

    fireEvent.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent('Give your trip a name first')
    expect(screen.getByLabelText('New trip name')).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/trips',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('creates the trip and opens it when a name is given', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('New trip name'), {
      target: { value: '  Hampta Pass  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'New trip' }))

    expect(await screen.findByText('Trip page')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ title: 'Hampta Pass' })
  })

  it('shows a message when the server is unreachable', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new TypeError('Failed to fetch')
      return json({ next: null, previous: null, results: [] })
    })
    renderPage()
    fireEvent.change(screen.getByLabelText('New trip name'), { target: { value: 'Kedarkantha' } })
    fireEvent.click(screen.getByRole('button', { name: 'New trip' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't create the trip"),
    )
  })
})
