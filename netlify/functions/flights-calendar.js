// Proxies Travelpayouts' month-matrix endpoint so the API token never reaches
// the browser. Client calls:
// /.netlify/functions/flights-calendar?origin=MAN&destination=FAO&month=2026-09-01&currency=gbp
// and gets back a clean { origin, destination, currency, month, prices: [{date, price, directOnly, foundAt}] } object.
//
// Note: this gives the *cheapest fare seen* per day for the route — not a live
// list of specific flights/airlines/times. That level of detail isn't
// available from this API; the point of this endpoint is the monthly price
// calendar. Booking click-through happens on Aviasales/Expedia's own site.
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
    const apiToken = process.env.TRAVELPAYOUTS_API_TOKEN
    if (!apiToken) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'TRAVELPAYOUTS_API_TOKEN not set' })
      }
    }

    const params = event.queryStringParameters || {}
    const origin = (params.origin || '').toUpperCase().trim()
    const destination = (params.destination || '').toUpperCase().trim()
    const currency = (params.currency || 'gbp').toLowerCase().trim()
    // month must be the first day of the month, YYYY-MM-DD
    let month = (params.month || '').trim()

    if (!origin || !destination) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Missing origin or destination' })
      }
    }
    if (!month) {
      // Default to the 1st of next month if not supplied
      const d = new Date()
      d.setMonth(d.getMonth() + 1)
      month = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'
    } else if (/^\d{4}-\d{2}$/.test(month)) {
      month = month + '-01'
    }

    const url = 'https://api.travelpayouts.com/v2/prices/month-matrix' +
      '?currency=' + encodeURIComponent(currency) +
      '&origin=' + encodeURIComponent(origin) +
      '&destination=' + encodeURIComponent(destination) +
      '&month=' + encodeURIComponent(month) +
      '&show_to_affiliates=false' +
      '&token=' + apiToken

    const response = await fetch(url)
    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Travelpayouts request failed' })
      }
    }

    const data = await response.json()
    if (!data || data.success === false || !Array.isArray(data.data)) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination, currency, month, prices: [] })
      }
    }

    const prices = data.data
      .filter(function (row) { return row && row.depart_date && typeof row.value === 'number' && row.value > 0 })
      .map(function (row) {
        return {
          date: row.depart_date,
          price: row.value,
          directOnly: row.number_of_changes === 0,
          foundAt: row.found_at || null
        }
      })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1 })

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        // Prices don't need to be second-fresh — cache for a few hours at the CDN
        'Cache-Control': 'public, max-age=10800'
      },
      body: JSON.stringify({ origin, destination, currency, month, prices: prices })
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Error: ' + err.message })
    }
  }
}
