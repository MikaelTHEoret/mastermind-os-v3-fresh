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
      'Read-only access to the Mastermind research archive: ~181,500 text chunks from ~5,190 source files ' +
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
          "5. Read content: op=doc, doc_id=<id> returns one source's chunks in order; op=node, address=<id> " +
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
          '- k caps result size (default 12, max 50).',
        parameters: [
          { name: 'op', in: 'query', required: true, description: 'Action to perform.', schema: { type: 'string', enum: ['stats', 'search', 'children', 'leaf', 'srcleaf', 'doc', 'node', 'neighbors', 'concept', 'docsubjects', 'subjsources', 'docs', 'tree'] } },
          { name: 'q', in: 'query', required: false, description: 'Search text (op=search).', schema: { type: 'string' } },
          { name: 'path', in: 'query', required: false, description: 'Node id / leaf id. ROOT is the top. Used by children, leaf, srcleaf, subjsources.', schema: { type: 'string' } },
          { name: 'doc_id', in: 'query', required: false, description: 'Source/conversation id. Used by doc, docsubjects.', schema: { type: 'string' } },
          { name: 'address', in: 'query', required: false, description: 'Chunk address. Used by node, neighbors.', schema: { type: 'string' } },
          { name: 'core_hash', in: 'query', required: false, description: 'Concept id. Used by concept.', schema: { type: 'string' } },
          { name: 'axis', in: 'query', required: false, description: 'Which tree: subject (meaning) or source (provenance). Default subject.', schema: { type: 'string', enum: ['subject', 'source'] } },
          { name: 'source_type', in: 'query', required: false, description: 'Optional filter for search/docs (e.g. transcript, document, code, datasheet).', schema: { type: 'string' } },
          { name: 'k', in: 'query', required: false, description: 'Max results (default 12, max 50).', schema: { type: 'integer' } },
        ],
        responses: {
          '200': { description: 'Result (shape varies by op).', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '400': { description: 'Missing or invalid parameter.' },
          '503': { description: 'Embedding service offline (op=search only).' },
        },
      },
    },
  },
};

export function GET(): NextResponse {
  return NextResponse.json(SCHEMA, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
}
