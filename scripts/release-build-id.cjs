// A revision binding for the web build; this is not a claim of reproducible bytes.
function releaseBuildId(env = process.env) {
  const explicit = env.MASTERMIND_RELEASE_WEB_REVISION;
  const hosted = env.VERCEL === '1' ? env.VERCEL_GIT_COMMIT_SHA : undefined;
  for (const value of [explicit, hosted]) {
    if (value !== undefined && (typeof value !== 'string' || value.length !== 40 || !/^[0-9a-f]{40}$/i.test(value))) {
      throw new Error('MASTERMIND_RELEASE_REVISION_INVALID');
    }
  }
  if (explicit !== undefined && hosted !== undefined && explicit.toLowerCase() !== hosted.toLowerCase()) {
    throw new Error('MASTERMIND_RELEASE_REVISION_CONFLICT');
  }
  return (explicit ?? hosted)?.toLowerCase() ?? null;
}
module.exports = { releaseBuildId };
