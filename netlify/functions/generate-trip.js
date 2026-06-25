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
    if (!openaiKey) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'OPENAI_API_KEY not configured' })
      }
    }

    const { prompt, tier } = JSON.parse(event.body)
    if (!prompt) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'No prompt provided' })
      }
    }

    console.log('Tier:', tier, '| Prompt length:', prompt.length)

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are an expert golf travel consultant for UK golfers. Respond with valid JSON only. No markdown, no backticks, no text before or after the JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.5,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      })
    })

    const data = await response.json()

    if (!response.ok) {
      console.log('OpenAI error:', JSON.stringify(data))
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: data.error?.message || 'OpenAI error ' + response.status })
      }
    }

    const choice = data.choices[0]
    const result = choice.message.content.trim()
    console.log('Response length:', result.length, '| finish_reason:', choice.finish_reason)

    if (choice.finish_reason === 'length') {
      console.log('Token limit hit — response truncated')
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Response truncated. Please try again.' })
      }
    }

    try {
      JSON.parse(result)
    } catch(e) {
      console.log('JSON invalid:', e.message, '| First 300:', result.slice(0, 300))
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'AI returned invalid JSON. Please try again.' })
      }
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ result })
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
