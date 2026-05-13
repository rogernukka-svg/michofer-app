import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Driver() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(false)

  useEffect(() => {
    initDriver()
  }, [])

  async function initDriver() {
    setLoading(true)

    const { data: authData } = await supabase.auth.getUser()
    const currentUser = authData?.user || null

    if (!currentUser) {
      window.location.href = '/login'
      return
    }

    setUser(currentUser)

    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle()

    if (!profileData) {
      window.location.href = '/registro'
      return
    }

    if (profileData.role !== 'driver') {
      window.location.href = '/client'
      return
    }

    setProfile(profileData)

    const { data: driverData } = await supabase
      .from('driver_profiles')
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle()

    setOnline(driverData?.is_online || false)
    setLoading(false)
  }

  async function toggleOnline() {
    if (!user || !profile) return

    const nextOnline = !online
    setOnline(nextOnline)

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await supabase.from('driver_profiles').upsert(
          {
            user_id: user.id,
            full_name: profile.full_name,
            avatar_url: profile.avatar_url,
            gender: profile.gender || null,
            women_mode: profile.gender === 'female' || profile.gender === 'mujer',
            is_online: nextOnline,
            is_available: nextOnline,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            rating: 5,
            verified: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
      },
      async () => {
        await supabase.from('driver_profiles').upsert(
          {
            user_id: user.id,
            full_name: profile.full_name,
            avatar_url: profile.avatar_url,
            is_online: nextOnline,
            is_available: nextOnline,
            rating: 5,
            verified: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
      }
    )
  }

  async function logout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  if (loading) {
    return (
      <div className="page">
        <div className="card">
          <h1>Verificando chofer...</h1>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="card">
        <h1>Panel Chofer</h1>

        <div className="driver-box">
          <h3>Chofer</h3>
          <p>{profile?.full_name || 'MiChofer'}</p>
        </div>

        <div className="driver-box">
          <h3>Estado</h3>
          <p>{online ? 'Disponible y visible para pasajeros' : 'Fuera de línea'}</p>
        </div>

        <div className="driver-box">
          <h3>Ganancias hoy</h3>
          <p>0 Gs.</p>
        </div>

        <button onClick={toggleOnline}>
          {online ? 'Dejar de recibir viajes' : 'Comenzar viajes'}
        </button>

        <button onClick={logout} style={{ marginTop: 12 }}>
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}