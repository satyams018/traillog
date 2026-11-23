import { useEffect } from 'react'

const SITE = 'TrailLog'

/** Sets the browser tab title, e.g. "Hampta Pass · TrailLog". */
export function useDocumentTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : `${SITE}: turn your trip into a story`
  }, [title])
}
