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
    const apiKey = process.env.GEMINI_API_KEY

    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'GEMINI_API_KEY environment variable is not set' })
      }
    }

    const { prompt } = JSON.parse(event.body)

    console.log('Calling Gemini API with key prefix:', apiKey.substring(0, 6))

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2000
          }
        })
      }
    )

    const data = await response.json()

    console.log('Gemini status:', response.status)
    console.log('Gemini response preview:', JSON.stringify(data).substring(0, 300))

    if (!response.ok) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'Gemini API error ' + response.status + ': ' + (data.error?.message || JSON.stringify(data))
        })
      }
    }

    if (!data.candidates || !data.candidates[0]) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'No response from Gemini: ' + JSON.stringify(data)
        })
      }
    }

    const result = data.candidates[0].content.parts[0].text

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ result })
    }

  } catch (err) {
    console.log('Function error:', err.message)
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    }
  }
}
