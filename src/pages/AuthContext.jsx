import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

function getFallbackProfile(currentUser) {
  if (!currentUser?.id) return null

  return {
    id: currentUser.id,
    email: currentUser.email || '',
    full_name:
      currentUser.user_metadata?.full_name ||
      localStorage.getItem('michofer_last_name') ||
      '',
    avatar_url:
      currentUser.user_metadata?.avatar_url ||
      localStorage.getItem('michofer_last_photo') ||
      '',
    role:
      currentUser.user_metadata?.role ||
      localStorage.getItem('michofer_last_role') ||
      'passenger',
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [driverProfile, setDriverProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfiles = useCallback(async (currentUser) => {
    if (!currentUser?.id) {
      setProfile(null)
      setDriverProfile(null)
      return null
    }

    const fallbackProfile = getFallbackProfile(currentUser)

    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle()

      if (profileError) {
        console.warn('AUTH PROFILE LOAD ERROR:', profileError)
      }

      const finalProfile = profileData || fallbackProfile

      setProfile(finalProfile)

      if (finalProfile?.role !== 'driver') {
        setDriverProfile(null)
        return finalProfile
      }

      const { data: driverData, error: driverError } = await supabase
        .from('driver_profiles')
        .select('*')
        .eq('user_id', currentUser.id)
        .maybeSingle()

      if (driverError) {
        console.warn('AUTH DRIVER PROFILE LOAD ERROR:', driverError)
      }

      setDriverProfile(driverData || null)

      return finalProfile
    } catch (error) {
      console.error('AUTH LOAD PROFILES ERROR:', error)

      setProfile(fallbackProfile)
      setDriverProfile(null)

      return fallbackProfile
    }
  }, [])

  useEffect(() => {
    let mounted = true

    async function initializeSession() {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession()

        if (error) {
          console.error('AUTH GET SESSION ERROR:', error)
        }

        if (!mounted) return

        const currentUser = session?.user || null

        setUser(currentUser)

        if (!currentUser) {
          setProfile(null)
          setDriverProfile(null)
          return
        }

        /*
         * No bloqueamos el inicio de la aplicación esperando perfiles.
         * Login puede redirigir usando metadata o localStorage.
         */
        setProfile(getFallbackProfile(currentUser))

        loadProfiles(currentUser).catch((profileError) => {
          console.error('AUTH INITIAL PROFILE ERROR:', profileError)
        })
      } catch (error) {
        console.error('AUTH INITIALIZATION ERROR:', error)

        if (mounted) {
          setUser(null)
          setProfile(null)
          setDriverProfile(null)
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    initializeSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return

      const currentUser = session?.user || null

      setUser(currentUser)
      setLoading(false)

      if (!currentUser) {
        setProfile(null)
        setDriverProfile(null)
        return
      }

      setProfile((currentProfile) => {
        return currentProfile || getFallbackProfile(currentUser)
      })

      /*
       * No usamos callback async ni hacemos await directamente
       * dentro de onAuthStateChange.
       */
      window.setTimeout(() => {
        if (!mounted) return

        loadProfiles(currentUser).catch((profileError) => {
          console.error('AUTH STATE PROFILE ERROR:', profileError)
        })
      }, 0)
    })

    return () => {
      mounted = false
      subscription?.unsubscribe()
    }
  }, [loadProfiles])

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('AUTH LOGOUT ERROR:', error)
      return { error }
    }

    setUser(null)
    setProfile(null)
    setDriverProfile(null)

    return { error: null }
  }, [])

  const reloadProfiles = useCallback(async () => {
    if (!user) return null
    return loadProfiles(user)
  }, [loadProfiles, user])

  const value = useMemo(
    () => ({
      user,
      profile,
      driverProfile,
      loading,
      logout,
      reloadProfiles,
    }),
    [
      user,
      profile,
      driverProfile,
      loading,
      logout,
      reloadProfiles,
    ]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error(
      'useAuth debe ser usado dentro de un AuthProvider'
    )
  }

  return context
}