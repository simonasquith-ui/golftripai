// netlify/functions/extract-venue.js
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
    const openaiKey = process.env.OPENAI_API_KEY
    const { url, query } = JSON.parse(event.body || '{}')
    if (!url && !query) {
      return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'No URL or query provided' }) }
    }

    let pageContent = ''
    let fetchedOk = false

    if (url) {
      // Try multiple user agents — some sites block default fetch but allow browser UA
      const agents = [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'GolfTrip/1.0'
      ]
      for (const agent of agents) {
        try {
          const pageRes = await fetch(url, {
            headers: { 'User-Agent': agent, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-GB,en;q=0.9' },
            signal: AbortSignal.timeout(8000)
          })
          if (pageRes.ok) {
            const html = await pageRes.text()
            // Extract meaningful content — prioritise structured data
            const jsonLd = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []).join(' ')
            const metaTags = (html.match(/<meta[^>]+>/gi) || []).join(' ')
            const bodyText = html
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 6000)
            pageContent = jsonLd.slice(0, 2000) + ' ' + metaTags.slice(0, 1000) + ' ' + bodyText
            fetchedOk = true
            console.log('Fetched with agent:', agent.slice(0, 30), 'content length:', pageContent.length)
            break
          }
        } catch(e) { console.log('Agent failed:', e.message) }
      }
    }

    const isUrl = !!url
    const prompt = isUrl
      ? `Extract venue details from this web page. Return JSON only.

URL: ${url}
Page content: ${pageContent || 'Could not fetch page — use URL domain and path to infer venue details'}

Return JSON:
{
  "name": "exact venue name",
  "type": "hotel|course|restaurant|car_hire|other",
  "location": "city, country",
  "price": 0,
  "price_display": "price string e.g. £185/round or null",
  "rating": null,
  "description": "one sentence max",
  "booking_url": "${url}",
  "lat": null,
  "lng": null
}
IMPORTANT: For lat/lng — if you know this venue's real-world GPS coordinates from your training data, include them as decimal numbers. E.g. Quinta do Lago lat: 37.0539, lng: -8.0323. Leave null only if genuinely unknown.`
      : `Find the golf/travel venue: "${query}"
Return JSON:
{
  "name": "exact venue name",
  "type": "hotel|course|restaurant|car_hire|other",
  "location": "city, country",
  "price": 0,
  "price_display": "price if known or null",
  "rating": null,
  "description": "one sentence",
  "booking_url": null,
  "lat": null,
  "lng": null
}
IMPORTANT: Include real GPS coordinates (lat/lng as decimals) if you know this venue from your training data.`

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a golf and travel venue data extractor. Return valid JSON only. No markdown. Include GPS coordinates whenever you know them from training data.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      })
    })

    const aiData = await aiRes.json()
    if (!aiRes.ok) {
      return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: aiData.error?.message || 'AI extraction failed' }) }
    }

    const result = JSON.parse(aiData.choices[0].message.content)
    console.log('Extracted:', result.name, 'type:', result.type, 'lat:', result.lat, 'lng:', result.lng, 'fetched:', fetchedOk)

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue: result, fetchedOk })
    }
  } catch (err) {
    console.log('Exception:', err.message)
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: err.message }) }
  }
}
