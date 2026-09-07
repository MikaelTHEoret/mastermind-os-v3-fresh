import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertPublicEnvironment } from '../check-public-source.mjs';
test('source checks refuse every standard Next dotenv variant before discovery', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mastermind-public-env-fixture-'));
  try {
    assertPublicEnvironment(root, {});
    for (const name of ['.env','.env.local','.env.development','.env.development.local',
      '.env.test','.env.test.local','.env.production','.env.production.local']) {
      const file=path.join(root,name);
      fs.writeFileSync(file,'');
      assert.throws(()=>assertPublicEnvironment(root,{}),/REFUSE_LOCAL_ENV_FILES/);
      fs.unlinkSync(file);
    }
    assert.throws(()=>assertPublicEnvironment(root,{NEON_MEMORY_URL:'synthetic-configured'}),/UNCONFIGURED_OPERATOR_ENVIRONMENT/);
  } finally { fs.rmdirSync(root); }
});
