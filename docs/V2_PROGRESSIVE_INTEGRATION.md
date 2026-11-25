# Intégration progressive du moteur V2 — étape de préparation

## Ce qui est intégré dans cette branche

- Le moteur delta V2 reste isolé dans `sync-v2-delta.js`.
- Le mapper V1 vers V2 reste un inventaire en mémoire.
- Le panneau de synchronisation affiche un contrôle préalable V2.
- Le bouton lance uniquement un inventaire local : nombre d'enregistrements, répartition, erreurs et avertissements.

## Garanties de cette étape

- Aucun appel à Supabase depuis le bouton de prévisualisation.
- Aucun `save`, `remove`, `pullDelta` ni transfert de média.
- Aucune écriture ou suppression dans `localStorage`.
- Aucune migration, fusion ou modification des données métier.
- Le moteur V1 demeure le seul moteur opérationnel.

## Pourquoi la bascule n'est pas encore activée

Le mapper actuel identifie encore des médias locaux et des documents historiques qui doivent être transférés séparément vers un bucket privé. Le stockage des médias doit utiliser des références Storage et non des Data URL dans `app_v2_records.payload`. Les documents déjà présents dans l'ancien `app_sync_state` nécessitent aussi un inventaire cloud-à-cloud.

Le protocole réel à deux appareils n'a pas encore été exécuté. Il faut d'abord finaliser l'adaptateur média, valider les policies Storage et tester sur un workspace de test avec des données synthétiques.

## Étapes suivantes avant toute activation

1. Corriger le mapping pour exclure les contenus binaires des payloads V2.
2. Ajouter un adaptateur média privé avec vérification SHA-256 et manifeste de reprise.
3. Exécuter les tests automatisés du moteur et de ses conflits de révision.
4. Valider création, modification, suppression logique, reprise hors ligne et médias sur deux téléphones de test.
5. Présenter un bilan et demander un accord distinct avant migration réelle ou bascule de production.


## Pont des opérations métier (envoi sortant uniquement)

Le fichier `v2-operation-bridge.js` est chargé depuis le panneau de contrôle. Il surveille les écritures des clés métier V1 et, uniquement après activation explicite dans l'interface, transmet les enregistrements normalisés au moteur delta V2 avec contrôle de révision.

Garde-fous :
- Le pont reste désactivé par défaut.
- L'activation demande une confirmation avant le premier envoi.
- Les médias et les documents encore intégrés en Data URL bloquent l'envoi ; aucun contenu binaire n'est envoyé dans les payloads métier.
- Les erreurs et conflits arrêtent l'envoi concerné ; les données V1 restent la référence locale.
- Aucun pull V2 vers V1 n'est encore branché. Ne pas activer sur le second téléphone et ne pas considérer cette étape comme une synchronisation multi-appareils.
- Aucun changement n'a été déployé sur l'application en production.

La prochaine étape est l'adaptateur de réception V2 -> V1, la reprise des curseurs et l'adaptateur Storage privé, puis des tests sur deux appareils avec données synthétiques.


## Réception V2 — zone tampon, pas de fusion V1

Le module `v2-inbound-staging.js` prépare une réception contrôlée des événements du journal V2 :
- les événements sont conservés dans une zone tampon locale plafonnée (2 000 événements / 3 Mo) ;
- les événements déjà reçus sont dédupliqués par numéro de séquence ;
- les médias contenant une Data URL, ou sans référence Storage privée, bloquent la réception ;
- une exportation JSON de la zone tampon est prévue ;
- aucun événement n'est automatiquement fusionné dans les clés métier V1.

**Blocage d'intégration identifié :** le client Supabase V1 (`sb`) est déclaré dans une portée JavaScript privée et n'est pas exposé aux modules V2. Le module de réception exige donc un client explicite et le pont sortant vérifie `window.chabanalSupabaseClient`. Cette propriété n'est pas encore fournie par V1. En l'état, ni le pull ni le push ne doivent être considérés comme opérationnels dans l'application.

La prochaine modification nécessaire est un point d'accès contrôlé au client Supabase après authentification, sans exposer de clé secrète et sans créer une seconde session Auth. Ensuite seulement : tests avec données synthétiques, mapping inverse et résolution des conflits avant toute écriture dans les clés V1.
