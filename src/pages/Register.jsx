import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/logo.png'

export default function Register() {
  const [step, setStep] = useState('name')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('')
  const [gender, setGender] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [knownUser, setKnownUser] = useState(null)

  useEffect(() => {
    const savedEmail = localStorage.getItem('michofer_last_email')
    const savedName = localStorage.getItem('michofer_last_name')
    const savedRole = localStorage.getItem('michofer_last_role')

    if (savedEmail) {
      setKnownUser({
        email: savedEmail,
        name: savedName || '',
        role: savedRole || '',
      })
    }
  }, [])

  const title = useMemo(() => {
    if (knownUser?.email && step === 'name') return 'A vos te conozco 👋'
    if (step === 'name') return 'Mba’éichapa'
    if (step === 'role') return '¿Cómo vas a usar MiChofer?'
    if (step === 'gender') return 'Un dato más'
    if (step === 'email') return 'Tu correo'
    if (step === 'photo') return 'Tu foto'
    if (step === 'password') return 'Creá tu clave'
    if (step === 'loading') return 'Creando cuenta'
    return 'Crear cuenta'
  }, [step, knownUser])

  const subtitle = useMemo(() => {
    if (knownUser?.email && step === 'name') {
      return `${knownUser.name ? knownUser.name.split(' ')[0] + ', ' : ''}ya usaste MiChofer en este dispositivo. Entrá nomás si sos vos.`
    }

    if (step === 'name') return 'Primero decime tu nombre y apellido.'
    if (step === 'role') return 'Elegí nomás. Esto nos ayuda a mostrarte lo correcto.'
    if (step === 'gender') return 'Así cuidamos mejor la experiencia de viaje.'
    if (step === 'email') return 'Con este correo vas a entrar después.'
    if (step === 'photo') return 'Tu foto ayuda a viajar con más confianza.'
    if (step === 'password') return 'Mínimo 6 caracteres. Simple y seguro.'
    if (step === 'loading') return 'Dame un segundo, ya casi está.'
    return ''
  }, [step, knownUser])

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase()
  }

  function hasNameAndLastName(value) {
    return String(value || '').trim().split(/\s+/).filter(Boolean).length >= 2
  }

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0]

    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Subí una imagen válida')
      return
    }

    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function nextFromName(e) {
    e.preventDefault()

    if (!hasNameAndLastName(fullName)) {
      alert('Poné tu nombre y apellido')
      return
    }

    setStep('role')
  }

  function nextFromRole(value) {
    setRole(value)
    setStep('gender')
  }

  function nextFromGender(value) {
    setGender(value)
    setStep('email')
  }

  function nextFromEmail(e) {
    e.preventDefault()

    const cleanEmail = normalizeEmail(email)

    if (!cleanEmail || !cleanEmail.includes('@')) {
      alert('Poné un correo válido')
      return
    }

    setEmail(cleanEmail)
    setStep('photo')
  }

  async function handleRegister(e) {
    e.preventDefault()

    const cleanName = fullName.trim()
    const cleanEmail = normalizeEmail(email)

    if (!hasNameAndLastName(cleanName)) {
      alert('Poné tu nombre y apellido')
      setStep('name')
      return
    }

    if (!role) {
      alert('Elegí si sos pasajero/a o chofer')
      setStep('role')
      return
    }

    if (!gender) {
      alert('Elegí una opción')
      setStep('gender')
      return
    }

    if (!cleanEmail || !cleanEmail.includes('@')) {
      alert('Poné un correo válido')
      setStep('email')
      return
    }

    if (!photoFile) {
      alert('Subí tu foto para continuar')
      setStep('photo')
      return
    }

    if (!password || password.length < 6) {
      alert('La contraseña debe tener mínimo 6 caracteres')
      return
    }

    try {
      setBusy(true)
      setStep('loading')

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
      })

      if (error) {
        const msg = String(error.message || '').toLowerCase()

        if (
          msg.includes('already registered') ||
          msg.includes('already exists') ||
          msg.includes('user already registered')
        ) {
          alert('Ese correo ya tiene cuenta. Entrá nomás 👌')
          window.location.href = '/login?email=' + encodeURIComponent(cleanEmail)
          return
        }

        alert(error.message)
        setStep('password')
        return
      }

      const userId = data.user?.id

      if (userId) {
        const { error: profileError } = await supabase.from('profiles').insert({
          id: userId,
          full_name: cleanName,
          role,
          gender,
          email: cleanEmail,
        })

        if (profileError) {
          alert(profileError.message)
          setStep('password')
          return
        }
      }

      localStorage.setItem('michofer_last_email', cleanEmail)
      localStorage.setItem('michofer_last_name', cleanName)
      localStorage.setItem('michofer_last_role', role)

      if (photoPreview) {
        localStorage.setItem('michofer_last_photo', photoPreview)
      }

      alert('Listo, ya te conozco para la próxima 👌')
      window.location.href = '/login'
    } catch (err) {
      console.error(err)
      alert('No se pudo crear la cuenta')
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

          {knownUser?.email && step === 'name' && (
            <button
              type="button"
              className="login-main-btn"
              onClick={() => {
                window.location.href =
                  '/login?email=' + encodeURIComponent(knownUser.email)
              }}
            >
              Sí, soy yo
            </button>
          )}

          {step === 'name' && (
            <form className="login-step-form" onSubmit={nextFromName}>
              <label>Nombre y apellido</label>

              <input
                autoFocus
                placeholder="Ej: Juan Pérez"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />

              <button className="login-main-btn" type="submit">
                Continuar
              </button>

              <a className="login-create-link" href="/login">
                Ya tengo cuenta
              </a>
            </form>
          )}

          {step === 'role' && (
            <div className="login-step-form">
              <button
                type="button"
                className="login-choice-btn"
                onClick={() => nextFromRole('passenger')}
              >
                Necesito viajar
              </button>

              <button
                type="button"
                className="login-choice-btn"
                onClick={() => nextFromRole('driver')}
              >
                Soy chofer
              </button>

              <button
                type="button"
                className="login-back-btn"
                onClick={() => setStep('name')}
              >
                Volver
              </button>
            </div>
          )}

          {step === 'gender' && (
            <div className="login-step-form">
              <button
                type="button"
                className="login-choice-btn"
                onClick={() => nextFromGender('female')}
              >
                Mujer
              </button>

              <button
                type="button"
                className="login-choice-btn"
                onClick={() => nextFromGender('male')}
              >
                Hombre
              </button>

              <button
                type="button"
                className="login-choice-btn"
                onClick={() => nextFromGender('other')}
              >
                Prefiero no decir
              </button>

              <button
                type="button"
                className="login-back-btn"
                onClick={() => setStep('role')}
              >
                Volver
              </button>
            </div>
          )}

          {step === 'email' && (
            <form className="login-step-form" onSubmit={nextFromEmail}>
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
                onClick={() => setStep('gender')}
              >
                Volver
              </button>
            </form>
          )}

          {step === 'photo' && (
            <div className="login-step-form">
              <label>Foto de perfil</label>

              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="Foto de perfil"
                  className="register-photo-preview"
                />
              ) : (
                <label className="register-photo-box">
                  <span>📸</span>
                  <strong>Subir mi foto</strong>
                  <small>Sea pasajero o chofer, acá nos cuidamos.</small>

                  <input
                    type="file"
                    accept="image/*"
                    capture="user"
                    onChange={handlePhotoSelect}
                    hidden
                  />
                </label>
              )}

              {photoPreview && (
                <button
                  type="button"
                  className="login-main-btn"
                  onClick={() => setStep('password')}
                >
                  Continuar
                </button>
              )}

              <button
                type="button"
                className="login-back-btn"
                onClick={() => setStep('email')}
              >
                Volver
              </button>
            </div>
          )}

          {step === 'password' && (
            <form className="login-step-form" onSubmit={handleRegister}>
              <div className="login-recognized-pill">{email}</div>

              <label>Contraseña</label>

              <input
                autoFocus
                placeholder="mínimo 6 caracteres"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />

              <button className="login-main-btn" disabled={busy} type="submit">
                {busy ? 'Creando...' : 'Crear cuenta'}
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
              <p>Creando tu cuenta...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}