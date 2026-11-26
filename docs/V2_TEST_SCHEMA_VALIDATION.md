# Validation du schéma V2 — projet Supabase Test

## Périmètre

Le schéma décrit dans `docs/sql/v2_delta_test_schema.sql` a été appliqué uniquement au projet Supabase **Test** (`nldylpelvifrpoyphgue`). Il est raccordé à l'identifiant de workspace déjà utilisé par `sync-v2-delta.js` dans cette branche et à l'utilisateur Auth de test autorisé.

Ne pas appliquer ce script au projet principal : il s'agit d'une préparation isolée, pas d'une migration de production.

## Tables créées

- `app_v2_workspaces` : workspace et propriétaire.
- `app_v2_devices` : appareils enregistrés.
- `app_v2_records` : état courant par type et identifiant, avec révision.
- `app_v2_change_log` : journal ordonné des changements.
- `app_v2_sync_cursors` : curseur propre à chaque appareil.

Les cinq tables ont RLS activé. Le rôle `anon` n'a aucun privilège sur ces tables. Le rôle `authenticated` dispose uniquement des opérations nécessaires au client delta : lecture du workspace et du journal ; lecture, insertion et mise à jour des appareils, enregistrements et curseurs. Aucune suppression physique n'est accordée.

Les clés étrangères de propriétaire et de dernier modificateur disposent d'index dédiés pour éviter les avertissements de performance sur les recherches de référence.

Les fonctions de déclenchement sont placées dans le schéma non exposé `private`, avec `search_path` fixé. Elles calculent la révision côté serveur et ajoutent un événement au journal dans la même transaction que l'écriture métier.

## Vérifications effectuées

- Identité autorisée simulée : accès au workspace de test.
- Identité non autorisée simulée : zéro ligne visible dans les cinq tables V2.
- Parcours transactionnel avec identité autorisée : enregistrement d'un appareil, insertion d'une fiche (révision 1), modification (révision 2), création de deux événements et mise à jour du curseur.
- Transaction de test annulée : aucun appareil, aucune fiche, aucun événement et aucun curseur synthétique conservé.
- État persistant après test : un workspace de test ; zéro appareil, zéro enregistrement, zéro événement et zéro curseur.

Ces tests SQL simulent le contexte Auth/RLS au niveau PostgreSQL. Ils ne remplacent pas encore un test HTTP/Data API avec une vraie session Auth ni un test réel sur deux téléphones.

## Validation automatisée du code

Le workflow GitHub Actions **V2 progressive integration preview**, run #4, est terminé avec succès : syntaxe de tous les modules V2, tests du mapper, simulation delta à deux appareils et cinq tests du transfert média simulé (5/5 réussis).

## Garde-fous inchangés

- Pont sortant V1 → V2 désactivé par défaut.
- Aucun événement métier V1 transféré.
- Aucun média transféré.
- Aucune fusion V2 → V1.
- Aucun déploiement ni fusion de cette PR.
- V1 reste le moteur opérationnel.
