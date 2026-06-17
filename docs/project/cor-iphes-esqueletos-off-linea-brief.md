# Project Brief

## Summary
Transformer le viewer web statique COR-IPHES actuel en application desktop portable, multi-plateforme, lancee directement sur macOS, Windows et Linux, sans installation classique.

La premiere version s'appellera **COR-IPHES Esqueletos Off-linea** et embarquera uniquement l'application viewer actuelle (`app/index.html`), sans la page d'accueil publique. L'UX doit rester aussi proche que possible de l'application online actuelle, avec un marquage visible indiquant qu'il s'agit de la version offline.

## Objective
Permettre aux utilisateurs deja familiers du viewer COR-IPHES online de consulter les specimens et modeles 3D sans connexion internet, apres synchronisation et telechargement local du catalogue et des assets necessaires.

## Problem to Solve
Le viewer actuel depend de CORA-RDR/Dataverse pour charger les metadonnees et les fichiers 3D a la demande. Cette dependance bloque l'usage dans des contextes sans connexion fiable, tout en exposant les modeles sous forme de ressources distantes.

La nouvelle application doit offrir la meme experience de consultation, recherche, selection, visualisation 3D, comparaison et metadata, avec un mode offline complet une fois les donnees synchronisees.

## Target Users
Utilisateurs deja habitues au projet online actuel, notamment chercheurs, enseignants, personnels de collection ou utilisateurs internes/connaisseurs du viewer COR-IPHES.

Le projet ne cible pas prioritairement une refonte grand public. La continuite avec l'interface actuelle prime sur une nouvelle experience.

## Scope
- Empaqueter le viewer `app/index.html` comme application desktop portable pour macOS, Windows et Linux.
- Conserver autant que possible l'UI, les workflows et les fonctionnalites du viewer actuel.
- Ajouter une identite visible de version offline, avec le nom **COR-IPHES Esqueletos Off-linea**.
- Ajouter un gestionnaire de synchronisation du catalogue depuis CORA-RDR/Dataverse lorsque internet est disponible.
- Detecter les nouveaux specimens, nouveaux modeles et changements de catalogue lors des synchronisations.
- Permettre un usage offline complet apres telechargement :
  - liste des specimens ;
  - metadonnees ;
  - taxonomie ;
  - recherche ;
  - selection specimen ;
  - selection modele/anatomical element ;
  - chargement 3D ;
  - outils viewer existants ;
  - comparaison.
- Permettre le telechargement de tous les modeles d'un coup.
- Permettre la selection fine a deux niveaux :
  - specimens ;
  - modeles/elements anatomiques dans chaque specimen.
- Ajouter un gestionnaire de telechargement avance :
  - file d'attente ;
  - pause ;
  - reprise ;
  - reprise apres echec ;
  - priorisation des telechargements ;
  - progression globale et par fichier/modele ;
  - etat telecharge / partiel / en attente / erreur ;
  - estimation du poids avant telechargement quand les metadonnees CORA-RDR le permettent.
- Stocker les modeles dans un stockage interne gere par l'application, non expose dans l'interface comme fichiers `.obj`, `.mtl` ou textures accessibles directement.
- Conserver les liens externes GBIF, CORA-RDR et OLS en mode online.
- Masquer ou desactiver proprement les liens externes lorsque l'application est offline.

## Out of Scope
- Refonte majeure de l'interface utilisateur.
- Inclusion de la landing page publique actuelle dans la premiere version.
- DRM fort ou protection impossible a contourner.
- Obligation d'estimer le poids des telechargements si CORA-RDR/Dataverse ne fournit pas les tailles utiles.
- Limite stricte de stockage ou quota de telechargement.
- Acces utilisateur direct au dossier ou aux fichiers sources des modeles.

## Constraints
- L'application doit etre portable et lancee directement, avec des livrables adaptes a chaque OS.
- L'application doit fonctionner sur macOS, Windows et Linux.
- Le mode offline doit couvrir toute l'experience principale du viewer, pas uniquement les fichiers 3D.
- La protection des modeles est une protection pratique : stockage opaque/interne, sans exposer les fichiers bruts dans un dossier utilisateur.
- Une protection absolue contre l'extraction locale n'est pas techniquement garantie dans une application offline.
- L'UX existante doit rester la reference.
- La synchronisation depend de l'accessibilite de CORA-RDR/Dataverse quand internet est disponible.

## Decisions Already Made
- Le nom de la version desktop offline est **COR-IPHES Esqueletos Off-linea**.
- La premiere version embarque uniquement le viewer actuel, pas la page d'accueil publique.
- Le mode offline doit etre complet apres synchronisation.
- La selection de telechargement se fait au niveau specimen et au niveau modele.
- Les modeles telecharges doivent etre stockes dans un espace gere par l'application.
- Le niveau de protection attendu est pratique, pas DRM.
- Les liens externes restent disponibles en online et sont masques/desactives en offline.
- Le public cible est constitue d'utilisateurs connaissant deja le viewer online.
- La premiere version doit inclure des fonctions avancees de gestion de telechargement, pas seulement un bouton "tout telecharger".

## Assumptions
- **Tauri** est la technologie recommandee a evaluer en priorite : elle permet de reutiliser l'application web existante, de produire des executables desktop multi-plateformes plus legers qu'Electron, et de deleguer les operations sensibles de fichiers/telechargements a une couche native Rust.
- Electron reste une alternative acceptable si l'ecosysteme, les contraintes de packaging ou la vitesse de developpement priment sur la taille de l'application.
- Le viewer actuel peut etre conserve comme frontend principal, avec adaptation progressive du `DataverseClient` vers une abstraction capable de lire soit CORA-RDR, soit le cache local.
- Le stockage local opaque pourra prendre la forme d'un conteneur applicatif ou d'une base interne avec blobs/assets indexes, plutot qu'une arborescence de fichiers 3D lisibles directement.
- Les metadonnees necessaires au mode offline seront serializees localement au moment de la synchronisation.
- Les assets externes non essentiels a l'UX offline, comme les liens GBIF/CORA/OLS, ne seront pas rendus disponibles hors ligne.

## Open Questions
- Les livrables portables attendus doivent etre confirmes precisement pour chaque OS : `.app`/archive macOS, `.exe` portable Windows, AppImage ou archive Linux.
- Le niveau exact d'obfuscation/chiffrement du stockage interne reste a specifier techniquement.
- La politique de suppression/nettoyage des modeles telecharges reste a definir : suppression par specimen, par modele, tout supprimer, ou aucun nettoyage manuel dans la premiere version.
- La strategie de verification d'integrite reste a definir : checksum Dataverse si disponible, taille attendue, ou validation locale minimale.
- La gestion des mises a jour de modeles existants reste a preciser : remplacer automatiquement, demander confirmation, ou conserver plusieurs versions.
- Le comportement en cas de catalogue synchronise mais modele non telecharge doit etre defini dans l'UI.

## Success Criteria
- L'utilisateur peut lancer l'application portable sur macOS, Windows et Linux sans installation classique.
- L'application affiche le viewer COR-IPHES avec une UX tres proche de l'application online actuelle.
- L'application indique clairement qu'il s'agit de **COR-IPHES Esqueletos Off-linea**.
- Avec internet, l'utilisateur peut synchroniser le catalogue depuis CORA-RDR/Dataverse.
- L'application detecte les nouveaux specimens/modeles lors d'une synchronisation.
- L'utilisateur peut selectionner tous les specimens/modeles ou seulement certains specimens et certains modeles.
- L'utilisateur peut lancer un telechargement global ou selectif.
- Les telechargements supportent pause, reprise, reprise apres echec et priorisation.
- Une estimation de poids est affichee quand les metadonnees disponibles le permettent.
- Apres telechargement, l'utilisateur peut fermer l'application, couper internet, relancer l'application et ouvrir les modeles telecharges.
- La recherche, les filtres, les metadonnees et la comparaison restent utilisables offline pour les donnees synchronisees.
- Les liens externes sont actifs online et desactives ou masques offline.
- Les fichiers bruts des modeles ne sont pas exposes comme fichiers directement navigables par l'utilisateur via l'interface normale de l'application.

## Next Steps
1. Confirmer le choix technique Tauri vs Electron par un court prototype de packaging du viewer actuel.
2. Introduire une couche d'acces aux donnees separant source distante Dataverse et source locale offline.
3. Concevoir le schema du catalogue local : specimens, modeles, fichiers associes, tailles, etats de telechargement, versions et timestamps.
4. Concevoir le stockage opaque des assets 3D.
5. Specifier l'UI du gestionnaire de telechargement en conservant le style actuel.
6. Implementer un prototype de synchronisation catalogue.
7. Implementer le telechargement resumable avec file d'attente et priorites.
8. Adapter le chargement 3D pour resoudre les URLs depuis le cache local en mode offline.
9. Valider les workflows online, offline, reprise apres echec et comparaison.
