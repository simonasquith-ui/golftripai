// netlify/functions/stripe-webhook.js
// Handles Stripe webhook events — upgrades user plan in Supabase on payment

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
  const sig = event.headers['stripe-signature']
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  let stripeEvent
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret)
  } catch (err) {
    console.error('Webhook signature failed:', err.message)
    return { statusCode: 400, body: 'Webhook signature verification failed' }
  }

  // Supabase client (service role — can write to any table)
  const { createClient } = require('@supabase/supabase-js')
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  try {
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object
      const userId = session.metadata && session.metadata.userId
      const plan = session.metadata && session.metadata.plan
      const customerId = session.customer
      const subscriptionId = session.subscription

      if (userId && plan) {
        await supabase.from('user_plans').upsert({
          user_id: userId,
          plan: plan,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status: 'active',
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })
        console.log('Plan upgraded:', userId, plan)
      }
    }

    if (stripeEvent.type === 'customer.subscription.deleted') {
      const sub = stripeEvent.data.object
      const userId = sub.metadata && sub.metadata.userId
      if (userId) {
        await supabase.from('user_plans').update({
          plan: 'free',
          status: 'cancelled',
          updated_at: new Date().toISOString()
        }).eq('user_id', userId)
        console.log('Plan cancelled:', userId)
      }
    }

    if (stripeEvent.type === 'invoice.payment_failed') {
      const invoice = stripeEvent.data.object
      const customerId = invoice.customer
      const { data } = await supabase.from('user_plans')
        .select('user_id').eq('stripe_customer_id', customerId).single()
      if (data) {
        await supabase.from('user_plans').update({
          status: 'payment_failed',
          updated_at: new Date().toISOString()
        }).eq('user_id', data.user_id)
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) }

  } catch (err) {
    console.error('Webhook handler error:', err.message)
    return { statusCode: 500, body: 'Webhook handler failed' }
  }
}
