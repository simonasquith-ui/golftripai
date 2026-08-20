/**
 * send-club-invite.js
 *
 * Sends a golf club's invitation to a prospective member.
 *
 * The club is offering GolfTrip to its members as a free membership benefit,
 * so the email is club-branded (logo / primary colour) rather than GolfTrip-branded,
 * with GolfTrip credited in the footer as the sending platform.
 *
 * POST body:
 *   toEmail         (required) recipient address
 *   clubName        (required) display name of the club
 *   inviteUrl       (required) https:// link to the club's signup route
 *   inviterName     (optional) e.g. the club secretary
 *   clubLogoUrl     (optional) https:// image URL, replaces the serif club name
 *   primaryColor    (optional) #rrggbb, used for the header band
 *   tagline         (optional) short club strapline under the header
 *   personalMessage (optional) free text, rendered in a quoted block
 *
 * Env: RESEND_API_KEY
 */

// Brand palette (fallbacks when the club supplies no colour of its own)
const BRAND = {
  green: '#1a3a2a',
  greenDeep: '#0f2318',
  gold: '#c9a84c',
  paper: '#f7f4ee',
  border: '#d4c9b0',
  muted: '#6b7280'
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

// Deliberately permissive but structural: no spaces, one @, a dotted TLD.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Escape a user-supplied string before it lands in HTML.
 *
 * Every field on this endpoint is attacker-controllable — anyone who finds the
 * function URL can POST arbitrary clubName / inviterName / tagline /
 * personalMessage values. Without escaping, those become markup (or an attribute
 * break-out) inside the rendered email.
 */
function esc (value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Only https:// links are allowed — blocks javascript:, data:, mailto: injection. */
function isHttpsUrl (value) {
  return typeof value === 'string' && /^https:\/\/\S+$/i.test(value.trim())
}

/** Accept a plain hex colour only; anything else falls back to the brand green. */
function safeColor (value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.trim())
    ? value.trim()
    : fallback
}

const json = (statusCode, payload) => ({
  statusCode,
  headers: { ...CORS, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  try {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      return json(500, { error: 'RESEND_API_KEY not set' })
    }

    const {
      toEmail,
      clubName,
      inviteUrl,
      inviterName,
      clubLogoUrl,
      primaryColor,
      tagline,
      personalMessage
    } = JSON.parse(event.body || '{}')

    // --- validation -------------------------------------------------------
    if (!toEmail || !clubName || !inviteUrl) {
      return json(400, { error: 'Missing required fields: toEmail, clubName, inviteUrl' })
    }

    if (!EMAIL_RE.test(String(toEmail).trim())) {
      return json(400, { error: 'Invalid toEmail' })
    }

    if (!isHttpsUrl(inviteUrl)) {
      return json(400, { error: 'inviteUrl must be an https:// URL' })
    }

    // --- safe values for the template ------------------------------------
    const recipient = String(toEmail).trim()
    const headerColor = safeColor(primaryColor, BRAND.green)
    const safeClubName = esc(clubName)
    const safeInviter = esc(inviterName)
    const safeTagline = esc(tagline)
    const safeMessage = esc(personalMessage)
    const safeInviteUrl = esc(inviteUrl.trim())
    // A logo that is not https is simply dropped — we fall back to the wordmark.
    const safeLogoUrl = isHttpsUrl(clubLogoUrl) ? esc(clubLogoUrl.trim()) : ''

    const headerInner = safeLogoUrl
      ? `<img src="${safeLogoUrl}" alt="${safeClubName}" style="max-height:56px;max-width:240px;display:block;margin:0 auto" />`
      : `<h1 style="color:#ffffff;font-family:Georgia,serif;margin:0;font-size:26px;letter-spacing:0.3px">${safeClubName}</h1>`

    const taglineBlock = safeTagline
      ? `<p style="color:rgba(255,255,255,0.82);font-size:13px;margin:10px 0 0;font-family:Arial,sans-serif">${safeTagline}</p>`
      : ''

    const introLine = safeInviter
      ? `<strong style="color:${BRAND.green}">${safeInviter}</strong> has invited you to join <strong style="color:${BRAND.green}">${safeClubName}</strong> on GolfTrip.`
      : `<strong style="color:${BRAND.green}">${safeClubName}</strong> has invited you to join them on GolfTrip.`

    const messageBlock = safeMessage
      ? `<blockquote style="margin:24px 0;padding:16px 20px;background:${BRAND.paper};border-left:4px solid ${BRAND.gold};border-radius:0 8px 8px 0">
             <p style="color:${BRAND.greenDeep};font-size:15px;line-height:1.6;margin:0;font-style:italic">&ldquo;${safeMessage}&rdquo;</p>
           </blockquote>`
      : ''

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:${BRAND.paper};padding:40px 20px">

        <div style="background:${headerColor};padding:28px 24px;border-radius:12px;text-align:center;margin-bottom:24px">
          ${headerInner}
          ${taglineBlock}
        </div>

        <div style="background:#ffffff;padding:32px;border-radius:12px;border:1px solid ${BRAND.border}">
          <h2 style="color:${BRAND.green};font-family:Georgia,serif;margin-top:0;font-size:23px;line-height:1.3">
            Your golf trip planner, free with your membership
          </h2>

          <p style="color:${BRAND.muted};font-size:16px;line-height:1.6">${introLine}</p>

          <p style="color:${BRAND.muted};font-size:16px;line-height:1.6">
            GolfTrip is how members plan golf trips together &mdash; build an itinerary, compare
            courses and tee times, split costs and keep the whole group in one place.
            <strong style="color:${BRAND.green}">${safeClubName} covers the cost for you as a member,
            so it is completely free to use.</strong>
          </p>

          ${messageBlock}

          <div style="text-align:center;margin:32px 0">
            <a href="${safeInviteUrl}" style="background:${BRAND.gold};color:${BRAND.greenDeep};padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">
              Join ${safeClubName} on GolfTrip
            </a>
          </div>

          <p style="color:#9ca3af;font-size:13px;text-align:center;margin:0">
            No payment details needed &mdash; your club has already covered your access.
          </p>
        </div>

        <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:20px;line-height:1.6">
          Sent on behalf of ${safeClubName} via GolfTrip.<br />
          If you did not expect this invitation, you can safely ignore this email.
        </p>
      </div>
    `

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: 'GolfTrip <onboarding@resend.dev>',
        to: [recipient],
        // Subject is plain text, not HTML — strip newlines so a crafted clubName
        // cannot inject extra headers.
        subject: `${String(clubName).replace(/[\r\n]+/g, ' ').trim()} has invited you to GolfTrip`,
        html
      })
    })

    const data = await res.json()

    if (!res.ok) {
      return json(500, { error: 'Resend error: ' + JSON.stringify(data) })
    }

    return json(200, { success: true, id: data.id })

  } catch (err) {
    return json(500, { error: err.message })
  }
}
