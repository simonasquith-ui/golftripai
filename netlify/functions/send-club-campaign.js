/**
 * send-club-campaign.js
 *
 * Sends one golf club marketing campaign (an advert for an upcoming trip) to many
 * recipients in a single invocation.
 *
 * POST body:
 *   recipients   (required) [{ email, name }] — non-empty, max 500 per invocation
 *   subject      (required) plain-text subject line
 *   clubName     (required) display name of the club
 *   preheader    (optional) inbox preview text
 *   heroImageUrl (optional) https:// banner image
 *   headline     (optional) serif headline above the body
 *   bodyHtml     (optional) rich HTML from the club's own composer — see SECURITY note
 *   ctaLabel     (optional) button label, defaults to "View the trip"
 *   ctaUrl       (optional) https:// button target (button hidden if absent/invalid)
 *   clubLogoUrl  (optional) https:// logo, replaces the serif club name in the band
 *   primaryColor (optional) #rrggbb header band colour
 *   replyTo      (optional) address replies go to, e.g. the club secretary
 *   tripDetails  (optional) { destination, dates, priceFrom, groupSize } → detail table
 *   campaignId   (optional) opaque id, echoed back for the client's send log
 *
 * Env: RESEND_API_KEY
 *
 * ---------------------------------------------------------------------------
 * PARTIAL-FAILURE CONTRACT
 * ---------------------------------------------------------------------------
 * This endpoint returns 200 whenever the request itself was valid, even if some
 * (or all) individual sends failed. The caller gets a per-recipient breakdown:
 *
 *   { ok, campaignId, results: [{ email, status: 'sent'|'failed', id, error }],
 *     totals: { sent, failed, total } }
 *
 * The client is expected to persist `results` so it knows exactly which addresses
 * to retry or suppress. A non-2xx is returned ONLY for:
 *   - validation errors (400)
 *   - a missing or completely unusable API key (500 / 401)
 * Anything else — a bad address, a bounced chunk, a Resend 4xx on one batch — is
 * reported inside `results`, never as a failed HTTP response.
 * ---------------------------------------------------------------------------
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Hard ceiling per invocation. Above this the client must batch across calls —
// keeps us inside the Netlify function timeout and Resend's rate limits.
const MAX_RECIPIENTS = 500

// Resend's batch endpoint accepts up to 100 message objects per request.
const BATCH_SIZE = 100

const FROM = 'GolfTrip <onboarding@resend.dev>'

/** Escape a user-supplied string before it lands in HTML. */
function esc (value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isHttpsUrl (value) {
  return typeof value === 'string' && /^https:\/\/\S+$/i.test(value.trim())
}

function safeColor (value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.trim())
    ? value.trim()
    : fallback
}

/**
 * SECURITY — bodyHtml is trusted-by-design.
 *
 * Unlike every other field here, bodyHtml is intentionally rich HTML produced by
 * the club's own campaign composer, so it is NOT escaped — escaping it would
 * render the markup as literal text. The authoritative sanitisation therefore has
 * to happen client-side in the composer (allow-list the tags/attributes the editor
 * can emit) before it is ever POSTed here.
 *
 * The stripping below is a defence-in-depth backstop only. It is a regex pass over
 * untrusted-shaped input and must not be relied on as the sole control: if this
 * endpoint is ever exposed without an authenticated club session, treat bodyHtml as
 * a stored-XSS vector and put a real sanitiser (e.g. DOMPurify server-side) here.
 */
function scrubRichHtml (html) {
  if (!html) return ''
  return String(html)
    // Drop script/iframe/object/embed/style blocks entirely, including content.
    .replace(/<\s*(script|iframe|object|embed|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // Drop the same tags when unclosed / self-closing.
    .replace(/<\s*\/?\s*(script|iframe|object|embed|style)\b[^>]*>/gi, '')
    // Strip inline event handlers: onclick=, onerror=, onload=, quoted or bare.
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    // Neutralise javascript:/vbscript:/data: URLs in href/src.
    .replace(/(href|src)\s*=\s*"\s*(javascript|vbscript|data):[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'\s*(javascript|vbscript|data):[^']*'/gi, "$1='#'")
    .replace(/(href|src)\s*=\s*(javascript|vbscript|data):[^\s>]+/gi, '$1="#"')
}

/**
 * Build the plain-text alternative from the rich HTML.
 * HTML-only campaigns are flagged as spam far more often, so every message gets
 * a text/plain part alongside it.
 */
function htmlToText (html) {
  if (!html) return ''
  return String(html)
    .replace(/<\s*(script|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|table|blockquote)\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Split an array into fixed-size chunks. */
function chunk (arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
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
      recipients,
      subject,
      clubName,
      preheader,
      heroImageUrl,
      headline,
      bodyHtml,
      ctaLabel,
      ctaUrl,
      clubLogoUrl,
      primaryColor,
      replyTo,
      tripDetails,
      campaignId
    } = JSON.parse(event.body || '{}')

    // --- validation (the only path that returns 400) -----------------------
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return json(400, { error: 'recipients must be a non-empty array' })
    }

    if (recipients.length > MAX_RECIPIENTS) {
      return json(400, {
        error: `Too many recipients: ${recipients.length}. Maximum ${MAX_RECIPIENTS} per invocation — batch client-side.`
      })
    }

    if (!subject || !clubName) {
      return json(400, { error: 'Missing required fields: subject, clubName' })
    }

    // --- split recipients into sendable vs. invalid ------------------------
    // Invalid addresses never reach Resend — they go straight into the failed
    // list so the client can clean its member data.
    const results = []
    const sendable = []

    for (const r of recipients) {
      const email = typeof r === 'string' ? r : (r && r.email)
      const name = (r && typeof r === 'object') ? r.name : ''
      const trimmed = String(email || '').trim()

      if (!EMAIL_RE.test(trimmed)) {
        results.push({
          email: trimmed || null,
          status: 'failed',
          id: null,
          error: 'Invalid email address'
        })
        continue
      }

      sendable.push({ email: trimmed, name: typeof name === 'string' ? name : '' })
    }

    // --- safe template values ---------------------------------------------
    const headerColor = safeColor(primaryColor, BRAND.green)
    const safeClubName = esc(clubName)
    const safeHeadline = esc(headline)
    const safePreheader = esc(preheader)
    const safeCtaLabel = esc(ctaLabel || 'View the trip')
    const safeCtaUrl = isHttpsUrl(ctaUrl) ? esc(ctaUrl.trim()) : ''
    const safeHeroUrl = isHttpsUrl(heroImageUrl) ? esc(heroImageUrl.trim()) : ''
    const safeLogoUrl = isHttpsUrl(clubLogoUrl) ? esc(clubLogoUrl.trim()) : ''
    const richBody = scrubRichHtml(bodyHtml)

    // reply_to is only set when it is genuinely an address — a malformed value
    // would otherwise get the whole batch rejected by Resend.
    const validReplyTo = replyTo && EMAIL_RE.test(String(replyTo).trim())
      ? String(replyTo).trim()
      : null

    // --- optional trip detail table ---------------------------------------
    let tripTable = ''
    if (tripDetails && typeof tripDetails === 'object') {
      const rows = [
        ['Destination', tripDetails.destination],
        ['Dates', tripDetails.dates],
        ['From', tripDetails.priceFrom],
        ['Group size', tripDetails.groupSize]
      ]
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
        .map(([label, v]) => `
              <tr>
                <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};color:${BRAND.muted};font-size:14px;width:40%">${esc(label)}</td>
                <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};color:${BRAND.green};font-size:14px;font-weight:700">${esc(v)}</td>
              </tr>`)
        .join('')

      if (rows) {
        tripTable = `
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:26px 0;background:${BRAND.paper};border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden">
            ${rows}
          </table>`
      }
    }

    const headerInner = safeLogoUrl
      ? `<img src="${safeLogoUrl}" alt="${safeClubName}" style="max-height:56px;max-width:240px;display:block;margin:0 auto" />`
      : `<h1 style="color:#ffffff;font-family:Georgia,serif;margin:0;font-size:26px;letter-spacing:0.3px">${safeClubName}</h1>`

    const heroBlock = safeHeroUrl
      ? `<img src="${safeHeroUrl}" alt="" style="display:block;width:100%;max-height:280px;object-fit:cover;border-radius:12px 12px 0 0" />`
      : ''

    const headlineBlock = safeHeadline
      ? `<h2 style="color:${BRAND.green};font-family:Georgia,serif;margin:0 0 16px;font-size:24px;line-height:1.3">${safeHeadline}</h2>`
      : ''

    const ctaBlock = safeCtaUrl
      ? `<div style="text-align:center;margin:32px 0 8px">
             <a href="${safeCtaUrl}" style="background:${BRAND.gold};color:${BRAND.greenDeep};padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">${safeCtaLabel}</a>
           </div>`
      : ''

    // Hidden preheader — controls the inbox preview line.
    const preheaderBlock = safePreheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${safePreheader}</div>`
      : ''

    /**
     * UNSUBSCRIBE GAP — MUST BE CLOSED BEFORE ANY VOLUME SENDING.
     *
     * {{unsubscribeUrl}} below is a literal placeholder, not a working link. There
     * is no unsubscribe route, no suppression list and no per-recipient token yet.
     * Before this is used for real campaigns it needs:
     *   1. a signed per-recipient unsubscribe token baked into the URL,
     *   2. a public route that records the opt-out against the club's member list,
     *   3. that suppression list consulted here so opted-out members are dropped,
     *   4. a List-Unsubscribe / List-Unsubscribe-Post header pair on the message.
     * Sending bulk marketing without a functioning opt-out breaches CAN-SPAM/UK GDPR
     * (PECR) and will wreck domain reputation.
     */
    const buildHtml = (greetingName) => {
      const greeting = greetingName
        ? `Hello ${esc(greetingName)},`
        : 'Hello,'

      return `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:${BRAND.paper};padding:40px 20px">
        ${preheaderBlock}

        <div style="background:${headerColor};padding:28px 24px;border-radius:12px;text-align:center;margin-bottom:24px">
          ${headerInner}
        </div>

        <div style="background:#ffffff;border-radius:12px;border:1px solid ${BRAND.border};overflow:hidden">
          ${heroBlock}
          <div style="padding:32px">
            ${headlineBlock}

            <p style="color:${BRAND.muted};font-size:16px;line-height:1.6;margin:0 0 16px">${greeting}</p>

            <div style="color:${BRAND.muted};font-size:16px;line-height:1.6">
              ${richBody}
            </div>

            ${tripTable}
            ${ctaBlock}
          </div>
        </div>

        <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:20px;line-height:1.7">
          You are receiving this because you are a member of ${safeClubName}.<br />
          <a href="{{unsubscribeUrl}}" style="color:#9ca3af;text-decoration:underline">Unsubscribe from ${safeClubName} trip emails</a><br />
          Sent on behalf of ${safeClubName} via GolfTrip.
        </p>
      </div>
      `
    }

    const bodyText = htmlToText(richBody)

    const buildText = (greetingName) => {
      const greeting = greetingName ? `Hello ${greetingName},` : 'Hello,'
      const detailLines = (tripDetails && typeof tripDetails === 'object')
        ? [
            tripDetails.destination ? `Destination: ${tripDetails.destination}` : '',
            tripDetails.dates ? `Dates: ${tripDetails.dates}` : '',
            tripDetails.priceFrom ? `From: ${tripDetails.priceFrom}` : '',
            tripDetails.groupSize ? `Group size: ${tripDetails.groupSize}` : ''
          ].filter(Boolean).join('\n')
        : ''

      return [
        headline || '',
        '',
        greeting,
        '',
        bodyText,
        detailLines ? '\n' + detailLines : '',
        safeCtaUrl ? `\n${ctaLabel || 'View the trip'}: ${String(ctaUrl).trim()}` : '',
        '',
        '---',
        `You are receiving this because you are a member of ${clubName}.`,
        'Unsubscribe: {{unsubscribeUrl}}',
        `Sent on behalf of ${clubName} via GolfTrip.`
      ].filter(l => l !== null && l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim()
    }

    const cleanSubject = String(subject).replace(/[\r\n]+/g, ' ').trim()

    /** One Resend message object per recipient, personalised by name. */
    const buildMessage = (r) => {
      const msg = {
        from: FROM,
        to: [r.email],
        subject: cleanSubject,
        html: buildHtml(r.name),
        text: buildText(r.name)
      }
      if (validReplyTo) msg.reply_to = validReplyTo
      return msg
    }

    // -----------------------------------------------------------------------
    // SENDING
    //
    // 1 recipient  -> POST /emails         (the batch endpoint is overkill)
    // 2+ recipients-> POST /emails/batch, chunked into groups of BATCH_SIZE (100,
    //                 Resend's per-request ceiling) and awaited SEQUENTIALLY.
    //
    // Sequential, not Promise.all: firing five 100-message batches concurrently
    // trips Resend's rate limiter and we lose whole chunks. One chunk at a time is
    // slower but every chunk's outcome is recorded.
    //
    // A chunk that fails marks only its own recipients as failed; the loop carries
    // on. The single exception is an auth failure (401/403) — that means the API key
    // is unusable, so we stop early and surface a real error rather than writing
    // hundreds of misleading per-recipient failures.
    // -----------------------------------------------------------------------
    let authFailure = null

    if (sendable.length === 1) {
      const r = sendable[0]
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(buildMessage(r))
        })
        const data = await res.json().catch(() => ({}))

        if (res.status === 401 || res.status === 403) {
          authFailure = 'Resend rejected the API key: ' + JSON.stringify(data)
        } else if (!res.ok) {
          results.push({
            email: r.email,
            status: 'failed',
            id: null,
            error: (data && data.message) || `Resend error ${res.status}`
          })
        } else {
          results.push({ email: r.email, status: 'sent', id: data.id || null, error: null })
        }
      } catch (err) {
        results.push({ email: r.email, status: 'failed', id: null, error: err.message })
      }

    } else if (sendable.length > 1) {
      const chunks = chunk(sendable, BATCH_SIZE)

      for (const group of chunks) {
        if (authFailure) break

        try {
          const res = await fetch('https://api.resend.com/emails/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(group.map(buildMessage))
          })

          const data = await res.json().catch(() => ({}))

          if (res.status === 401 || res.status === 403) {
            authFailure = 'Resend rejected the API key: ' + JSON.stringify(data)
            break
          }

          if (!res.ok) {
            // Whole chunk rejected — record every address in it as failed and move on.
            const reason = (data && data.message) || `Resend error ${res.status}`
            for (const r of group) {
              results.push({ email: r.email, status: 'failed', id: null, error: reason })
            }
            continue
          }

          // Success shape: { data: [{ id }, { id }, ...] } — index-aligned with the
          // array we sent, so we can map ids back to addresses positionally.
          const sentItems = Array.isArray(data.data) ? data.data : []
          group.forEach((r, i) => {
            const item = sentItems[i]
            if (item && item.id) {
              results.push({ email: r.email, status: 'sent', id: item.id, error: null })
            } else {
              results.push({
                email: r.email,
                status: 'failed',
                id: null,
                error: 'No id returned by Resend for this message'
              })
            }
          })

        } catch (err) {
          // Network/timeout on this chunk only.
          for (const r of group) {
            results.push({ email: r.email, status: 'failed', id: null, error: err.message })
          }
        }
      }
    }

    // A dead API key is one of the only non-validation conditions worth a non-200.
    if (authFailure) {
      return json(401, { error: authFailure, campaignId: campaignId || null })
    }

    const sent = results.filter(r => r.status === 'sent').length
    const failed = results.length - sent

    // 200 even on partial (or total) send failure — the breakdown is the payload.
    return json(200, {
      success: true,
      campaignId: campaignId || null,
      results,
      totals: { sent, failed, total: results.length }
    })

  } catch (err) {
    return json(500, { error: err.message })
  }
}
