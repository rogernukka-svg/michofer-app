const LOCAL_PLACES_URL = '/data/michofer_buscador_alto_parana.csv'

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCsvLine(line) {
  const cells = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && quoted && next === '"') {
      current += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }

  cells.push(current)
  return cells
}

function parseCsv(text) {
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean)
  const headers = parseCsvLine(headerLine)

  return lines.map((line) => {
    const values = parseCsvLine(line)
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || ''
      return row
    }, {})
  })
}

function scoreField(query, value, weight) {
  const text = normalize(value)
  if (!query || !text) return 0
  if (text === query) return weight + 180
  if (text.startsWith(query)) return weight + 110
  if (text.includes(query)) return weight + 55

  const tokens = text.split(' ')
  if (tokens.some((token) => token.startsWith(query))) return weight + 44
  if (query.length >= 3 && tokens.every((token) => query.includes(token[0]))) return weight + 16
  return 0
}

function placeKey(place) {
  return normalize(`${place.nombreOficial}-${place.categoria}-${place.ciudad}`)
}

export async function loadLocalPlaces() {
  const response = await fetch(LOCAL_PLACES_URL)
  if (!response.ok) throw new Error('No se pudo cargar el buscador local')

  const rows = parseCsv(await response.text())

  return rows.map((row) => {
    const lat = row.lat === '' ? null : Number(row.lat)
    const lng = row.lng === '' ? null : Number(row.lng)

    return {
    id: row.id,
    nombreOficial: row.nombre_oficial,
    alias: row.alias_busqueda,
    categoria: row.categoria,
    ciudad: row.ciudad,
    tipo: row.tipo_busqueda,
    prioridad: Number(row.prioridad || 0),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    fuente: row.fuente,
    notas: row.notas,
    searchBlob: normalize(`${row.alias_busqueda} ${row.nombre_oficial} ${row.categoria} ${row.ciudad}`),
    }
  })
}

export function getPlaceTitle(place) {
  return place?.nombreOficial || place?.alias || ''
}

export function getPlaceSubtitle(place) {
  const alias = normalize(place?.alias) !== normalize(place?.nombreOficial) ? place?.alias : ''
  const parts = [alias, place?.categoria?.replace(/_/g, ' '), place?.ciudad].filter(Boolean)
  return parts.join(' · ')
}

export function getPlaceSearchText(place) {
  const title = getPlaceTitle(place)
  const city = place?.ciudad && normalize(place.ciudad) !== normalize(title) ? place.ciudad : 'Alto Parana'
  const alias = place?.alias && normalize(place.alias) !== normalize(title) ? `${place.alias}, ` : ''
  return `${alias}${title}, ${city}, Paraguay`
}

export function searchLocalPlaces(query, places, limit = 6) {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery || !Array.isArray(places)) return []

  const bestByPlace = new Map()

  places.forEach((place) => {
    const textScore =
      scoreField(normalizedQuery, place.alias, 220) +
      scoreField(normalizedQuery, place.nombreOficial, 190) +
      scoreField(normalizedQuery, place.ciudad, 70) +
      scoreField(normalizedQuery, place.categoria, 26)

    if (!textScore && !place.searchBlob.includes(normalizedQuery)) return

    const categoryBoost = ['ciudad', 'punto_referencia', 'barrio_zona', 'calle_avenida'].includes(place.categoria)
      ? 28
      : 0
    const score = textScore + Number(place.prioridad || 0) + categoryBoost
    const key = placeKey(place)
    const previous = bestByPlace.get(key)

    if (!previous || score > previous.score) {
      bestByPlace.set(key, { ...place, score })
    }
  })

  return Array.from(bestByPlace.values())
    .sort((a, b) => b.score - a.score || Number(b.prioridad || 0) - Number(a.prioridad || 0))
    .slice(0, limit)
}
