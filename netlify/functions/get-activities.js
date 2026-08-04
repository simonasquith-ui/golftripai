// netlify/functions/get-activities.js
// Searches Viator's Partner API for things-to-do near a destination.
// Used on the results page for the "Things To Do" section (non-golf activities
// for partners/family members, or rest days). Viator is an affiliate integration —
// booking happens on viator.com, and the productUrl returned already includes
// Simon's tracking parameters (pid/mcid), so it must be used exactly as-is, unmodified.

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
    };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const destination = (event.queryStringParameters && event.queryStringParameters.destination || '').trim();
    if (!destination) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Missing destination' })
      };
    }

    const apiKey = process.env.VIATOR_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Viator API key not configured' })
      };
    }

    // Use just the first part of the destination string (e.g. "Marbella" from
    // "Marbella, Costa del Sol, Spain") — freetext search works best on a
    // simple place name rather than a long descriptive string.
    const searchTerm = destination.split(',')[0].trim();

    const viatorRes = await fetch('https://api.viator.com/partner/search/freetext', {
      method: 'POST',
      headers: {
        'exp-api-key': apiKey,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-GB',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        searchTerm: searchTerm,
        currency: 'GBP',
        searchTypes: [
          {
            searchType: 'PRODUCTS',
            pagination: { start: 1, count: 6 }
          }
        ]
      })
    });

    if (!viatorRes.ok) {
      const errText = await viatorRes.text();
      console.error('Viator API error:', viatorRes.status, errText);
      return {
        statusCode: 200, // fail soft — front end just hides the section
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ activities: [] })
      };
    }

    const data = await viatorRes.json();
    console.log('Viator raw response (for debugging field names):', JSON.stringify(data).slice(0, 2000));

    const rawProducts = (data.products && data.products.results) || data.products || [];

    const activities = rawProducts.slice(0, 6).map(function (p) {
      const image = (p.images && p.images[0] && (
        (p.images[0].variants && p.images[0].variants[0] && p.images[0].variants[0].url) ||
        p.images[0].url
      )) || null;
      const rating = (p.reviews && (p.reviews.combinedAverageRating || p.reviews.averageRating)) || null;
      const price = (p.pricing && (p.pricing.summary && p.pricing.summary.fromPrice)) || p.fromPrice || null;
      return {
        title: p.title || p.name || 'Activity',
        image: image,
        rating: rating,
        price: price,
        url: p.productUrl || p.webURL || null // includes Viator's own tracking params — do not modify
      };
    }).filter(function (a) { return a.url; });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ activities: activities })
    };

  } catch (err) {
    console.error('get-activities error:', err.message);
    return {
      statusCode: 200, // fail soft
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ activities: [] })
    };
  }
};
