import { useMemo } from 'react'
import TripChatModal from '../components/TripChatModal'

export default function Chat() {
  const tripId = useMemo(() => new URLSearchParams(window.location.search).get('trip'), [])

  return (
    <main className="app-shell">
      <section className="phone chat-phone">
        <TripChatModal tripId={tripId} pageMode open />
      </section>
    </main>
  )
}
