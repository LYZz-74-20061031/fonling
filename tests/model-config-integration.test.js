const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const Config = require('../js/model/model-config.js');

function extractFunction(html, name) {
  const source = html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(source, `${name} must exist in index.html`);
  return source;
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('model modules load before the inline app and character state no longer owns an API key', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const configIndex = html.indexOf('<script src="js/model/model-config.js"></script>');
  const gatewayIndex = html.indexOf('<script src="js/model/model-gateway.js"></script>');
  const appIndex = html.indexOf('<script>');
  assert.ok(configIndex >= 0 && configIndex < gatewayIndex && gatewayIndex < appIndex);

  const stateBlock = html.match(/let state = \{[\s\S]*?\n\};/)?.[0] || '';
  assert.doesNotMatch(stateBlock, /\bapiKey\s*:/);
});

test('character settings sanitizer removes global configuration and optionally retains an unmigrated legacy key', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const source = extractFunction(html, 'sanitizeCharacterSettings');
  const context = { JSON };
  vm.runInNewContext(`${source}; this.sanitize = sanitizeCharacterSettings;`, context);
  const settings = {
    apiKey: 'legacy', glmApiKey: 'glm', deepseekApiKey: 'deepseek',
    defaultProvider: 'deepseek', costPolicy: { paid: true }, modelConfig: { secret: true },
    systemPrompt: 'persona', nested: { keep: true },
  };

  const clean = context.sanitize(settings, false);
  assert.equal(Object.prototype.hasOwnProperty.call(clean, 'apiKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(clean, 'glmApiKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(clean, 'deepseekApiKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(clean, 'defaultProvider'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(clean, 'costPolicy'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(clean, 'modelConfig'), false);
  assert.equal(clean.systemPrompt, 'persona');
  assert.deepEqual(plain(clean.nested), { keep: true });
  assert.deepEqual(settings.nested, { keep: true });

  const pending = context.sanitize(settings, true);
  assert.equal(pending.apiKey, 'legacy');
  assert.equal(Object.prototype.hasOwnProperty.call(pending, 'glmApiKey'), false);
});

test('buildExportData never exports credentials or global model choices and preserves message provenance', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const sanitizer = extractFunction(html, 'sanitizeCharacterSettings');
  const build = extractFunction(html, 'buildExportData');
  const context = {
    Date, JSON,
    FonlingMemory: { Storage: { serializeMemoryState() { return { memorySchemaVersion: 2 }; } } },
  };
  vm.runInNewContext(`${sanitizer}\n${build}; this.build = buildExportData;`, context);
  const exported = context.build({
    apiKey: 'legacy-secret', glmApiKey: 'glm-secret', deepseekApiKey: 'ds-secret',
    defaultProvider: 'deepseek', systemPrompt: 'persona', style: '', bgImage: '', summary: '',
    roles: [], currentRole: null, userIdentity: '',
    messages: [{ role: 'assistant', content: 'reply', generation: { provider: 'glm', model: 'glm-4.5-air', tier: 'air' } }],
  }, '2026-08-23T08:00:00.000Z');

  const encoded = JSON.stringify(exported);
  assert.equal(encoded.includes('legacy-secret'), false);
  assert.equal(encoded.includes('glm-secret'), false);
  assert.equal(encoded.includes('ds-secret'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exported.settings, 'apiKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exported.settings, 'defaultProvider'), false);
  assert.deepEqual(plain(exported.messages[0].generation), {
    provider: 'glm', model: 'glm-4.5-air', tier: 'air',
  });
});

test('legacy key migration updates global config only when empty and never overwrites an existing key', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const source = extractFunction(html, 'migrateLegacyModelConfig');
  const entries = new Map();
  const context = {
    localStorage: {
      getItem(key) { return entries.has(key) ? entries.get(key) : null; },
      setItem(key, value) { entries.set(key, String(value)); },
      removeItem(key) { entries.delete(key); },
    },
    modelConfigApi: Config,
    modelConfig: Config.createDefaultConfig(),
  };
  vm.runInNewContext(`${source}; this.migrate = migrateLegacyModelConfig; this.read = function(){ return modelConfig; };`, context);

  const adopted = context.migrate('legacy-key');
  assert.equal(adopted.ok, true);
  assert.equal(adopted.migrated, true);
  assert.equal(context.read().deepseekApiKey, 'legacy-key');

  const ignored = context.migrate('different-key');
  assert.equal(ignored.ok, true);
  assert.equal(ignored.migrated, false);
  assert.equal(context.read().deepseekApiKey, 'legacy-key');
});
