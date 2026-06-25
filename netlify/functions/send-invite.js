exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  try {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'RESEND_API_KEY not set' })
      }
    }

    const { toEmail, inviterName, destination, inviteUrl } = JSON.parse(event.body)

    if (!toEmail || !inviteUrl) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Missing required fields' })
      }
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: 'GolfTrip <invites@yourdomain.com>',
        to: [toEmail],
        subject: `${inviterName || 'Someone'} invited you to a golf trip!`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f7f4ee;padding:40px 20px">
            <div style="background:#1a3a2a;padding:24px;border-radius:12px;text-align:center;margin-bottom:24px">
              <h1 style="color:#c9a84c;font-family:Georgia,serif;margin:0;font-size:28px">GolfTrip</h1>
            </div>
            <div style="background:#ffffff;padding:32px;border-radius:12px;border:1px solid #d4c9b0">
              <h2 style="color:#1a3a2a;font-family:Georgia,serif;margin-top:0">You have been invited to a golf trip!</h2>
              <p style="color:#6b7280;font-size:16px;line-height:1.6">
                <strong style="color:#1a3a2a">${inviterName || 'A fellow golfer'}</strong> has invited you to join their golf trip${destination ? ' to <strong>' + destination + '</strong>' : ''}.
              </p>
              <p style="color:#6b7280;font-size:16px;line-height:1.6">
                Click the button below to view the itinerary, vote on options and join the group chat.
              </p>
              <div style="text-align:center;margin:32px 0">
                <a href="${inviteUrl}" style="background:#c9a84c;color:#0f2318;padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">
                  View Golf Trip ⛳
                </a>
              </div>
              <p style="color:#9ca3af;font-size:13px;text-align:center;margin-bottom:0">
                If you did not expect this invitation, you can ignore this email.
              </p>
            </div>
            <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:20px">
              Sent via GolfTrip &mdash; AI-powered golf holiday planning
            </p>
          </div>
        `
      })
    })

    const data = await res.json()

    if (!res.ok) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Resend error: ' + JSON.stringify(data) })
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ success: true, id: data.id })
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    }
  }
}
