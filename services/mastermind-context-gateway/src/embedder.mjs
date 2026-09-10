import { boundedText } from './validation.mjs';

export function createOllamaEmbedder({
  endpoint = process.env.OLLAMA_EMBED_URL || 'http://127.0.0.1:11434/api/embed',
  token = process.env.OLLAMA_EMBED_TOKEN || '',
  model = process.env.MASTERMIND_EMBED_MODEL || 'nomic-embed-text',
  timeoutMs = 5_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  let url;
  try { url = new URL(endpoint); }
  catch { throw new Error('OLLAMA_EMBED_URL is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('OLLAMA_EMBED_URL must use HTTP or HTTPS.');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  return async function embed(input) {
    const text = boundedText(input, 8_000);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, input: text }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return null;
      const body = await response.json();
      const vector = Array.isArray(body?.embeddings?.[0]) ? body.embeddings[0] : null;
      if (!vector || vector.length !== 768 || vector.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
        return null;
      }
      return vector;
    } catch {
      return null;
    }
  };
}
