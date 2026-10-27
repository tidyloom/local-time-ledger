import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Guards the network promise on the shipped bundle, not just the sources: the only network
// code is one fetch to the Gumroad license verify endpoint, run by a user command.
describe('offline guarantee', () => {
  const bundle = path.resolve(__dirname, '../../../dist/extension.js');
  const VERIFY = 'https://api.gumroad.com/v2/licenses/verify';
  const PRODUCT_PAGE = 'https://tidyloomdev.gumroad.com/l/hsflch';

  function code(ctx: Mocha.Context): string {
    if (!fs.existsSync(bundle)) {
      ctx.skip();
    }
    return fs.readFileSync(bundle, 'utf8');
  }

  it('bundle has no network modules, sockets or other request APIs', function () {
    const text = code(this);
    const banned = [
      /require\(["'](node:)?(https?|http2|net|tls|dgram|dns)["']\)/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
      /\bEventSource\b/,
      /\bsendBeacon\b/,
    ];
    for (const re of banned) {
      assert.doesNotMatch(text, re, `bundle matches ${re.source}`);
    }
  });

  it('has exactly one fetch call and it goes to the Gumroad verify endpoint', function () {
    const text = code(this);
    const calls = text.match(/\bfetch\s*\(/g) ?? [];
    assert.equal(calls.length, 1, 'fetch( occurrences');
    assert.match(text, /await fetch\(GUMROAD_VERIFY_URL,/);
    assert.equal(text.split(`"${VERIFY}"`).length - 1, 1, 'verify URL defined once');
  });

  it('contains no other URLs than the verify endpoint, the product page and the repository', function () {
    const urls = code(this).match(/https?:\/\/[^\s"'`)]+/g) ?? [];
    for (const url of urls) {
      assert.ok(url === VERIFY || url === PRODUCT_PAGE || url.startsWith('https://github.com/tidyloom'), `unexpected URL ${url}`);
    }
  });
});
