import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/logo.png'

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function getStoredRoleForEmail(email) {
  const savedEmail = normalizeEmail(localStorage.getItem('michofer_last_email'))
  const savedRole = localStorage.getItem('michofer_last_role') || ''

  return savedEmail === normalizeEmail(email) ? savedRole : ''
}

function resolveRole(user, profile, email) {
  return (
    profile?.role ||
    user?.user_metadata?.role ||
    getStoredRoleForEmail(email) ||
    'passenger'
  )
}

export default function Login() {
  const [step, setStep] = useState('welcome')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [knownUser, setKnownUser] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const emailFromUrl = params.get('email')

    const savedEmail = localStorage.getItem('michofer_last_email')
    const savedName = localStorage.getItem('michofer_last_name')
    const savedRole = localStorage.getItem('michofer_last_role')
    const savedPhoto = localStorage.getItem('michofer_last_photo')

    const finalEmail = emailFromUrl || savedEmail

    if (finalEmail) {
      setEmail(finalEmail)

      setKnownUser({
        email: finalEmail,
        name: savedName || '',
        role: savedRole || '',
        photo: savedPhoto || '',
      })

      setStep('password')
    }
  }, [])

  const title = useMemo(() => {
    if (knownUser?.email && step === 'password') {
      return `Hola ${knownUser.name?.split(' ')[0] || ''}`
    }

    if (step === 'welcome') return 'Movilidad conectada.'
    if (step === 'email') return 'Tu correo'
    if (step === 'password') return 'Tu clave'
    if (step === 'loading') return 'Entrando...'

    return 'MiChofer'
  }, [step, knownUser])

  const subtitle = useMemo(() => {
    if (knownUser?.email && step === 'password') {
      return 'Tu dispositivo ya está registrado.'
    }

    if (step === 'welcome') return 'Respuesta rápida. Presencia clara.'
    if (step === 'email') return 'Primero identifiquemos tu cuenta.'
    if (step === 'password') return 'Último paso y seguimos.'
    if (step === 'loading') return 'Verificando acceso.'

    return ''
  }, [step, knownUser])

  function handleEmailNext(e) {
    e.preventDefault()
    setErrorMessage('')

    const cleanEmail = normalizeEmail(email)

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Poné un correo válido.')
      return
    }

    setEmail(cleanEmail)
    setStep('password')
  }

  async function handleLogin(e) {
    e.preventDefault()
    setErrorMessage('')

    const cleanEmail = normalizeEmail(email)

    if (!cleanEmail || !password) {
      setErrorMessage('Completá tu correo y clave.')
      return
    }

    try {
      setBusy(true)
      setStep('loading')

      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      })

      if (error) {
        setErrorMessage(
          error.message === 'Failed to fetch'
            ? 'No pude conectar con Supabase. Revisá el Project URL en .env y reiniciá Vite.'
            : error.message
        )
        setStep('password')
        return
      }

      const user = data.user
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (profileError) {
        console.warn('PROFILE LOAD ERROR:', profileError)
      }

      const role = resolveRole(user, profile, cleanEmail)
      const fullName = profile?.full_name || user?.user_metadata?.full_name || ''
      const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url || ''

      localStorage.setItem('michofer_last_email', cleanEmail)
      localStorage.setItem('michofer_last_name', fullName)
      localStorage.setItem('michofer_last_role', role)

      if (avatarUrl) {
        localStorage.setItem('michofer_last_photo', avatarUrl)
      } else {
        localStorage.removeItem('michofer_last_photo')
      }

      if (!profile && !profileError) {
        await supabase.from('profiles').upsert(
          {
            id: user.id,
            full_name: fullName,
            role,
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
      }

      if (role === 'driver') {
        window.location.href = '/driver'
        return
      }

      window.location.href = '/client'
    } catch (err) {
      console.error(err)
      setErrorMessage('No se pudo iniciar sesión. Revisá la conexión con Supabase.')
      setStep('password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-phone">
        <div className="login-panel">
          <div className="login-hero-logo">
            <img src={logo} alt="MiChofer" />
          </div>

          <div className="login-spacer" />

          {step === 'password' && (
            <div className="login-user-avatar-fallback">
              {knownUser?.photo?.startsWith('http') ? (
                <img src={knownUser.photo} alt="Usuario" />
              ) : (
                <span>{knownUser?.name?.charAt(0)?.toUpperCase() || 'U'}</span>
              )}
            </div>
          )}

          <h1>{title}</h1>

          <p className="login-subtitle">{subtitle}</p>

          {errorMessage && (
            <div className="login-error-message">
              {errorMessage}
            </div>
          )}

          {step === 'welcome' && (
            <>
              <button
                className="login-main-btn"
                onClick={() => setStep('email')}
              >
                Continuar
              </button>

              <a className="login-create-link" href="/registro">
                Crear cuenta
              </a>
            </>
          )}

          {step === 'email' && (
            <form className="login-step-form" onSubmit={handleEmailNext}>
              <input
                autoFocus
                placeholder="Tu correo"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <button className="login-main-btn" type="submit">
                Continuar
              </button>

              <button
                type="button"
                className="login-text-btn"
                onClick={() => setStep('welcome')}
              >
                ← Atrás
              </button>
            </form>
          )}

          {step === 'password' && (
            <form className="login-step-form" onSubmit={handleLogin}>
              <div className="login-recognized-pill">{email}</div>

              <div className="password-box">
                <input
                  autoFocus
                  placeholder="Tu clave"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />

                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>

              <button
                className="login-main-btn"
                disabled={busy}
                type="submit"
              >
                {busy ? 'Entrando...' : 'Entrar'}
              </button>

              <button
                type="button"
                className="login-text-btn"
                onClick={() => setStep('email')}
              >
                ← Cambiar correo
              </button>
            </form>
          )}

          {step === 'loading' && (
            <div className="login-loading-box">
              <div className="login-spinner" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
