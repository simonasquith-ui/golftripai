// netlify/functions/create-checkout.js
// Creates a Stripe Checkout session for Pro or Society plan

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
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
    const { plan, userId, userEmail } = JSON.parse(event.body || '{}')

    if (!plan || !userId) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Missing plan or userId' })
      }
    }

    const priceId = plan === 'society'
      ? process.env.STRIPE_SOCIETY_PRICE_ID
      : process.env.STRIPE_PRO_PRICE_ID

    if (!priceId) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Price ID not configured' })
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://gogolftrip.co.uk/?payment=success&plan=' + plan,
      cancel_url: 'https://gogolftrip.co.uk/?payment=cancelled',
      customer_email: userEmail || undefined,
      metadata: {
        userId: userId,
        plan: plan
      },
      subscription_data: {
        metadata: {
          userId: userId,
          plan: plan
        }
      }
    })

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: session.url })
    }

  } catch (err) {
    console.error('Stripe checkout error:', err.message)
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    }
  }
}
