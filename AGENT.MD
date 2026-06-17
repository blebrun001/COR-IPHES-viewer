# COR-IPHES Esqueletos Off-linea - Notes Agent

## Perimetre

Ce depot contient uniquement l'application desktop Tauri v2 **COR-IPHES Esqueletos Off-linea**.

- Point d'entree frontend : `app/index.html`.
- Pas de landing page publique a la racine du projet.
- Pas de client Dataverse navigateur direct dans `app/public/js/data`.
- Dataverse est contacte uniquement par le backend Rust pendant `sync_preview` et `sync_apply`.
- Le viewer consomme le catalogue local SQLite et des blobs locaux resolus par protocole asset Tauri.

## Structure

```text
.
├── app/
│   ├── index.html
│   └── public/
│       ├── css/
│       ├── i18n/
│       ├── js/
│       │   ├── 3d/
│       │   ├── data/
│       │   ├── state/
│       │   └── ui/
│       ├── ressources/
│       └── vendor/
├── scripts/
├── src-tauri/
├── package.json
└── README.md
```

## Frontend

Le contrat de donnees a conserver :

- `listDatasets`
- `ensureDatasetPrepared`
- `listDatasetModels`
- `getDatasetMetadata`
- `createModelSource`

Modules principaux :

- `app/public/js/data/desktopBridge.js` : wrapper mince de `window.__TAURI__.core.invoke`.
- `app/public/js/data/localCatalogClient.js` : catalogue local et resolution des blobs.
- `app/public/js/data/hybridDataClient.js` : facade utilisee par le viewer.
- `app/public/js/ui/syncManager.js` : synchronisation, telechargements et stockage.

Si le catalogue local est vide, l'app doit afficher un etat de synchronisation requise, pas une erreur de chargement des specimens.

Le cadrage final de telechargement est le specimen complet : `listDatasets` masque les specimens incomplets par defaut dans le viewer principal, et le gestionnaire de telechargements demande explicitement `includeIncomplete: true`.

## Backend Tauri

Commandes exposees :

- `catalog_list`
- `catalog_entry_command`
- `sync_preview`
- `sync_apply`
- `download_enqueue`
- `download_pause`
- `download_resume`
- `download_cancel`
- `download_status`
- `storage_usage`
- `storage_delete`
- `network_status`
- `asset_resolve`

SQLite indexe specimens, modeles, fichiers Dataverse, checksums, tailles, etats de telechargement et file d'attente. Les assets telecharges sont stockes comme blobs opaques :

```text
$APPLOCALDATA/assets/<sha256-prefix>/<sha256>
```

## Commandes

```bash
npm install
npm run tauri:dev
npm run tauri:build:mac
npm run tauri:build:linux
npm run tauri:build:windows
cargo check --manifest-path src-tauri/Cargo.toml
```

## Validation

- Premier lancement sans catalogue : message de synchronisation requise.
- Sync online : `sync_preview`, confirmation des remplacements, `sync_apply`.
- Telechargements : selection par specimen complet, tout telecharger, pause, reprise, annulation, suppression.
- Relance offline : recherche, metadonnees, modeles telecharges et comparaison fonctionnent.
- Aucune dependance CDN dans `app/index.html`, `app/public/js` ou `app/public/css`.
