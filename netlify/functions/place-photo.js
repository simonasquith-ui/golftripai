// Proxies Google's Place Photo endpoint so the API key never reaches the
// browser. Client calls: /.netlify/functions/place-photo?ref=<photo_reference>&maxwidth=400
// and gets the actual image bytes back directly (safe to use as an <img src>).
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: ''
    }
  }

  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: 'GOOGLE_PLACES_API_KEY not set'
      }
    }

    const params = event.queryStringParameters || {}
    const ref = params.ref
    const maxwidth = params.maxwidth || '400'
    if (!ref) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: 'Missing ref'
      }
    }

    const url = 'https://maps.googleapis.com/maps/api/place/photo' +
      '?maxwidth=' + encodeURIComponent(maxwidth) +
      '&photo_reference=' + encodeURIComponent(ref) +
      '&key=' + apiKey

    const response = await fetch(url)
    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: 'Photo fetch failed'
      }
    }

    const arrayBuffer = await response.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': response.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=604800' // cache 7 days — photos rarely change
      },
      body: base64,
      isBase64Encoded: true
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'Error: ' + err.message
    }
  }
}
