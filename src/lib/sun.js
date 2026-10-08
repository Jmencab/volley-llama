import { pacificYmd } from './dates'

// Sunset in Seattle on the Pacific calendar day containing `d`. This is the
// standard sunrise equation (NOAA's simplified form), good to a minute or two —
// plenty for "will we need the lights".
const LAT = 47.6062
const LNG = -122.3321
const rad = Math.PI / 180
const J2000 = 2451545
const UNIX_EPOCH_JD = 2440587.5

export function sunsetOn(d) {
  const [y, m, day] = pacificYmd(d)
  const jdMidnight = Date.UTC(y, m - 1, day) / 86400000 + UNIX_EPOCH_JD
  const n = Math.ceil(jdMidnight - J2000 + 0.0008)
  const jStar = n - LNG / 360
  const M = (357.5291 + 0.98560028 * jStar) % 360
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad)
  const lambda = (M + C + 180 + 102.9372) % 360
  const transit = J2000 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad)
  const sinDec = Math.sin(lambda * rad) * Math.sin(23.4397 * rad)
  const cosDec = Math.cos(Math.asin(sinDec))
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(LAT * rad) * sinDec) / (Math.cos(LAT * rad) * cosDec)
  const w = Math.acos(cosW) / rad
  return new Date((transit + w / 360 - UNIX_EPOCH_JD) * 86400000)
}

// Minutes of a session that fall after sunset (0 if it's done in daylight).
// Tennis gets hard to see well before full dark, so callers treat any overlap
// as "needs lights".
export const minutesAfterSunset = (start, end) => {
  const set = sunsetOn(start).getTime()
  return Math.max(0, Math.round((end.getTime() - Math.max(set, start.getTime())) / 60000))
}
