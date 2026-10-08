// Tabs sit left-to-right, so a page should arrive from the side it lives on.
// Detail pages rank a half-step past their tab: opening one reads as "forward",
// coming back reads as "back". Anything unknown ranks with Home.
const RANK = [
  [/^\/captain\/./, 4.5],
  [/^\/captain/, 4],
  [/^\/team/, 3],
  [/^\/practice/, 2],
  [/^\/match\//, 1.5],
  [/^\/schedule/, 1],
]
export const routeRank = (path) => RANK.find(([re]) => re.test(path))?.[1] ?? 0

// '' on first paint (plain fade), else 'fwd' | 'back' | '' for a same-rank hop
export function slideDirection(from, to) {
  if (from == null) return ''
  const a = routeRank(from)
  const b = routeRank(to)
  return b > a ? 'fwd' : b < a ? 'back' : ''
}
