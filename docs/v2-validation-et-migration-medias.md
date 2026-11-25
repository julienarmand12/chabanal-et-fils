# Validation V2 et plan de migration des médias

## État et limites

Ce document décrit les essais à effectuer avant toute activation de V2. Les tests Node du dépôt simulent deux appareils et un backend Supabase ; ils ne prouvent pas encore le fonctionnement avec deux sessions Auth réelles, deux navigateurs mobiles, le réseau mobile ou les politiques RLS réellement exécutées.

- Le moteur V1 reste le moteur actif.
- La branche `v2-delta-sync-adapter` et la PR #4 restent isolées.
- Aucun client, intervention, média ou autre enregistrement métier n'a été migré.
- Aucun fichier Storage n'a été copié, supprimé ou remplacé.
- Ne pas appeler `cloudFirstMigration()` ni `cloudPullReplaceLocal()`.

## Protocole de validation sur deux appareils

### Préparation sans risque

1. Garder V1 ouverte et fonctionnelle sur les deux appareils.
2. Ne pas utiliser les vraies fiches clients pour le test : créer une fiche de test explicitement identifiable, uniquement dans un environnement de test V2.
3. Vérifier que les deux appareils utilisent le même compte Auth autorisé et le même workspace V2.
4. Noter les identifiants des appareils, l'heure de début et le curseur initial.
5. Vérifier qu'aucune donnée V1 n'est modifiée par le test. Ne pas activer de synchronisation V2 automatique.

### Scénarios à exécuter

| Étape | Appareil 1 | Appareil 2 | Résultat attendu |
|---|---|---|---|
| 1. Création | Créer une fiche test | Lancer le pull delta | La fiche apparaît une seule fois |
| 2. Modification | Laisser la fiche ouverte | Modifier puis enregistrer | Appareil 1 reçoit la nouvelle révision |
| 3. Conflit | Modifier hors ligne avec une ancienne révision | Enregistrer une modification plus récente | L'enregistrement obsolète est refusé, aucune donnée récente n'est écrasée |
| 4. Coupure | Couper le réseau avant un pull | Créer/modifier une fiche test | Au retour réseau, les événements sont reçus dans l'ordre |
| 5. Reprise | Interrompre le traitement d'un événement | Relancer le pull | L'événement non acquitté est rejoué ; le gestionnaire doit être idempotent |
| 6. Suppression | Supprimer logiquement la fiche test | Faire un pull | La fiche est marquée supprimée, sans effacement physique prématuré |
| 7. Doublons | Relancer le pull sans nouvel événement | Relancer le pull | Aucun doublon et aucun événement supplémentaire |

### Contrôles de sortie

- Comparer les révisions serveur et locales après chaque étape.
- Vérifier que le curseur local ne dépasse jamais le dernier événement effectivement traité.
- Vérifier les lignes `app_v2_change_log`, `app_v2_sync_cursors` et `app_v2_records` pour le workspace de test.
- Vérifier qu'aucune ligne métier V1 n'a été touchée.
- Conserver les captures/logs anonymisés en cas d'échec.
- Supprimer les seules données de test après validation, après vérification de leurs identifiants et avec accord explicite.

**Important :** le test automatisé `node sync-v2-delta.test.js` est une simulation déterministe. Le test réel décrit ici doit être réalisé avec deux appareils et des sessions authentifiées. Il ne faut pas déclarer la V2 prête tant qu'il n'a pas passé.

## Audit Storage observé (lecture seule)

Le projet Supabase contient déjà le bucket privé `chabanal-files`.

- `public = false`
- Aucune limite de taille ni liste MIME n'est configurée actuellement.
- Politiques Storage observées : SELECT, INSERT et DELETE pour le bucket `chabanal-files`, rôle `authenticated`.
- Aucune politique UPDATE n'a été observée.

Conséquence : ne pas utiliser `upsert: true` pour remplacer un objet tant que la politique UPDATE n'a pas été conçue, vérifiée et testée. La documentation Supabase précise qu'un upsert nécessite INSERT + SELECT + UPDATE. Le bucket est privé : utiliser des téléchargements authentifiés ou des URL signées à durée courte, jamais des URL publiques.

## Stratégie proposée pour migrer les médias

### Principes

1. Ne pas déplacer les médias dans les colonnes JSON de `app_v2_records`. Les enregistrements V2 ne doivent contenir que des métadonnées et un chemin Storage.
2. Conserver un bucket privé et isoler les chemins par workspace et type de ressource.
3. Générer un identifiant de média stable à partir de la clé historique, sans renommer ni modifier le fichier source.
4. Stocker pour chaque média : `media_id`, `workspace_id`, `entity_type`, `entity_id`, `original_name`, `mime_type`, `size_bytes`, `checksum`, `storage_bucket`, `storage_path`, `source_key`, `migration_status`.
5. Uploader d'abord sous un chemin déterministe et sans écrasement ; vérifier ensuite taille et checksum ; seulement après vérification, écrire la référence média V2.
6. Garder les anciennes copies et les files d'attente V1 intactes pendant toute la période de comparaison. Aucun nettoyage automatique.
7. Les suppressions deviennent des tombstones V2 ; ne supprimer un objet Storage qu'après une règle de rétention explicitement validée.

### Sources à traiter séparément

- Fichiers déjà synchronisés dans les clés `app_sync_state` `metier_media_v1_*` : migration cloud-à-cloud, sans télécharger ni passer par le stockage local du téléphone.
- Fichiers encore en attente dans `chabanal_media_pending_v1` : migration depuis chaque appareil source, car ils peuvent ne pas exister dans le cloud.
- Documents intégrés aux modèles d'équipement : extraction et transfert séparés après validation de leur structure.
- Pièces jointes des diagnostics : conserver leur structure d'origine tant que leur format n'est pas entièrement validé.
- Photos de clients : vérifier les clés historiques exactes et les références client avant transfert.

### Phases de migration proposées

1. Inventaire en lecture seule : nombre de fichiers, clés source, propriétaires, tailles, types MIME, doublons et fichiers illisibles.
2. Simulation : calcul du nombre d'objets et du volume total, sans upload.
3. Préparation de sécurité : valider RLS, politiques Storage, limites MIME/taille et chemins d'accès.
4. Pilote sur un petit lot de fichiers de test non sensibles.
5. Migration par lots avec journal de progression et reprise idempotente.
6. Vérification complète par checksum et test d'ouverture depuis les deux appareils.
7. Comparaison V1/V2 pendant une période de coexistence.
8. Bascule uniquement après validation explicite ; aucun effacement de V1 dans cette procédure.

## Conditions préalables avant toute migration réelle

- Authentification réelle validée sur deux appareils.
- Politiques Storage testées avec un utilisateur authentifié et un utilisateur non autorisé.
- Politique UPDATE ajoutée seulement si le remplacement d'objets est réellement requis.
- Limites de taille et MIME définies selon les pièces jointes réellement acceptées.
- Inventaire des objets historiques terminé.
- Procédure de reprise et rapport d'erreurs testés.
- Accord explicite avant tout transfert massif, bascule ou suppression.

## Références techniques

- [Supabase Storage](https://supabase.com/docs/guides/storage)
- [Contrôle d'accès Storage](https://supabase.com/docs/guides/storage/security/access-control)
- [Téléversement de fichiers JavaScript](https://supabase.com/docs/reference/javascript/storage-from-upload)
