import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import logo from '../assets/logo.png'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const DEFAULT_CENTER = {
  lat: -25.5167,
  lng: -54.6167,
}

function distanceKm(a, b) {
  if (!a?.lat || !a?.lng || !b?.lat || !b?.lng) return null

  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function estimatePrice(km) {
  if (!km) return 18000
  const base = 9000
  const perKm = 4500
  return Math.max(12000, Math.round((base + km * perKm) / 500) * 500)
}

function formatGs(value) {
  return `${Number(value || 0).toLocaleString('es-PY')} Gs.`
}

export default function Client() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [avatarUrl, setAvatarUrl] = useState(
  localStorage.getItem('michofer_last_photo') || ''
)
  const [destination, setDestination] = useState('Shopping París, Ciudad del Este')
  const [mode, setMode] = useState('all')
  const [drivers, setDrivers] = useState([])
  const [selectedDriver, setSelectedDriver] = useState(null)
  const [clientLocation, setClientLocation] = useState(DEFAULT_CENTER)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [message, setMessage] = useState('')
  const [showProfile, setShowProfile] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [sheetCollapsed, setSheetCollapsed] = useState(false)
  const onlyWomenMode = mode === 'women'
function toggleSheet() {
  setSheetCollapsed((current) => !current)
}
  useEffect(() => {
    init()
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('drivers-realtime-client')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'driver_profiles',
        },
        () => {
          loadDrivers(clientLocation)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [clientLocation])

 async function init() {
  setLoading(true)

  const { data: authData } = await supabase.auth.getUser()
  const currentUser = authData?.user || null
  setUser(currentUser)

  if (currentUser) {
    let profileData = null

    const { data: profileById } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle()

    profileData = profileById

    if (!profileData && currentUser.email) {
      const { data: profileByEmail } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', currentUser.email)
        .maybeSingle()

      profileData = profileByEmail
    }

    if (profileData?.role === 'driver') {
  window.location.href = '/driver'
  return
}

setProfile(profileData)
const finalAvatar =
  profileData?.avatar_url ||
  currentUser?.user_metadata?.avatar_url ||
  localStorage.getItem('michofer_last_photo') ||
  ''

setAvatarUrl(finalAvatar)

if (finalAvatar) {
  localStorage.setItem('michofer_last_photo', finalAvatar)
}

    if (profileData?.avatar_url) {
      localStorage.setItem('michofer_last_photo', profileData.avatar_url)
    }
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const nextLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      }

      setClientLocation(nextLocation)
      await loadDrivers(nextLocation)
      setLoading(false)
    },
    async () => {
      setClientLocation(DEFAULT_CENTER)
      await loadDrivers(DEFAULT_CENTER)
      setLoading(false)
    },
    {
      enableHighAccuracy: true,
      timeout: 9000,
    }
  )
}

 async function loadDrivers(location = clientLocation) {
  const { data, error } = await supabase
    .from('driver_profiles')
    .select(`
      id,
      user_id,
      full_name,
      avatar_url,
      gender,
      women_mode,
      is_online,
      is_available,
      lat,
      lng,
      car_brand,
      car_model,
      car_color,
      plate,
      rating,
      total_trips,
      verified,
      updated_at
    `)
    .eq('is_available', true)
    .eq('is_online', true)

  const fallbackDrivers = [
    {
      id: 'demo-1',
      user_id: 'demo-1',
      full_name: 'Carlos Benítez',
      avatar_url: 'https://ui-avatars.com/api/?name=Carlos+Benitez&background=63c0ba&color=07110f',
      gender: 'male',
      women_mode: false,
      is_online: true,
      is_available: true,
      lat: location.lat + 0.003,
      lng: location.lng + 0.002,
      car_brand: 'Toyota',
      car_model: 'Prius',
      car_color: 'Blanco',
      rating: '4.98',
      verified: true,
    },
    {
      id: 'demo-2',
      user_id: 'demo-2',
      full_name: 'María López',
      avatar_url: 'https://ui-avatars.com/api/?name=Maria+Lopez&background=f7cddd&color=07110f',
      gender: 'female',
      women_mode: true,
      is_online: true,
      is_available: true,
      lat: location.lat - 0.002,
      lng: location.lng - 0.003,
      car_brand: 'Kia',
      car_model: 'Rio',
      car_color: 'Gris',
      rating: '4.95',
      verified: true,
    },
    {
      id: 'demo-3',
      user_id: 'demo-3',
      full_name: 'Javier Rojas',
      avatar_url: 'https://ui-avatars.com/api/?name=Javier+Rojas&background=111827&color=ffffff',
      gender: 'male',
      women_mode: false,
      is_online: true,
      is_available: true,
      lat: location.lat + 0.001,
      lng: location.lng - 0.004,
      car_brand: 'Hyundai',
      car_model: 'HB20',
      car_color: 'Negro',
      rating: '4.91',
      verified: true,
    },
  ]

  if (error) {
    console.error(error)
  }

  const source = error || !data?.length ? fallbackDrivers : data

  const normalized = source.map((driver) => {
    const km = distanceKm(location, {
      lat: Number(driver.lat),
      lng: Number(driver.lng),
    })

    const price = estimatePrice(km)

    return {
      ...driver,
      name: driver.full_name || 'Chofer MiChofer',
      avatar:
        driver.avatar_url ||
        'https://ui-avatars.com/api/?name=MiChofer&background=63c0ba&color=000',
      car:
        `${driver.car_brand || ''} ${driver.car_model || ''}`.trim() ||
        'Vehículo registrado',
      color: driver.car_color || 'Color no cargado',
      distanceKm: km,
      distance: km ? `${km.toFixed(1)} km` : 'Cerca',
      eta: km ? `${Math.max(2, Math.round(km * 3))} min` : '3 min',
      price,
    }
  })

  normalized.sort((a, b) => {
    const da = a.distanceKm ?? 999
    const db = b.distanceKm ?? 999
    return da - db
  })

  setMessage('')
setDrivers(normalized)
setSelectedDriver(null)
}

  const visibleDrivers = useMemo(() => {
    if (mode === 'women') {
      return drivers.filter(
        (driver) =>
          driver.women_mode === true ||
          driver.gender === 'female' ||
          driver.gender === 'mujer'
      )
    }

    return drivers
  }, [drivers, mode])

 useEffect(() => {
  if (!sheetCollapsed) return

  setSelectedDriver(null)
}, [sheetCollapsed])

useEffect(() => {
  if (!selectedDriver && visibleDrivers.length > 0) {
    return
  }

  if (
    selectedDriver &&
    !visibleDrivers.find((d) => d.id === selectedDriver.id)
  ) {
    setSelectedDriver(null)
  }
}, [mode, drivers])

  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${
    clientLocation.lng - 0.015
  }%2C${clientLocation.lat - 0.015}%2C${clientLocation.lng + 0.015}%2C${
    clientLocation.lat + 0.015
  }&layer=mapnik&marker=${clientLocation.lat}%2C${clientLocation.lng}`

  async function requestRide() {
    if (!user) {
      setMessage('Primero iniciá sesión para pedir un viaje.')
      window.location.href = '/login'
      return
    }

    if (!selectedDriver) {
      setMessage('Elegí un chofer disponible.')
      return
    }

    if (!destination.trim()) {
      setMessage('Escribí tu destino.')
      return
    }

    setRequesting(true)
    setMessage('')

    const payload = {
      client_id: user.id,
      driver_id: selectedDriver.user_id,
      destination_text: destination,
      pickup_lat: clientLocation.lat,
      pickup_lng: clientLocation.lng,
      driver_lat: selectedDriver.lat,
      driver_lng: selectedDriver.lng,
      price: selectedDriver.price,
      payment_method: paymentMethod,
      status: 'pending',
      women_mode: onlyWomenMode,
      created_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('trips')
      .insert(payload)
      .select()
      .single()

    setRequesting(false)

    if (error) {
      console.error(error)
      setMessage('No se pudo crear el viaje. Revisá la tabla trips.')
      return
    }

    window.location.href = `/chat?trip=${data.id}`
  }

  return (
    <>
      <style>{`
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          font-family: Inter, Arial, sans-serif;
          background: #06110d;
        }

        button,
        input {
          font-family: inherit;
        }

        .screen {
          min-height: 100vh;
          display: flex;
          justify-content: center;
          background:
            radial-gradient(circle at top, rgba(99,192,186,.20), transparent 34%),
            linear-gradient(180deg, #06110d, #020403);
        }

        .phone {
          width: 100%;
          max-width: 430px;
          min-height: 100vh;
          background: #f4f7f6;
          overflow: hidden;
          position: relative;
        }

        @media (min-width: 560px) {
          .screen {
            padding: 22px;
          }

          .phone {
            border-radius: 42px;
            min-height: 860px;
            box-shadow: 0 30px 90px rgba(0,0,0,.35);
          }
        }

       .map-stage {
  height: 100vh;
  min-height: 760px;
  position: relative;
  overflow: hidden;
  background: #f8faf8;
}

.real-map {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  z-index: 1;
  filter: grayscale(1) brightness(1.16) contrast(.88);
  opacity: .72;
}

.map-soft {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(248,250,248,.72) 0%, rgba(248,250,248,.18) 34%, rgba(248,250,248,.55) 100%),
    radial-gradient(circle at 50% 38%, rgba(99,192,186,.16), transparent 26%);
}

.map-route {
  position: absolute;
  left: 48%;
  top: 270px;
  width: 6px;
  height: 360px;
  z-index: 3;
  border-radius: 999px;
  background: repeating-linear-gradient(
    to bottom,
    #07110f 0 18px,
    transparent 18px 32px
  );
  transform: rotate(21deg);
  opacity: .9;
  animation: routeMove 1.4s linear infinite;
}

@keyframes routeMove {
  from { background-position: 0 0; }
  to { background-position: 0 32px; }
}

.map-driver-avatar {
  position: absolute;
  z-index: 5;
  width: 58px;
  height: 58px;
  border: 0;
  border-radius: 999px;
  padding: 4px;
  background: white;
  box-shadow: 0 18px 38px rgba(0,0,0,.2);
  display: grid;
  place-items: center;
  animation: avatarFloat 4s ease-in-out infinite;
}

.map-driver-avatar img {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  object-fit: cover;
  border: 3px solid #63c0ba;
}

.map-driver-avatar span {
  position: absolute;
  right: 4px;
  bottom: 5px;
  width: 13px;
  height: 13px;
  border-radius: 999px;
  background: #16a34a;
  border: 3px solid white;
}

.map-driver-avatar.avatar-1 {
  left: 58%;
  top: 270px;
}

.map-driver-avatar.avatar-2 {
  left: 23%;
  top: 390px;
  animation-delay: .35s;
}

.map-driver-avatar.avatar-3 {
  right: 15%;
  top: 440px;
  animation-delay: .7s;
}

@keyframes avatarFloat {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-8px) scale(1.04); }
}


        .topbar {
          position: absolute;
          top: 14px;
          left: 14px;
          right: 14px;
          z-index: 5;
          display: grid;
          grid-template-columns: 52px 1fr 52px;
          gap: 10px;
          align-items: center;
        }

        .icon-button {
          width: 52px;
          height: 52px;
          border-radius: 19px;
          border: 1px solid rgba(255,255,255,.72);
          background: rgba(255,255,255,.92);
          color: #07110f;
          font-size: 22px;
          font-weight: 950;
          display: grid;
          place-items: center;
          box-shadow: 0 14px 34px rgba(0,0,0,.08);
          backdrop-filter: blur(14px);
          cursor: pointer;
        }

        .brand-pill {
          height: 62px;
          border-radius: 24px;
          background: rgba(255,255,255,.94);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 14px 34px rgba(0,0,0,.08);
          backdrop-filter: blur(14px);
          overflow: hidden;
        }

        .brand-pill img {
          width: 138px;
          max-height: 48px;
          object-fit: contain;
        }

        .search-card {
          position: absolute;
          left: 16px;
          right: 16px;
          top: 92px;
          z-index: 5;
          min-height: 78px;
          border-radius: 28px;
          padding: 13px 16px;
          background: rgba(255,255,255,.96);
          display: flex;
          align-items: center;
          gap: 13px;
          box-shadow: 0 18px 44px rgba(0,0,0,.09);
          backdrop-filter: blur(14px);
        }

        .search-icon {
          width: 42px;
          height: 42px;
          border-radius: 16px;
          background: rgba(99,192,186,.16);
          display: grid;
          place-items: center;
          color: #07110f;
          font-size: 19px;
          flex: 0 0 auto;
        }

        .search-card small {
          display: block;
          color: #667085;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: .12em;
          margin-bottom: 4px;
        }

        .search-card input {
          width: 100%;
          border: 0;
          background: transparent;
          outline: none;
          color: #07110f;
          font-size: 17px;
          font-weight: 950;
        }

        .mode-switch {
          position: absolute;
          left: 16px;
          right: 16px;
          top: 184px;
          z-index: 5;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding: 8px;
          border-radius: 25px;
          background: rgba(255,255,255,.92);
          box-shadow: 0 18px 44px rgba(0,0,0,.08);
          backdrop-filter: blur(14px);
        }

        .mode-switch button {
          min-height: 50px;
          border-radius: 19px;
          border: 0;
          background: transparent;
          color: #667085;
          font-size: 15px;
          font-weight: 950;
          cursor: pointer;
        }

        .mode-switch button.active {
          background: #07110f;
          color: white;
          box-shadow: 0 14px 28px rgba(0,0,0,.18);
        }

        .mode-switch button.women.active {
  background: #f7cddd;
  color: #7a4157;
  box-shadow: 0 10px 24px rgba(247,205,221,.45);
}

        .client-pin,
        .driver-pin {
          position: absolute;
          z-index: 4;
          width: 64px;
          height: 64px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          box-shadow: 0 20px 48px rgba(0,0,0,.22);
        }

        .client-pin {
  left: 50%;
  top: 330px;
  transform: translateX(-50%);
  background: #ffffff;
  border: 6px solid #63c0ba;
  color: #07110f;
  font-size: 0;
}

.client-pin::before {
  content: '';
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #07110f;
  box-shadow: 0 0 0 8px rgba(99,192,186,.18);
}

.client-pin::after {
  content: '';
  position: absolute;
  inset: -18px;
  border-radius: 999px;
  border: 2px solid rgba(99,192,186,.35);
  animation: locationPulse 1.8s ease-out infinite;
}

@keyframes locationPulse {
  0% {
    transform: scale(.65);
    opacity: .9;
  }
  100% {
    transform: scale(1.25);
    opacity: 0;
  }
}

        .driver-pin {
          left: 50%;
          bottom: 80px;
          transform: translateX(-50%);
          background: white;
          border: 5px solid #63c0ba;
          overflow: hidden;
        }

        .driver-pin img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .gps-button {
          position: absolute;
          right: 20px;
          bottom: 58px;
          z-index: 5;
          width: 58px;
          height: 58px;
          border-radius: 22px;
          border: 0;
          background: #07110f;
          color: white;
          font-size: 24px;
          font-weight: 950;
          box-shadow: 0 20px 48px rgba(0,0,0,.22);
          cursor: pointer;
        }

       .sheet {
  position: fixed;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  z-index: 20;
  width: 100%;
  max-width: 430px;
  background: #f6f7f5;
  border-radius: 26px 26px 0 0;
  padding: 8px 14px 22px;
  min-height: 310px;
  max-height: 46vh;
  overflow-y: auto;
  box-shadow: 0 -18px 48px rgba(0,0,0,.14);
  transition: transform .28s ease, max-height .28s ease;
}

.sheet.collapsed {
  transform: translateX(-50%) translateY(calc(100% - 54px));
  min-height: 54px;
  max-height: 54px;
  overflow: hidden;
  padding: 8px 14px 10px;
}

      .grabber {
  width: 120px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  display: block;
  margin: 0 auto 8px;
  cursor: pointer;
  position: relative;
  z-index: 50;
  touch-action: manipulation;
}

.grabber::after {
  content: '';
  width: 58px;
  height: 6px;
  border-radius: 999px;
  background: #cfd7d4;
  position: absolute;
  left: 50%;
  top: 6px;
  transform: translateX(-50%);
}

        .simple-head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
}

.simple-head p {
  margin: 0;
  color: #63c0ba;
  font-size: 11px;
  letter-spacing: .13em;
  font-weight: 950;
}

.simple-head h1 {
  margin: 3px 0 0;
  color: #07110f;
  font-size: 20px;
  line-height: 1;
  letter-spacing: -.03em;
  font-weight: 950;
}

.driver-count {
  width: 64px;
  height: 58px;
  border-radius: 22px;
  background: white;
  display: grid;
  place-items: center;
  box-shadow: 0 10px 24px rgba(0,0,0,.06);
}

.driver-count strong {
  color: #07110f;
  font-size: 20px;
  line-height: 1;
  font-weight: 950;
}

.driver-count span {
  margin-top: -10px;
  color: #667085;
  font-size: 10px;
  font-weight: 900;
}

        .message {
  margin-top: 10px;
  padding: 11px 13px;
  border-radius: 18px;
  background: #fff4cc;
  color: #442d00;
  font-size: 13px;
  font-weight: 900;
}

        .drivers-list {
          margin-top: 15px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .driver-card {
          width: 100%;
          border: 2px solid transparent;
          border-radius: 28px;
          padding: 12px;
          background: white;
          display: grid;
          grid-template-columns: 66px 1fr auto;
          gap: 12px;
          align-items: center;
          text-align: left;
          cursor: pointer;
          box-shadow: 0 12px 30px rgba(0,0,0,.055);
        }

       .driver-card.selected {
  border-color: #f2bfd2;
  box-shadow: 0 16px 34px rgba(242,191,210,.28);
}

        .driver-card img {
          width: 66px;
          height: 66px;
          border-radius: 24px;
          object-fit: cover;
          background: #e8eeee;
        }

        .driver-main {
          min-width: 0;
        }

        .driver-name {
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .driver-name strong {
          color: #07110f;
          font-size: 18px;
          font-weight: 950;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .verified-dot {
          width: 17px;
          height: 17px;
          border-radius: 999px;
          background: #63c0ba;
          color: #07110f;
          display: grid;
          place-items: center;
          font-size: 11px;
          font-weight: 950;
          flex: 0 0 auto;
        }

        .driver-car {
          margin-top: 3px;
          color: #667085;
          font-size: 13px;
          font-weight: 850;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .driver-meta {
          margin-top: 8px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .driver-meta span {
          padding: 6px 8px;
          border-radius: 999px;
          background: #f1f4f3;
          color: #34403d;
          font-size: 11px;
          font-weight: 900;
        }

        .price {
          color: #07110f;
          font-size: 14px;
          font-weight: 950;
          white-space: nowrap;
        }

        .empty {
  margin-top: 12px;
  padding: 14px;
  border-radius: 20px;
  background: white;
  color: #07110f;
  font-size: 14px;
  font-weight: 900;
  line-height: 1.25;
}

        .cta {
  position: fixed;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  z-index: 35;
  width: calc(100% - 32px);
  max-width: 398px;
  min-height: 56px;
          border: 0;
          border-radius: 25px;
          background: #63c0ba;
          color: #021412;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          font-size: 19px;
          font-weight: 950;
          box-shadow: 0 22px 52px rgba(99,192,186,.38);
          cursor: pointer;
        }

        .cta:disabled {
          opacity: .58;
          cursor: not-allowed;
        }

        .modal-backdrop,
        .client-side-backdrop {
          position: fixed;
          inset: 0;
          z-index: 80;
          background: rgba(0,0,0,.48);
          display: grid;
          place-items: end center;
        }

        .modal {
          width: 100%;
          max-width: 430px;
          background: white;
          color: #07110f;
          border-radius: 32px 32px 0 0;
          padding: 22px;
        }

        .modal h2 {
          margin: 0 0 14px;
          font-size: 30px;
          letter-spacing: -.04em;
        }

        .payment-option {
          width: 100%;
          min-height: 56px;
          border-radius: 19px;
          border: 2px solid #eef1f0;
          background: #f8faf9;
          margin-top: 10px;
          color: #07110f;
          font-weight: 950;
          cursor: pointer;
        }

        .payment-option.active {
          border-color: #63c0ba;
          background: rgba(99,192,186,.18);
        }

        .close-btn {
          margin-top: 15px;
          width: 100%;
          height: 56px;
          border: 0;
          border-radius: 19px;
          background: #07110f;
          color: white;
          font-weight: 950;
          cursor: pointer;
        }

        .client-side-backdrop {
          place-items: stretch start;
        }
.client-side-menu {
  width: min(86vw, 340px);
  height: 100vh;
  background: #f6f7f5;
  color: #07110f;
  padding: 20px;
  box-shadow: 28px 0 70px rgba(0,0,0,.28);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding-bottom: 120px;
}

        .client-side-header {
          display: flex;
          gap: 12px;
          align-items: center;
          padding: 12px;
          border-radius: 26px;
          background: white;
        }

        .client-side-avatar {
  width: 58px;
  height: 58px;
  border-radius: 22px;
  background: #63c0ba;
  overflow: hidden;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.client-side-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.client-side-avatar span {
  color: #021412;
  font-size: 23px;
  font-weight: 950;
}

        .client-side-header h2 {
          margin: 0;
          font-size: 20px;
          line-height: 1;
        }

        .client-side-header p {
          margin: 6px 0 0;
          color: #667085;
          font-size: 13px;
          font-weight: 800;
        }

        .client-side-list {
  margin-top: 18px;
  display: grid;
  gap: 10px;
  flex: 1;
  align-content: start;
  overflow-y: auto;
  padding-bottom: 18px;
}

        .client-side-list button {
          min-height: 54px;
          border: 0;
          border-radius: 20px;
          background: white;
          color: #07110f;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 0 14px;
          font-size: 15px;
          font-weight: 950;
          cursor: pointer;
        }

       .client-side-bottom {
  margin-top: auto;
  display: grid;
  gap: 10px;
  padding-top: 12px;
}

.client-logout-btn {
  width: 100%;
  height: 52px;
  border: 0;
  border-radius: 18px;
  background: #ffe8e8;
  color: #b42318;
  font-size: 15px;
  font-weight: 950;
  cursor: pointer;
}

.client-side-close {
  width: 100%;
  height: 54px;
  border: 0;
  border-radius: 20px;
  background: #07110f;
  color: white;
  font-weight: 950;
  cursor: pointer;
}
      `}</style>

      <div className="screen">
        <div className="phone">
  <section className="map-stage">
    <iframe className="real-map" title="Mapa MiChofer" src={mapUrl} />

    <div className="map-soft" />
    {/* La ruta real se mostrará recién después de confirmar un chofer */}

 {visibleDrivers.slice(0, 3).map((driver, index) => (
  <button
    key={driver.id}
    type="button"
    className={`map-driver-avatar avatar-${index + 1}`}
    onClick={() => setSelectedDriver(driver)}
    aria-label={`Elegir a ${driver.name}`}
  >
    <img src={driver.avatar} alt={driver.name} />
    <span />
  </button>
))}

            <header className="topbar">
              <button className="icon-button" onClick={() => setShowProfile(true)}>
                ☰
              </button>

              <div className="brand-pill">
                <img src={logo} alt="MiChofer" />
              </div>

              <button className="icon-button" onClick={() => setShowPayment(true)}>
                ◔
              </button>
            </header>

            <div className="search-card">
              <div className="search-icon">⌕</div>
              <div style={{ width: '100%' }}>
                <small>DESTINO</small>
                <input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="¿A dónde vas?"
                />
              </div>
            </div>

            <div className="mode-switch">
              <button
                className={mode === 'all' ? 'active' : ''}
                onClick={() => setMode('all')}
              >
                Todos
              </button>

              <button
                className={mode === 'women' ? 'women active' : 'women'}
                onClick={() => setMode('women')}
              >
                Para ellas
              </button>
            </div>

            <div className="client-pin">⌖</div>


            <button
              className="gps-button"
              onClick={() => {
                navigator.geolocation.getCurrentPosition((pos) => {
                  const nextLocation = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                  }

                  setClientLocation(nextLocation)
                  loadDrivers(nextLocation)
                })
              }}
            >
              ➤
            </button>
          </section>

         <section className={sheetCollapsed ? 'sheet collapsed' : 'sheet'}>
  <button
    type="button"
    className="grabber"
    onClick={toggleSheet}
    onTouchEnd={(e) => {
      e.preventDefault()
      toggleSheet()
    }}
    aria-label={sheetCollapsed ? 'Mostrar choferes' : 'Ocultar panel'}
  />

  {!sheetCollapsed && (
    <>
      <div className="simple-head">
        <div>
          <p
            style={{
              color: onlyWomenMode ? '#e59ab5' : '#63c0ba',
            }}
          >
            {onlyWomenMode ? 'PARA ELLAS' : 'CHOFERES CERCA'}
          </p>

          <h1>Elegí quién te lleva</h1>
        </div>

        <div className="driver-count">
          <strong>{visibleDrivers.length}</strong>
          <span>online</span>
        </div>
      </div>

      {message && <div className="message">{message}</div>}

      {loading ? (
        <div className="empty">Buscando choferes cerca tuyo...</div>
      ) : visibleDrivers.length === 0 ? (
        <div className="empty">
          No hay choferes disponibles ahora.
          {onlyWomenMode ? ' Probá en Todos.' : ''}
        </div>
      ) : (
        <div className="drivers-list">
          {visibleDrivers.map((driver) => (
            <button
              key={driver.id}
              className={
                selectedDriver?.id === driver.id
                  ? 'driver-card selected'
                  : 'driver-card'
              }
              onClick={() => setSelectedDriver(driver)}
            >
              <img src={driver.avatar} alt={driver.name} />

              <div className="driver-main">
                <div className="driver-name">
                  <strong>{driver.name}</strong>
                  {driver.verified && <span className="verified-dot">✓</span>}
                </div>

                <div className="driver-car">
                  {driver.car} • {driver.color}
                </div>

                <div className="driver-meta">
                  <span>⭐ {driver.rating || '5.00'}</span>
                  <span>{driver.eta}</span>
                  <span>{driver.distance}</span>
                </div>
              </div>

              <div className="price">{formatGs(driver.price)}</div>
            </button>
          ))}
        </div>
      )}
    </>
  )}
</section>

          {selectedDriver && !sheetCollapsed && (
  <button
    className="cta"
    disabled={requesting}
    onClick={requestRide}
  >
    {requesting
      ? 'Solicitando...'
      : `Solicitar con ${selectedDriver.name.split(' ')[0]} →`}
  </button>
)}

          {showPayment && (
            <div className="modal-backdrop" onClick={() => setShowPayment(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>Método de pago</h2>

                <button
                  className={
                    paymentMethod === 'cash'
                      ? 'payment-option active'
                      : 'payment-option'
                  }
                  onClick={() => setPaymentMethod('cash')}
                >
                  💵 Efectivo al terminar el viaje
                </button>

                <button
                  className={
                    paymentMethod === 'card'
                      ? 'payment-option active'
                      : 'payment-option'
                  }
                  onClick={() => setPaymentMethod('card')}
                >
                  💳 Tarjeta registrada
                </button>

                <button
                  className={
                    paymentMethod === 'transfer'
                      ? 'payment-option active'
                      : 'payment-option'
                  }
                  onClick={() => setPaymentMethod('transfer')}
                >
                  🏦 Transferencia
                </button>

                <button className="close-btn" onClick={() => setShowPayment(false)}>
                  Confirmar método
                </button>
              </div>
            </div>
          )}

          {showProfile && (
  <div
    className="client-side-backdrop"
    onClick={() => setShowProfile(false)}
  >
    <aside
      className="client-side-menu"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="client-side-header">
        <div className="client-side-avatar">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Avatar" />
          ) : (
            <span>
              {(profile?.full_name || user?.email || 'M')
                .charAt(0)
                .toUpperCase()}
            </span>
          )}
        </div>

        <div>
          <h2>{profile?.full_name || 'Mi cuenta'}</h2>
          <p>{user?.email || 'Cliente MiChofer'}</p>
        </div>
      </div>

      <div className="client-side-list">
        <button onClick={() => setShowProfile(false)}>
          👤 <span>Mi perfil</span>
        </button>

        <button
          onClick={() => {
            setShowProfile(false)
            setShowPayment(true)
          }}
        >
          💳 <span>Métodos de pago</span>
        </button>

        <button onClick={() => (window.location.href = '/trips')}>
          🧾 <span>Mis viajes</span>
        </button>

        <button onClick={() => (window.location.href = '/chat')}>
          💬 <span>Mensajes</span>
        </button>

        <button onClick={() => (window.location.href = '/support')}>
          🛟 <span>Ayuda y seguridad</span>
        </button>

        <button onClick={() => (window.location.href = '/settings')}>
          ⚙️ <span>Configuración</span>
        </button>
      </div>

      <div className="client-side-bottom">
        <button
          type="button"
          className="client-logout-btn"
          onClick={async () => {
            await supabase.auth.signOut()

            localStorage.removeItem('michofer_last_email')
            localStorage.removeItem('michofer_last_name')
            localStorage.removeItem('michofer_last_role')
            localStorage.removeItem('michofer_last_photo')

            window.location.href = '/login'
          }}
        >
          🚪 Cerrar sesión
        </button>

        <button
          type="button"
          className="client-side-close"
          onClick={() => setShowProfile(false)}
        >
          Cerrar menú
        </button>
      </div>
    </aside>
  </div>
)}
        </div>
      </div>
    </>
  )
}