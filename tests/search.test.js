import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveUberonUrlFromModel,
  extractUberonCode,
  formatModelOptionLabel,
  formatSpecimenLabel,
} from '../app/public/js/ui/search.js';

test('formatModelOptionLabel preserves catalog anatomical names verbatim', () => {
  const displayName = 'Húmero izquierdo UBERON_0000970';

  assert.equal(
    formatModelOptionLabel({ displayName, directory: displayName }),
    displayName,
  );
});

test('deriveUberonUrlFromModel still derives ontology links from original labels', () => {
  assert.equal(
    deriveUberonUrlFromModel({ displayName: 'Húmero izquierdo UBERON_0000970' }),
    'http://purl.obolibrary.org/obo/UBERON_0000970',
  );
});

test('extractUberonCode supports common catalog filename patterns', () => {
  assert.equal(extractUberonCode('mandible-0001684'), '0001684');
  assert.equal(extractUberonCode('UBERON:970'), '0000970');
});

test('formatSpecimenLabel preserves specimen label and appends metadata attributes', () => {
  assert.equal(
    formatSpecimenLabel('Crocuta crocuta / IPHES-001', { sex: 'Female', ageClass: 'Adult' }),
    'Crocuta crocuta / IPHES-001 (Female · Adult)',
  );
});
