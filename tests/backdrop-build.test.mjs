import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('production CSS preserves standard backdrop filters', async () => {
  const directory = new URL('../apps/web/dist/', import.meta.url);
  const html = await readFile(new URL('index.html',directory),'utf8');
  // Servers retain older hashed assets for browsers with an already-open page.
  const files = Array.from(html.matchAll(/href=["'](\/assets\/[^"']+\.css)["']/g), match => match[1].slice(1));
  assert(files.length > 0, 'Run npm run build:web before this check');
  const css = (await Promise.all(files.map(file => readFile(new URL(file,directory),'utf8')))).join('\n');
  for (const selector of ['\\.hub-backdrop','\\.result-total::?before']) {
    const rule = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
    assert(rule, `Missing production rule: ${selector}`);
    assert.match(rule[1], /(?:^|;)backdrop-filter:blur\(/, `Standard backdrop-filter lost in ${selector}`);
  }
});
