import { NextResponse } from 'next/server';

// OpenAPI 3.1 schema for the Codex knowledge-archive API, formatted for GPT custom Actions.
// Import URL: https://mastermind-core.com/api/codex/openapi
export const dynamic = 'force-dynamic';

const SCHEMA = {
  openapi: '3.1.0',
  info: {
    title: 'Mastermind Codex - Knowledge Archive Navigator',
    version: '1.0.0',
    description:
      'Read-only access to the Mastermind research archive: 272,656 text chunks from 6,204 source documents ' +
      '(AI conversations, documents, code, datasheets). The same chunks are organized as TWO fractal trees: ' +
      'the SUBJECT axis clusters by meaning, the SOURCE axis clusters by provenance (where a chunk came from). ' +
      'All endpoints are read-only GET calls with no authentication. The search op needs an embedding service ' +
      'and may return 503 when it is offline; every other op is always available.',
  },
  servers: [{ url: 'https://mastermind-core.com' }],
  paths: {
    '/api/codex': {
      get: {
        operationId: 'queryCodex',
        summary: 'Query or navigate the knowledge archive',
        description:
          "Single entry point; the 'op' parameter selects the action.\n\n" +
          'RECOMMENDED FLOW\n' +
          '1. op=stats - corpus overview (counts, source-type breakdown).\n' +
          '2. op=search, q=<text> - semantic retrieval: the chunks closest in meaning to your query. ' +
          'Best first step for a question. May return 503 if the embedding service is down.\n' +
          '3. Navigate the tree without pulling all of it: op=children, path=ROOT, axis=subject (or axis=source) ' +
          "returns a node's direct children; pass a child id back as path to descend. Repeat until is_leaf=true.\n" +
          '4. Read a leaf: op=leaf, path=<leaf id> on the SUBJECT axis returns the chunk cards there; ' +
          'op=srcleaf, path=<leaf id> on the SOURCE axis returns the conversations/files there.\n' +
          "5. Read content: op=doc, doc_id=<id>, limit=<n>, offset=<n> returns one paged source window; op=node, address=<id> " +
          "returns one chunk's full text; op=neighbors, address=<id> returns the semantically nearest chunks; " +
          'op=concept, core_hash=<id> returns all chunks of one concept.\n' +
          '6. Cross the two axes: op=docsubjects, doc_id=<id> lists the subjects a source feeds; ' +
          'op=subjsources, path=<subject leaf id> lists the sources feeding a subject.\n\n' +
          'PARAMETER MAP (which param each op needs)\n' +
          '- path: children, leaf, srcleaf, subjsources\n' +
          '- doc_id: doc, docsubjects\n' +
          '- address: node, neighbors\n' +
          '- core_hash: concept\n' +
          '- q: search\n' +
          '- axis (subject|source): tree, children\n' +
          '- denominator/base/class: prime_residual_profile, prime_residual_notables, prime_residual_modes, prime_residual_neighbors\n' +
          '- k caps search/tree/result-neighbor size (default 12, max 50).\n- limit/offset page op=doc and op=docs; op=docs returns total/has_more.',
        parameters: [
          { name: 'op', in: 'query', required: true, description: 'Action to perform.', schema: { type: 'string', enum: ['stats', 'search', 'children', 'leaf', 'srcleaf', 'doc', 'node', 'neighbors', 'concept', 'docsubjects', 'subjsources', 'docs', 'tree', 'prime_residual_stats', 'prime_residual_profile', 'prime_residual_notables', 'prime_residual_modes', 'prime_residual_neighbors'] } },
          { name: 'q', in: 'query', required: false, description: 'Search text (op=search).', schema: { type: 'string' } },
          { name: 'path', in: 'query', required: false, description: 'Node id / leaf id. ROOT is the top. Used by children, leaf, srcleaf, subjsources.', schema: { type: 'string' } },
          { name: 'doc_id', in: 'query', required: false, description: 'Source/conversation id. Used by doc, docsubjects.', schema: { type: 'string' } },
          { name: 'address', in: 'query', required: false, description: 'Chunk address. Used by node, neighbors.', schema: { type: 'string' } },
          { name: 'core_hash', in: 'query', required: false, description: 'Concept id. Used by concept.', schema: { type: 'string' } },
          { name: 'axis', in: 'query', required: false, description: 'Which tree: subject (meaning) or source (provenance). Default subject.', schema: { type: 'string', enum: ['subject', 'source'] } },
          { name: 'source_type', in: 'query', required: false, description: 'Optional filter for search/docs (e.g. transcript, document, code, datasheet).', schema: { type: 'string' } },
          { name: 'k', in: 'query', required: false, description: 'Max results for search/tree-style result lists (default 12, max 50).', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', required: false, description: 'Page size for docs/doc operations. op=doc defaults to 500 and caps at 2000; op=docs defaults to 400 and caps at 1000.', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', required: false, description: 'Zero-based page offset for op=doc and op=docs.', schema: { type: 'integer' } },
          { name: 'denominator', in: 'query', required: false, description: 'Denominator n for residual reciprocal profile lookup/neighbors, e.g. 137.', schema: { type: 'integer' } },
          { name: 'base', in: 'query', required: false, description: 'Numeral base for residual reciprocal profile queries, e.g. 10, 12, 16.', schema: { type: 'integer' } },
          { name: 'class', in: 'query', required: false, description: 'Residual class filter, e.g. RESIDUAL_HIGH_MODAL, RESIDUAL_LOW_MODAL, SINGLE_MODEL_OUTLIER.', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Result (shape varies by op).', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '400': { description: 'Missing or invalid parameter.' },
          '503': { description: 'Embedding service offline (op=search only).' },
        },
      },
      post: {
        operationId: 'writeCodexStagedArtifact',
        summary: 'Write a narrowly-scoped staged artifact into Mastermind',
        description:
          'Gated write path for Codex-produced staging artifacts. This is not a generic SQL endpoint. ' +
          "Currently supported write ops: op=ingest_prime_cymatic_v1 and op=ingest_prime_residual_profiles_v1, which upsert computed CANDIDATE " +
          'prime reciprocal/cymatic/residual profiles, PRISM signatures, and candidate relations. ' +
          'Requires Authorization: Bearer <MASTERMIND_CODEX_WRITE_TOKEN> or x-codex-write-token. ' +
          'If the token is not configured server-side, writes return 503.',
        parameters: [
          { name: 'op', in: 'query', required: true, description: 'Write action to perform.', schema: { type: 'string', enum: ['ingest_prime_cymatic_v1', 'ingest_prime_residual_profiles_v1'] } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['schema', 'rows'],
                properties: {
                  schema: { type: 'string', description: 'PRIME_CYMATIC_INGEST_V1 or PRIME_RESIDUAL_PROFILE_INGEST_V1' },
                  rows: {
                    type: 'array',
                    maxItems: 250,
                    description: 'Rows from prime_cymatic_profiles_first_2000.csv. Batches are capped at 250 rows.',
                    items: { type: 'object', additionalProperties: true },
                  },
                  source: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Batch applied; returns cumulative profile/signature/relation totals.' },
          '400': { description: 'Invalid schema or row payload.' },
          '401': { description: 'Missing or invalid write token.' },
          '413': { description: 'Batch exceeds 250 rows.' },
          '503': { description: 'Server-side write token not configured.' },
        },
      },
    },
  },
};

export function GET(): NextResponse {
  return NextResponse.json(SCHEMA, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
}
