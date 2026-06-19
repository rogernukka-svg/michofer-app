const ARRAY_TEXT_RE = /[{}"]/g

export const RIDE_CATEGORY_OPTIONS = [
  {
    code: 'all',
    dbCode: 'auto_standard',
    label: 'Todos',
    shortLabel: 'Todos',
    title: 'Todos los choferes',
    description: 'Autos verificados disponibles cerca.',
    cta: 'Ver choferes',
  },
  {
    code: 'ella',
    dbCode: 'ella',
    label: 'MiChofer Ella',
    shortLabel: 'Ella',
    title: 'MiChofer Ella',
    description: 'Viajes para pasajeras verificadas con conductoras verificadas.',
    cta: 'Activar Ella',
    bullets: ['Identidad revisada', 'Conductoras aprobadas', 'Viaje con soporte y trazabilidad'],
  },
  {
    code: 'moto',
    dbCode: 'moto',
    label: 'Moto',
    shortLabel: 'Moto',
    title: 'MiChofer Moto',
    description: 'Opcion rapida para trayectos cortos.',
    cta: 'Buscar moto',
    bullets: ['Casco extra obligatorio', 'Ideal para distancias cortas', 'Chofer aprobado para moto'],
  },
  {
    code: 'comfort',
    dbCode: 'comfort',
    label: 'Comfort',
    shortLabel: 'Comfort',
    title: 'MiChofer Comfort',
    description: 'Auto mas comodo para viajar con aire y mejor experiencia.',
    cta: 'Buscar Comfort',
    bullets: ['Auto revisado', 'Aire acondicionado', 'Mas comodidad'],
  },
  {
    code: 'premium',
    dbCode: 'premium',
    label: 'Premium',
    shortLabel: 'Premium',
    title: 'MiChofer Premium',
    description: 'Autos seleccionados para aeropuerto, eventos y noche.',
    cta: 'Buscar Premium',
    bullets: ['Categoria manual', 'Auto reciente', 'Experiencia superior'],
  },
]

export const DRIVER_CATEGORY_ACTIONS = [
  {
    code: 'moto',
    title: 'Moto',
    description: 'Agrega viajes cortos y rapidos con moto aprobada.',
    button: 'Solicitar Moto',
  },
  {
    code: 'ella',
    title: 'MiChofer Ella',
    description: 'Para conductoras verificadas que quieran recibir viajes Ella.',
    button: 'Solicitar Ella',
  },
  {
    code: 'comfort',
    title: 'Comfort',
    description: 'Auto comodo, aire acondicionado y mejor experiencia.',
    button: 'Solicitar Comfort',
  },
  {
    code: 'premium',
    title: 'Premium',
    description: 'Autos seleccionados para clientes exigentes.',
    button: 'Solicitar Premium',
  },
  {
    code: 'campus',
    title: 'Campus',
    description: 'Viajes para universidad, residencias, hospitales y guardias.',
    button: 'Solicitar Campus',
  },
]

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim())
  if (!value) return []

  return String(value)
    .replace(ARRAY_TEXT_RE, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function getRideCategoryMeta(code) {
  return RIDE_CATEGORY_OPTIONS.find((item) => item.code === code || item.dbCode === code) || RIDE_CATEGORY_OPTIONS[0]
}

export function getRideCategoryDbCode(code) {
  return getRideCategoryMeta(code).dbCode
}

export function canUseWomenMode(profile) {
  return profile?.women_mode_verified === true || profile?.women_mode_status === 'verified'
}

export function getWomenModeStatus(profile) {
  if (canUseWomenMode(profile)) return 'verified'
  if (profile?.women_mode_status === 'requested' || profile?.women_mode_requested) return 'requested'
  if (profile?.women_mode_status === 'rejected') return 'rejected'
  return 'not_requested'
}

export function isWomenDriver(driver) {
  return (
    driver?.women_driver_verified === true ||
    driver?.women_driver_status === 'verified' ||
    driver?.women_mode === true ||
    driver?.gender === 'female' ||
    driver?.gender === 'mujer'
  )
}

export function hasApprovedCategory(driver, categoryCode) {
  const code = getRideCategoryDbCode(categoryCode)
  if (code === 'auto_standard') return driver?.verified === true
  if (code === 'ella') return isWomenDriver(driver)

  const approved = normalizeArray(driver?.approved_categories)
  const available = normalizeArray(driver?.available_categories)
  return approved.includes(code) || available.includes(code)
}

export function matchesRideCategory(driver, categoryCode) {
  const code = categoryCode || 'all'
  if (code === 'all') return true
  return hasApprovedCategory(driver, code)
}

export function getDriverCategoryStatus(driverProfile, categoryCode) {
  const code = getRideCategoryDbCode(categoryCode)
  if (code === 'auto_standard') {
    return driverProfile?.verified ? 'approved' : 'base'
  }

  const approved = normalizeArray(driverProfile?.approved_categories)
  const requested = normalizeArray(driverProfile?.requested_categories)

  if (code === 'ella') {
    if (driverProfile?.women_driver_verified || driverProfile?.women_driver_status === 'verified') return 'approved'
    if (driverProfile?.women_driver_status === 'rejected') return 'rejected'
    if (driverProfile?.women_driver_requested || requested.includes(code)) return 'requested'
  }

  if (code === 'premium' && driverProfile?.premium_status) {
    if (driverProfile.premium_status === 'approved') return 'approved'
    if (driverProfile.premium_status === 'rejected') return 'rejected'
    if (driverProfile.premium_status === 'requested') return 'requested'
  }

  if (approved.includes(code)) return 'approved'
  if (requested.includes(code)) return 'requested'
  return 'not_requested'
}

export function categoryStatusLabel(status) {
  if (status === 'approved') return 'Aprobada'
  if (status === 'requested') return 'En revision'
  if (status === 'rejected') return 'Rechazada'
  if (status === 'base') return 'Disponible al aprobar perfil'
  return 'Disponible para solicitar'
}
