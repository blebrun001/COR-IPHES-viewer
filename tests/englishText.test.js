import assert from 'node:assert/strict';
import test from 'node:test';
import { EnglishTextCatalog, resolveTextKey } from '../app/public/js/text/english.js';

class FakeNode {
  constructor(attributes = {}, textContent = '') {
    this.attributes = new Map(Object.entries(attributes));
    this.textContent = textContent;
    this.innerHTML = textContent;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

test('resolveTextKey reads nested catalog keys', () => {
  assert.equal(resolveTextKey({ viewer: { buttons: { capture: 'Capture' } } }, 'viewer.buttons.capture'), 'Capture');
  assert.equal(resolveTextKey({ viewer: {} }, 'viewer.buttons.capture'), undefined);
});

test('EnglishTextCatalog translates keys and keeps fallback behavior', () => {
  const text = new EnglishTextCatalog({
    dictionary: { options: { title: 'Options' } },
  });

  assert.equal(text.translate('options.title'), 'Options');
  assert.equal(text.translate('missing.key', { defaultValue: 'Fallback' }), 'Fallback');
  assert.equal(text.currentLanguage, 'en');
});

test('EnglishTextCatalog applies text and attributes to marked nodes', () => {
  const textNode = new FakeNode({ 'data-text': 'header.subtitle' }, 'Old');
  const attrNode = new FakeNode({
    'data-text-attr': 'aria-label:viewer.buttons.capture,data-tooltip:viewer.buttons.capture',
  });
  const root = {
    querySelectorAll() {
      return [textNode, attrNode];
    },
  };
  const text = new EnglishTextCatalog({
    dictionary: {
      header: { subtitle: 'Portable 3D Model Viewer' },
      viewer: { buttons: { capture: 'Capture' } },
    },
  });

  text.applyToDocument(root);

  assert.equal(textNode.textContent, 'Portable 3D Model Viewer');
  assert.equal(attrNode.getAttribute('aria-label'), 'Capture');
  assert.equal(attrNode.getAttribute('data-tooltip'), 'Capture');
});
