// TMDB proxy — keeps the API key server-side.
// Set TMDB_API_KEY in Netlify → Site settings → Environment variables.
exports.handler = async (event) => {
  const path = (event.queryStringParameters && event.queryStringParameters.path) || '';
  if (!path) return { statusCode: 400, body: JSON.stringify({ error: 'Missing path' }) };
  const key = process.env.TMDB_API_KEY;
  if (!key) return { statusCode: 500, body: JSON.stringify({ error: 'TMDB_API_KEY not set' }) };
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://api.themoviedb.org/3${path}${sep}api_key=${key}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(data)
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};