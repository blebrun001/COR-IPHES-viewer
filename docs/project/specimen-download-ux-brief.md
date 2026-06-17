# Project Brief

## Summary
Repenser la fonctionnalite de telechargement offline pour la rendre plus intuitive en centrant toute la gestion sur les specimens complets.

La possibilite de telecharger seulement certains os/modeles d'un specimen est supprimee. L'utilisateur selectionne des specimens, puis l'application telecharge tous les fichiers necessaires pour rendre chaque specimen completement disponible offline.

## Objective
Simplifier le parcours utilisateur de telechargement offline et rendre l'etat des telechargements clairement comprehensible, sans exposer a l'utilisateur la complexite interne des os, modeles 3D et fichiers associes.

## Problem to Solve
Le fonctionnement actuel permet une selection fine au niveau specimen et au niveau os/modele. Cette granularite cree un workflow trop complexe et peut produire des specimens partiellement disponibles, difficiles a comprendre pour l'utilisateur.

La nouvelle experience doit eviter les etats ambigus : un specimen est soit disponible offline completement, soit non disponible dans les listes principales tant que son telechargement n'est pas termine correctement.

## Target Users
Chercheurs, enseignants, personnels de collection et utilisateurs deja familiers du viewer COR-IPHES qui veulent consulter des specimens offline sans devoir gerer les details techniques des fichiers 3D.

## Scope
- Remplacer la selection par os/modele par une selection uniquement par specimen.
- Permettre le telechargement d'un ou plusieurs specimens complets.
- Telecharger automatiquement tous les os/modeles/fichiers necessaires pour chaque specimen selectionne.
- Afficher une progression detaillee des telechargements :
  - progression globale ;
  - progression par specimen ;
  - fichiers en cours ;
  - nombre de fichiers termines / total ;
  - volume telecharge / volume total quand disponible ;
  - etat en attente, en cours, pause, termine, erreur.
- Conserver une gestion robuste de la pause et de la reprise des telechargements.
- Permettre la reprise fiable apres pause volontaire, erreur reseau ou relance de l'application.
- Embarker par defaut une version initiale du catalogue dans l'application.
- Permettre a l'utilisateur de mettre a jour le catalogue, sans obligation.
- Proposer une mise a jour du catalogue avec confirmation avant remplacement du catalogue local.
- Masquer des listes principales les specimens partiellement telecharges ou en erreur.
- Garder les specimens incomplets visibles uniquement dans l'interface de gestion des telechargements, pour permettre reprise, annulation ou suppression.

## Out of Scope
- Telechargement selectif d'un os, modele ou fichier individuel.
- Affichage de specimens partiellement disponibles dans les listes principales du viewer.
- Remplacement automatique du catalogue sans confirmation utilisateur.
- Refonte complete du viewer 3D.
- Modification du stockage opaque/interne des fichiers, sauf si necessaire pour fiabiliser pause et reprise.

## Constraints
- Le catalogue initial doit etre disponible des le premier lancement, meme sans connexion internet.
- La mise a jour du catalogue depend de la disponibilite de CORA-RDR/Dataverse.
- Le telechargement d'un specimen doit etre atomique du point de vue utilisateur : il n'est considere disponible offline que lorsque tous ses fichiers requis sont telecharges et valides.
- La pause et la reprise doivent fonctionner pour les telechargements longs et les connexions instables.
- Les etats de telechargement doivent survivre a la fermeture et relance de l'application.
- L'interface doit rester coherente avec l'application desktop COR-IPHES Esqueletos Off-linea existante.

## Decisions Already Made
- L'unite de telechargement est le specimen complet.
- La selection fine par os/modele est supprimee.
- La synchronisation/mise a jour du catalogue et le telechargement des specimens sont deux actions distinctes.
- L'application embarque une version du catalogue par defaut.
- L'utilisateur peut mettre a jour le catalogue, mais n'y est pas oblige.
- Une mise a jour de catalogue doit etre proposee avec confirmation avant remplacement du catalogue local.
- La progression de telechargement doit etre detaillee, avec les fichiers en cours visibles.
- Les specimens partiellement telecharges ou en erreur sont masques des listes principales.
- Les fonctions pause, reprise et reprise apres interruption sont prioritaires.

## Assumptions
- Un specimen complet correspond a l'ensemble des fichiers requis pour charger tous ses os/modeles 3D et metadonnees associees offline.
- Les tailles de fichiers seront affichees lorsque les metadonnees disponibles permettent de les connaitre.
- Les specimens incomplets restent consultables dans une vue technique ou gestionnaire de telechargements, mais pas dans le parcours principal de consultation.
- Le catalogue embarque peut etre genere au moment du build ou fourni comme ressource applicative versionnee.

## Open Questions
- Faut-il afficher dans le viewer principal les specimens disponibles uniquement via catalogue mais non telecharges, avec un bouton "Telecharger", ou les afficher dans une vue de telechargement separee ?
- Quelle politique appliquer quand une mise a jour du catalogue modifie un specimen deja telecharge : conserver, remplacer, demander confirmation specimen par specimen, ou marquer comme a mettre a jour ?
- Quels controles exacts doivent etre disponibles sur un telechargement en erreur : reprendre, recommencer, supprimer, voir le detail ?
- Faut-il permettre de telecharger tous les specimens du catalogue en une seule action dans cette nouvelle version simplifiee ?

## Success Criteria
- Au premier lancement, l'application dispose deja d'un catalogue utilisable sans synchronisation obligatoire.
- L'utilisateur comprend clairement que les telechargements se font par specimen complet.
- Aucun controle ne permet de telecharger seulement un os ou un modele individuel.
- L'utilisateur peut selectionner un ou plusieurs specimens et lancer leur telechargement.
- La progression globale, la progression par specimen et le detail des fichiers en cours sont visibles.
- La pause arrete proprement les telechargements en cours sans perdre l'etat.
- La reprise continue les telechargements sans recommencer inutilement les fichiers deja acquis.
- Apres une erreur reseau ou une relance de l'application, les telechargements peuvent reprendre.
- Un specimen n'apparait dans les listes principales que lorsqu'il est completement telecharge et valide.
- Les specimens incomplets ou en erreur restent gerables depuis l'interface de telechargement.
- Une mise a jour du catalogue n'est appliquee qu'apres confirmation utilisateur.

## Next Steps
1. Adapter la specification UI du gestionnaire de telechargements autour d'une liste de specimens, sans sous-selection d'os.
2. Definir les etats persistants d'un specimen : non telecharge, en file, en cours, pause, partiel, erreur, termine, a mettre a jour.
3. Modifier le contrat backend/frontend pour que `download_enqueue` accepte des specimens complets plutot que des modeles individuels.
4. Implementer ou verifier la persistance de progression par fichier pour garantir pause, reprise et reprise apres relance.
5. Adapter les listes principales pour masquer les specimens incomplets ou en erreur.
6. Ajouter un workflow de mise a jour du catalogue avec detection de version, resume des changements et confirmation avant remplacement.
7. Tester les scenarios critiques : telechargement complet, pause, reprise, erreur reseau, relance application, catalogue obsolet, specimen partiel masque.
