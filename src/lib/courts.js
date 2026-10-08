// Seattle Parks' own list of public tennis courts, with whether each site has
// lights. It's the city's GIS layer (refreshed weekly) and answers browser
// requests directly, so there's nothing of ours to keep up to date.
const LAYER = 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Tennis_Courts/FeatureServer/0/query'
const FIELDS = 'NAME,ADDRESS,LIGHTS,BACKBOARD,NUMCOURTS,LATITUDE,LONGITUDE,RES1,RES2'

export const AREAS = {
  NW: 'Northwest', NC: 'North Central', NE: 'Northeast', CW: 'Central West',
  CE: 'Central', SC: 'South Central', SE: 'Southeast', SW: 'West Seattle',
}

// The city's reservation dashboard (opens in Power BI) and its booking site.
// Neither has an API we can call from the browser, so the app links out.
export const AVAILABILITY_DASHBOARD =
  'https://app.powerbigov.us/view?r=eyJrIjoiOGQzNjhlZmQtZmEzYS00MDcyLWFlY2UtOTBhY2RjZjFiZDIzIiwidCI6Ijc4ZTYxZTQ1LTZiZWItNDAwOS04Zjk5LTM1OWQ4YjU0ZjQxYiJ9&pageName=7c32fe1aeef375517069'
export const bookingUrl = (name) =>
  'https://anc.apm.activecommunities.com/seattle/reservation/search?resourceType=0&equipmentQty=0&keyword=' +
  encodeURIComponent(name.replace(/\s*\(.*\)\s*/g, ' ').trim())

let cached = null

export function loadCourts() {
  if (!cached) {
    const url = `${LAYER}?where=1%3D1&outFields=${FIELDS}&returnGeometry=false&f=json`
    cached = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => {
        if (d.error) throw new Error(d.error.message)
        return d.features
          .map(({ attributes: a }) => ({
            name: a.NAME.trim(),
            address: (a.ADDRESS || '').trim(),
            lights: a.LIGHTS === 'Yes',
            backboard: a.BACKBOARD === 'Yes',
            count: a.NUMCOURTS || 0,
            lat: a.LATITUDE,
            lng: a.LONGITUDE,
            area: (a.RES2 || '').trim(),
          }))
          .filter((c) => AREAS[c.area]) // DISC = discontinued
          .sort((x, y) => x.name.localeCompare(y.name))
      })
      .catch((e) => { cached = null; throw e }) // let the next visit retry
  }
  return cached
}

// Straight-line miles, for "near me".
export const milesBetween = (a, b) => {
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r
  const dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(h))
}

// The most recent lights report for each court name.
export const latestReports = (reports) => {
  const out = {}
  for (const r of reports) {
    if (!out[r.court] || r.reported_at > out[r.court].reported_at) out[r.court] = r
  }
  return out
}
