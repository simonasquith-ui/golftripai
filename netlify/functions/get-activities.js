// netlify/functions/get-activities.js
// Things To Do near a destination, via Viator's Partner API.
//
// Viator is an affiliate integration — booking happens on viator.com and the
// productUrl returned already carries the tracking parameters, so it is used
// exactly as returned, unmodified.
//
// WHY THIS WAS REWRITTEN
// The previous version failed soft on every single path: no API key, upstream
// 401, upstream 500, changed response shape — all returned {activities: []}
// with HTTP 200. The front end then hid the section. The result was a feature
// that could be completely broken while looking merely empty, with no way to
// tell the difference from outside.
//
// It still fails soft for real visitors (an empty Things To Do section is
// better than an error on a results page). But now:
//   - the reason is always logged
//   - ?debug=1 returns the actual diagnosis instead of an empty list
//   - two endpoint shapes are tried, because Viator has more than one
//
// To diagnose, open this in a browser while signed in to Netlify:
//   https://gogolftrip.co.uk/.netlify/functions/get-activities?destination=Sotogrande&debug=1

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

function json(statusCode, body) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// Viator has changed shape over time and the two endpoints disagree about
// where products live. Look in every place they have been known to appear
// rather than assuming one.
function extractProducts(data) {
  if (!data) return [];
  const candidates = [
    data.products && data.products.results,
    data.products,
    data.data,
    data.results,
    data.items
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
  }
  return [];
}

function normalise(p) {
  const image =
    (p.images && p.images[0] && (
      (p.images[0].variants && p.images[0].variants.length &&
        (p.images[0].variants[p.images[0].variants.length - 1].url || p.images[0].variants[0].url)) ||
      p.images[0].url
    )) ||
    p.thumbnailURL || p.primaryPhotoURL || null;

  const rating =
    (p.reviews && (p.reviews.combinedAverageRating || p.reviews.averageRating)) ||
    p.rating || null;

  const price =
    (p.pricing && p.pricing.summary && (p.pricing.summary.fromPrice ?? p.pricing.summary.fromPriceBeforeDiscount)) ??
    (p.pricing && p.pricing.fromPrice) ??
    p.fromPrice ?? null;

  return {
    title: p.title || p.name || p.productName || 'Activity',
    image,
    rating,
    price,
    duration: (p.duration && (p.duration.description || p.duration.fixedDurationInMinutes)) || null,
    url: p.productUrl || p.webURL || p.productURL || null
  };
}

async function tryEndpoint(url, apiKey, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'exp-api-key': apiKey,
      Accept: 'application/json;version=2.0',
      'Accept-Language': 'en-GB',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* keep raw */ }
  return { ok: res.ok, status: res.status, data, raw: text.slice(0, 600) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  const q = event.queryStringParameters || {};
  const destination = (q.destination || '').trim();
  const debug = q.debug === '1';
  const diagnostics = [];

  const fail = (reason, extra) => {
    console.error('[get-activities]', reason, extra ? JSON.stringify(extra).slice(0, 500) : '');
    // Real visitors get an empty list and the section hides itself.
    // ?debug=1 gets the truth.
    return debug
      ? json(200, { activities: [], ok: false, reason, diagnostics, ...(extra || {}) })
      : json(200, { activities: [] });
  };

  if (!destination) return json(400, { error: 'Missing destination' });

  const apiKey = process.env.VIATOR_API_KEY;
  if (!apiKey) {
    return fail('VIATOR_API_KEY is not set in this environment. Add it in Netlify → Site configuration → Environment variables.');
  }
  diagnostics.push('API key present (' + apiKey.slice(0, 4) + '…, length ' + apiKey.length + ')');

  // "Marbella" works far better than "Marbella, Costa del Sol, Spain".
  const searchTerm = destination.split(',')[0].trim();
  diagnostics.push('searchTerm: ' + searchTerm);

  try {
    // 1. The freetext endpoint this function has always used.
    let attempt = await tryEndpoint('https://api.viator.com/partner/search/freetext', apiKey, {
      searchTerm,
      currency: 'GBP',
      searchTypes: [{ searchType: 'PRODUCTS', pagination: { start: 1, count: 6 } }]
    });
    diagnostics.push('freetext → HTTP ' + attempt.status);

    let products = attempt.ok ? extractProducts(attempt.data) : [];

    // 2. Fall back to /products/search, which is the endpoint Viator's current
    //    affiliate documentation points at.
    if (!products.length) {
      const alt = await tryEndpoint('https://api.viator.com/partner/products/search', apiKey, {
        filtering: { destination: searchTerm },
        currency: 'GBP',
        pagination: { start: 1, count: 6 }
      });
      diagnostics.push('products/search → HTTP ' + alt.status);
      if (alt.ok) {
        const altProducts = extractProducts(alt.data);
        if (altProducts.length) { products = altProducts; attempt = alt; }
      } else if (!attempt.ok) {
        // Both failed — surface whichever error is more informative.
        return fail('Both Viator endpoints failed.', {
          freetext: { status: attempt.status, body: attempt.raw },
          productsSearch: { status: alt.status, body: alt.raw }
        });
      }
    }

    if (!attempt.ok && !products.length) {
      return fail('Viator returned HTTP ' + attempt.status, { body: attempt.raw });
    }

    const activities = products.slice(0, 6).map(normalise).filter(a => a.url);
    diagnostics.push('products found: ' + products.length + ', usable (with a URL): ' + activities.length);

    if (!activities.length) {
      return fail('Viator responded but returned no usable products for "' + searchTerm + '".', {
        sampleKeys: products.length ? Object.keys(products[0]).slice(0, 25) : [],
        body: attempt.raw
      });
    }

    return json(200, debug ? { activities, ok: true, diagnostics } : { activities });

  } catch (err) {
    return fail('Request threw: ' + err.message);
  }
};
