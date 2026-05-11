import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/logo.png'

export default function Login() {
  const [step, setStep] = useState('welcome')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [knownUser, setKnownUser] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const emailFromUrl = params.get('email')

    const savedEmail = localStorage.getItem('michofer_last_email')
    const savedName = localStorage.getItem('michofer_last_name')
    const savedRole = localStorage.getItem('michofer_last_role')

    const finalEmail = emailFromUrl || savedEmail

    if (finalEmail) {
      setEmail(finalEmail)
      setKnownUser({
        email: finalEmail,
        name: savedName || '',
        role: savedRole || '',
      })
      setStep('password')
    }
  }, [])

  const title = useMemo(() => {
    if (knownUser?.email && step === 'password') return 'A vos te conozco 👋'
    if (step === 'welcome') return 'Bienvenido'
    if (step === 'email') return 'Tu correo'
    if (step === 'password') return 'Tu contraseña'
    if (step === 'loading') return 'Entrando'
    return 'MiChofer'
  }, [step, knownUser])

  const subtitle = useMemo(() => {
    if (knownUser?.email && step === 'password') {
      return `${knownUser.name ? knownUser.name.split(' ')[0] + ', ' : ''}poné tu contraseña nomás y seguimos.`
    }

    if (step === 'welcome') return 'Elegí quién te lleva.'
    if (step === 'email') return 'Primero identificamos tu cuenta.'
    if (step === 'password') return 'Último paso para entrar.'
    if (step === 'loading') return 'Verificando tu cuenta.'
    return ''
  }, [step, knownUser])

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase()
  }

  function handleEmailNext(e) {
    e.preventDefault()

    const cleanEmail = normalizeEmail(email)

    if (!cleanEmail || !cleanEmail.includes('@')) {
      alert('Poné un correo válido')
      return
    }

    setEmail(cleanEmail)
    setStep('password')
  }

  async function handleLogin(e) {
    e.preventDefault()

    const cleanEmail = normalizeEmail(email)

    if (!cleanEmail || !password || password.length < 6) {
      alert('Completá correo y contraseña')
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
        alert(error.message)
        setStep('password')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single()

      localStorage.setItem('michofer_last_email', cleanEmail)
      localStorage.setItem('michofer_last_name', profile?.full_name || '')
      localStorage.setItem('michofer_last_role', profile?.role || '')

      if (profile?.role === 'driver') {
        window.location.href = '/driver'
        return
      }

      window.location.href = '/'
    } catch (err) {
      console.error(err)
      alert('Error al iniciar sesión')
      setStep('password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-phone">
        <div className="login-red-orb"></div>

        <div className="login-panel">
          <div className="login-hero-logo">
            <img src={logo} alt="MiChofer" />
          </div>

          <div className="login-spacer"></div>

          <h1>{title}</h1>

          <p className="login-subtitle">{subtitle}</p>

          {step === 'welcome' && (
            <>
              <button
                type="button"
                className="login-main-btn"
                onClick={() => setStep('email')}
              >
                Empezar
              </button>

              <a className="login-create-link" href="/registro">
                Crear cuenta
              </a>
            </>
          )}

          {step === 'email' && (
            <form className="login-step-form" onSubmit={handleEmailNext}>
              <label>Correo electrónico</label>

              <input
                autoFocus
                placeholder="tu correo"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <button className="login-main-btn" type="submit">
                Continuar
              </button>

              <button
                type="button"
                className="login-back-btn"
                onClick={() => setStep('welcome')}
              >
                Volver
              </button>
            </form>
          )}

          {step === 'password' && (
            <form className="login-step-form" onSubmit={handleLogin}>
              <div className="login-recognized-pill">{email}</div>

              <label>Contraseña</label>

              <input
                autoFocus
                placeholder="tu contraseña"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <button className="login-main-btn" disabled={busy} type="submit">
                {busy ? 'Entrando...' : 'Entrar'}
              </button>

              <button
                type="button"
                className="login-back-btn"
                onClick={() => setStep('email')}
                disabled={busy}
              >
                Cambiar correo
              </button>
            </form>
          )}

          {step === 'loading' && (
            <div className="login-loading-box">
              <div className="login-spinner"></div>
              <p>Verificando tu cuenta...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}