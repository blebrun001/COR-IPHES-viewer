import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalCatalogClient } from '../app/public/js/data/localCatalogClient.js';

function createBridge(rawEntry) {
  return {
    isAvailable: true,
    async invoke(command, args = {}) {
      if (command === 'catalog_entry_command') {
        assert.equal(args.persistentId, rawEntry.persistentId);
        return rawEntry;
      }
      if (command === 'asset_resolve') {
        return { path: `/local/${args.fileId}` };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
    convertFileSrc(path) {
      return `asset://${path}`;
    },
  };
}

test('LocalCatalogClient builds model sources from downloaded local catalog files', async () => {
  const rawEntry = {
    persistentId: 'doi:10.34810/example',
    title: 'Specimen title',
    detail: { data: { latestVersion: { id: 1 } } },
    files: [
      {
        path: 'bones/humerus/model.obj',
        label: 'model.obj',
        directoryLabel: 'bones/humerus',
        dataFile: { id: 1 },
      },
      {
        path: 'bones/humerus/materials/model.mtl',
        label: 'model.mtl',
        directoryLabel: 'bones/humerus/materials',
        dataFile: { id: 2 },
      },
      {
        path: 'bones/humerus/textures/albedo.jpg',
        label: 'albedo.jpg',
        directoryLabel: 'bones/humerus/textures',
        dataFile: { id: 3 },
      },
    ],
    models: [
      {
        key: 'humerus-left',
        displayName: 'Húmero izquierdo',
        directory: 'bones/humerus',
        objEntry: {
          directory: 'bones/humerus',
          file: { dataFile: { id: 1 } },
        },
        mtlEntry: {
          directory: 'bones/humerus/materials',
          file: { dataFile: { id: 2 } },
        },
      },
    ],
  };
  const client = new LocalCatalogClient({ bridge: createBridge(rawEntry) });

  const source = await client.createModelSource(rawEntry.persistentId, 'humerus-left');
  const texture = source.resolveTexturePath('../textures/albedo.jpg', {
    textureBaseDir: 'bones/humerus/materials',
  });

  assert.equal(source.displayName, 'Húmero izquierdo');
  assert.equal(source.objUrl, 'asset:///local/1');
  assert.deepEqual(source.defaultMaterialLibrary, {
    url: 'asset:///local/2',
    textureBaseDir: 'bones/humerus/materials',
  });
  assert.deepEqual(texture, {
    url: 'asset:///local/3',
    cacheKey: `local:${rawEntry.persistentId}:file:3`,
  });
});

test('LocalCatalogClient storage delete only sends complete-specimen scope', async () => {
  let receivedArgs = null;
  const client = new LocalCatalogClient({
    bridge: {
      isAvailable: true,
      async invoke(command, args = {}) {
        assert.equal(command, 'storage_delete');
        receivedArgs = args;
        return 3;
      },
      convertFileSrc(path) {
        return path;
      },
    },
  });

  const deleted = await client.storageDelete({
    datasetId: 'doi:10.34810/data1',
    modelKey: 'humerus-left',
  });

  assert.equal(deleted, 3);
  assert.deepEqual(receivedArgs, {
    datasetId: 'doi:10.34810/data1',
  });
});
