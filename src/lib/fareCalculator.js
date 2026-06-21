// Configuración de tarifas competitivas en Guaraníes (Gs) para Paraguay
// Precios tipo Bolt - 1.000 Gs. (descuento competitivo)

const COMPETITIVE_DISCOUNT_GS = 1000
const ROUND_TO_GS = 500

export const FARE_CONFIG = {
  moto: {
    minimumFare: 10000, // mínimo ANTES de descuento competitivo
    baseFare: 5000,
    perKm: 2500,
    perMinute: 250,
  },
  auto_standard: { // Auto Normal / Todos / Ella
    minimumFare: 14000,
    baseFare: 7000,
    perKm: 3200,
    perMinute: 350,
  },
  ella: { // Ella usa misma base que Auto Normal, recargo máximo +1.000 antes del descuento
    minimumFare: 15000,
    baseFare: 8000,
    perKm: 3200,
    perMinute: 350,
  },
  comfort: {
    minimumFare: 17000,
    baseFare: 9000,
    perKm: 3800,
    perMinute: 400,
  },
  premium: {
    minimumFare: 22000,
    baseFare: 12000,
    perKm: 4500,
    perMinute: 500,
  },
}

// Mínimos finales después del descuento competitivo
const MINIMUM_FINAL = {
  moto: 9000,
  auto_standard: 13000,
  ella: 13000,
  comfort: 16000,
  premium: 21000,
}

/**
 * Redondea un valor al múltiplo de ROUND_TO_GS más cercano.
 */
export function roundToNearest500(value) {
  return Math.round(value / ROUND_TO_GS) * ROUND_TO_GS
}

/**
 * Calcula la tarifa competitiva para un viaje.
 * Precio = (base + distancia + tiempo) → redondear a 500 → aplicar descuento -1.000 Gs. → mínimo final
 * 
 * @param {string} category Categoría del viaje (moto, auto_standard, ella, comfort, premium)
 * @param {number} distanceMeters Distancia en metros
 * @param {number} durationSeconds Duración en segundos
 */
export function calculateFare(category, distanceMeters, durationSeconds, surgeMultiplier = 1) {
  let catKey = String(category).toLowerCase().trim()
  if (catKey === 'all') {
    catKey = 'auto_standard'
  }

  const config = FARE_CONFIG[catKey] || FARE_CONFIG.auto_standard
  const minFinal = MINIMUM_FINAL[catKey] || MINIMUM_FINAL.auto_standard

  const distanceKm = (distanceMeters || 0) / 1000
  const durationMin = (durationSeconds || 0) / 60

  // Cálculo base antes de descuento
  const baseFare = config.baseFare
  const distanceFare = distanceKm * config.perKm
  const timeFare = durationMin * config.perMinute
  const subtotal = baseFare + distanceFare + timeFare

  // Aplicar mínimo antes de descuento
  const subtotalConMinimo = Math.max(subtotal, config.minimumFare)

  // Redondear a 500
  const roundedBeforeDiscount = roundToNearest500(subtotalConMinimo * surgeMultiplier)

  // Aplicar descuento competitivo
  const afterDiscount = roundedBeforeDiscount - COMPETITIVE_DISCOUNT_GS

  // Aplicar mínimo final
  const totalPassengerPays = Math.max(afterDiscount, minFinal)

  return {
    subtotal,
    subtotalConMinimo,
    totalPassengerPays,
    distanceKm,
    durationMin,
    breakdown: {
      baseFare,
      distanceFare,
      timeFare,
      beforeDiscount: roundedBeforeDiscount,
      competitiveDiscount: COMPETITIVE_DISCOUNT_GS,
      roundedTotal: totalPassengerPays,
    },
  }
}