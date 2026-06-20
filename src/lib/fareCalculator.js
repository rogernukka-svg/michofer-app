// Configuración de tarifas iniciales en Guaraníes (Gs) para Paraguay
export const FARE_CONFIG = {
  moto: {
    minimumFare: 8000,
    baseFare: 5000,
    perKm: 2800,
    perMinute: 300,
    platformFeePercent: 0,
  },
  auto_standard: { // Auto normal
    minimumFare: 15000,
    baseFare: 8000,
    perKm: 4500,
    perMinute: 500,
    platformFeePercent: 0,
  },
  ella: { // Ella usa la misma tarifa que Auto normal
    minimumFare: 15000,
    baseFare: 8000,
    perKm: 4500,
    perMinute: 500,
    platformFeePercent: 0,
  },
  comfort: {
    minimumFare: 20000,
    baseFare: 11000,
    perKm: 5800,
    perMinute: 650,
    platformFeePercent: 0,
  },
  premium: {
    minimumFare: 28000,
    baseFare: 15000,
    perKm: 7500,
    perMinute: 850,
    platformFeePercent: 0,
  },
}

/**
 * Redondea un valor al múltiplo de 500 Gs más cercano.
 * Ejemplos:
 * 12400 -> 12500
 * 12100 -> 12000
 */
export function roundToNearest500(value) {
  return Math.round(value / 500) * 500
}

/**
 * Calcula la tarifa estimada para un viaje según la categoría, distancia y duración.
 * 
 * @param {string} category Categoría del viaje (moto, auto_standard, ella, comfort, premium)
 * @param {number} distanceMeters Distancia en metros
 * @param {number} durationSeconds Duración en segundos
 * @param {number} surgeMultiplier Multiplicador de tarifa dinámica (por defecto 1)
 */
export function calculateFare(category, distanceMeters, durationSeconds, surgeMultiplier = 1) {
  let catKey = String(category).toLowerCase().trim()
  if (catKey === 'all') {
    catKey = 'auto_standard'
  }

  const config = FARE_CONFIG[catKey] || FARE_CONFIG.auto_standard

  const distanceKm = (distanceMeters || 0) / 1000
  const durationMin = (durationSeconds || 0) / 60

  const subtotal = config.baseFare + (distanceKm * config.perKm) + (durationMin * config.perMinute)
  const subtotalConMinimo = Math.max(subtotal, config.minimumFare)
  
  const totalPassengerPays = roundToNearest500(subtotalConMinimo * surgeMultiplier)
  const platformFee = 0
  const driverReceives = totalPassengerPays

  return {
    subtotal,
    subtotalConMinimo,
    totalPassengerPays,
    platformFee,
    driverReceives,
    distanceKm,
    durationMin,
  }
}
