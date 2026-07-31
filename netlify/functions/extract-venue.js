// netlify/functions/extract-venue.js
// Fetches a URL and uses OpenAI to extract venue details from the page HTML

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
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'No URL or search query provided' })
      }
    }

    let pageContent = ''

    if (url) {
      // Fetch the URL and extract readable text
      try {
        const pageRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; GolfTrip/1.0)',
            'Accept': 'text/html'
          },
          signal: AbortSignal.timeout(8000)
        })
        if (pageRes.ok) {
          const html = await pageRes.text()
          // Strip HTML tags and collapse whitespace — keep first 8000 chars for AI
          pageContent = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 8000)
        }
      } catch(fetchErr) {
        console.log('Page fetch failed:', fetchErr.message, '— using URL heuristics only')
        // Fall through to AI with just the URL string
        pageContent = `URL: ${url}`
      }
    }

    const prompt = url
      ? `Extract venue details from this web page content. Return JSON only.

URL: ${url}
Page content: ${pageContent}

Return a single JSON object with these fields:
{
  "name": "venue name",
  "type": "hotel|course|restaurant|car_hire|other",
  "location": "city, country",
  "price": "price as a number (per night for hotels, per round for courses, per day for car hire) — 0 if unknown",
  "price_display": "human readable price string e.g. £185/round or £420/night or 0 if unknown",
  "rating": "decimal rating e.g. 4.3 or null",
  "description": "one sentence description",
  "booking_url": "${url}",
  "lat": null,
  "lng": null
}
If you cannot determine a field, use null. Type must be one of: hotel, course, restaurant, car_hire, other.`
      : `I'm looking for a golf venue called "${query}". Return a single JSON object with these fields:
{
  "name": "venue name",
  "type": "hotel|course|restaurant|car_hire|other",
  "location": "city, country",
  "price": 0,
  "price_display": "price if known",
  "rating": null,
  "description": "one sentence description of this real venue",
  "booking_url": null,
  "lat": null,
  "lng": null
}
Use your knowledge of real golf venues worldwide. If unsure, use null for unknown fields.`

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a venue data extraction assistant. Return valid JSON only. No markdown, no backticks.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      })
    })

    const aiData = await aiRes.json()
    if (!aiRes.ok) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: aiData.error?.message || 'AI extraction failed' })
      }
    }

    const result = JSON.parse(aiData.choices[0].message.content)

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue: result })
    }

  } catch (err) {
    console.log('Exception:', err.message)
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    }
  }
}
