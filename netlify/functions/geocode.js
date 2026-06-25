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

  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'GOOGLE_PLACES_API_KEY not set' })
      }
    }

    const { query, type } = JSON.parse(event.body)
    if (!query) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'No query provided' })
      }
    }

    // Use Google Places Text Search API
    const url = 'https://maps.googleapis.com/maps/api/place/textsearch/json' +
      '?query=' + encodeURIComponent(query) +
      '&key=' + apiKey +
      (type === 'course' ? '&type=establishment' : '')

    const response = await fetch(url)
    const data = await response.json()

    if (data.status !== 'OK' || !data.results || !data.results.length) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No results found', status: data.status })
      }
    }

    const place = data.results[0]
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
        name: place.name,
        address: place.formatted_address,
        rating: place.rating || null,
        place_id: place.place_id
      })
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    }
  }
}
