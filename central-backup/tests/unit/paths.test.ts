import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, OPERATIONS } from '@central/contracts';

const P = OPERATIONS['db.test_connection'].params;
const ok = (file_path: string) => validate(P, { target: { engine: 'sqlite', file_path } }).ok;

test('caminhos: absolutos aceitos, travessia e relativos recusados', () => {
  for (const f of ['/var/lib/app.db', '/var/ab/x.db', '/ok/..x/y', 'C:\\dados\\app.db', 'C:/dados/app.db', 'D:\\a b\\c.db']) assert.ok(ok(f), `deveria aceitar ${f}`);
  for (const f of ['/var/../etc/shadow', '/var/lib/..', '..', 'C:\\a\\..\\b', 'C:\\a\\..', 'relativo/app.db', 'app.db', '/a\u0001b', '\\\\servidor\\share\\x.db'])
    assert.ok(!ok(f), `deveria recusar ${JSON.stringify(f)}`);
});
