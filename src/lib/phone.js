// The database stores every phone as E.164 (+12065550134). These shape it for
// people to read and for the apps that open a chat.

export const phoneDigits = (p) => (p || '').replace(/\D/g, '')

export function formatPhone(p) {
  const d = phoneDigits(p)
  return p?.startsWith('+1') && d.length === 11 ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : p || ''
}

// wa.me wants the full international number as bare digits.
export const whatsappLink = (p, text) =>
  `https://wa.me/${phoneDigits(p)}${text ? `?text=${encodeURIComponent(text)}` : ''}`

// iOS reads the body after "&", Android after "?"; "?&body=" satisfies both.
export const smsLink = (p, text) => `sms:${p}${text ? `?&body=${encodeURIComponent(text)}` : ''}`
