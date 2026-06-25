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
    const apiKey = process.env.OPENAI_API_KEY

    if (!apiKey) {
      console.log('ERROR: OPENAI_API_KEY not set')
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'OPENAI_API_KEY environment variable is not set' })
      }
    }

    const body = JSON.parse(event.body)
    const { prompt } = body

    console.log('Prompt received, length:', prompt ? prompt.length : 'undefined')

    if (!prompt) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'No prompt provided' })
      }
    }

    console.log('Calling OpenAI API...')

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert golf travel consultant specialising in holidays for UK golfers. Always respond with valid JSON only. No markdown, no backticks, no explanation before or after the JSON. Never use smart quotes or apostrophes inside JSON string values — use standard ASCII only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.5,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      })
    })

    console.log('OpenAI response status:', response.status)

    const data = await response.json()

    if (!response.ok) {
      console.log('OpenAI error:', JSON.stringify(data))
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'OpenAI API error ' + response.status + ': ' + (data.error?.message || JSON.stringify(data))
        })
      }
    }

    if (!data.choices || !data.choices[0]) {
      console.log('No choices in response:', JSON.stringify(data))
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'No response from OpenAI' })
      }
    }

    console.log('Response received, finish_reason:', data.choices[0].finish_reason)
    console.log('Response length:', data.choices[0].message.content.length)

    let result = data.choices[0].message.content.trim()

    // Validate JSON
    try {
      JSON.parse(result)
      console.log('JSON validation passed')
    } catch(parseErr) {
      console.log('JSON parse error:', parseErr.message)
      // Try to repair
      result = result.replace(/,\s*([}\]])/g, '$1')
      try {
        JSON.parse(result)
        console.log('JSON repair succeeded')
      } catch(e) {
        return {
          statusCode: 500,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'AI returned invalid JSON. Please try again.' })
        }
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
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
