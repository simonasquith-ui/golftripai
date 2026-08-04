// netlify/functions/create-portal-session.js
// Creates a Stripe Billing Portal session so a user can manage or cancel
// their own subscription (payment method, invoices, cancellation) without
// us building any of that UI ourselves.

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
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-03-31.basil' })
    const { createClient } = require('@supabase/supabase-js')
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

    const { userId } = JSON.parse(event.body || '{}')
    if (!userId) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Missing userId' })
      }
    }

    const { data, error } = await supabase
      .from('user_plans')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single()

    if (error || !data || !data.stripe_customer_id) {
      return {
        statusCode: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'No billing account found for this user' })
      }
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: 'https://gogolftrip.co.uk/?page=profile'
    })

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    }

  } catch (err) {
    console.error('create-portal-session error:', err.message)
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    }
  }
}
