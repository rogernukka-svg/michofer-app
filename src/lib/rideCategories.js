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
    label: 'Modo Confianza',
    shortLabel: 'Confianza',
    title: 'Modo Confianza',
    description: 'Preferencia opcional para viajar con una conductora verificada cuando quieras mas privacidad.',
    cta: 'Activar preferencia',
    bullets: ['Identidad privada', 'Conductoras verificadas', 'Preferencia flexible para cada viaje'],
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
    title: 'Preferencia Confianza',
    description: 'Para conductoras verificadas que quieran recibir viajes con preferencia de privacidad.',
    button: 'Solicitar preferencia',
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

export function driverHasVehicleCategory(driver, categoryCode) {
  const code = getRideCategoryDbCode(categoryCode)
  if (code === 'auto_standard') return driver?.verified === true
  if (code === 'ella') return isWomenDriver(driver)

  const approved = normalizeArray(driver?.approved_categories)
  const available = normalizeArray(driver?.available_categories)
  const driverType = String(driver?.driver_type || driver?.vehicle_type || '').toLowerCase()
  const vehicleCategory = String(driver?.vehicle_category || '').toLowerCase()

  if (approved.includes(code) || available.includes(code)) return true
  if (code === 'moto' && (driverType === 'moto' || driverType === 'auto_and_moto' || vehicleCategory === 'moto')) return true
  return vehicleCategory === code
}

export function getDriverPreferredRideCategory(driver, requestedCategory = 'all') {
  const requested = getRideCategoryDbCode(requestedCategory || 'all')

  if (requested !== 'auto_standard' && requested !== 'ella') {
    return requested
  }

  const approved = normalizeArray(driver?.approved_categories)
  const available = normalizeArray(driver?.available_categories)
  const categories = [...approved, ...available]
  const vehicleCategory = String(driver?.vehicle_category || '').toLowerCase()
  const driverType = String(driver?.driver_type || driver?.vehicle_type || '').toLowerCase()

  if (vehicleCategory && vehicleCategory !== 'auto_standard' && vehicleCategory !== 'auto') return vehicleCategory
  if (categories.includes('premium')) return 'premium'
  if (categories.includes('comfort')) return 'comfort'
  if (categories.includes('moto') || driverType === 'moto') return 'moto'
  return 'auto_standard'
}

export function hasApprovedCategory(driver, categoryCode) {
  const code = getRideCategoryDbCode(categoryCode)
  if (code === 'auto_standard') return driver?.verified === true
  if (code === 'ella') return isWomenDriver(driver)

  return driverHasVehicleCategory(driver, code)
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
