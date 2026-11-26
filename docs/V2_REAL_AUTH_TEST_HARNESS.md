# Banc d'essai V2 avec authentification réelle — TEST uniquement

## Périmètre
- Projet Supabase ciblé : `Test` (`nldylpelvifrpoyphgue`).
- Espace V2 : `ad49e922-7fd9-447d-b5df-0e5de2ce2554`.
- Compte Auth autorisé par la politique RLS : `560058e6-bc5c-4fff-ae80-562cc89b64bb`.
- Aucun accès au projet Supabase principal (`kqdsrezgwlkiezxyqkiv)).
- Aucun branchement avec l'application V1, aucune donnée client réelle, aucun transfert média.

## Fichier
`tests/v2-test-harness.html`

Le fichier embarque uniquement l'URL et la clé publishable du projet TEST. Une clé publishable est destinée au client public ; elle ne confère pas d'accès aux lignes protégées par RLS. Aucune clé `service_role`, clé secrète ou mot de passe n'est embarqué.

## Procédure
1. Télécharger le fichier HTML depuis GitHub et l'ouvrir dans un navigateur moderne.
2. Se connecter avec le compte Auth du projet Supabase Test déjà propriétaire de l'espace. Ne pas utiliser un compte de production différent.
3. Cliquer sur **Vérifier l'accès et l'espace**. La lecture de l'espace doit réussir.
4. Sur le premier téléphone, cliquer sur **Exécuter le test API complet**.
5. Sur le second téléphone, ouvrir le même fichier, se connecter avec le même compte de test et cliquer sur **Lire les changements (test 2e appareil)**.
6. Comparer les identifiants d'appareil : ils doivent être différents. Le second appareil doit recevoir les événements synthétiques du premier.
7. Se déconnecter sur chaque appareil à la fin.

## Assertions du test API
- Auth réelle par `signInWithPassword`.
- Identité utilisateur vérifiée contre l'UUID autorisé.
- Lecture de l'espace soumise à RLS.
- Upsert d'un appareil.
- Insertion d'une fiche synthétique `TEST-...` : révision 1.
- Modification avec contrôle de révision : révision 2.
- Vérification des deux événements du journal.
- Suppression logique : révision 3 et événement `delete`.
- Écriture du curseur de synchronisation.
- Lecture delta depuis le second appareil.

## Limites / précautions
- Le test nécessite une session Auth valide pour le compte TEST. Aucun identifiant ni mot de passe n'est enregistré dans GitHub.
- Les navigateurs doivent pouvoir charger le CDN jsDelivr et joindre l'API Supabase.
- Si l'erreur indique que la relation/table n'est pas exposée, vérifier les réglages Data API du projet Test ; ne pas modifier le projet principal.
- Les fiches de test sont volontairement conservées comme tombstones afin que le second appareil puisse recevoir le dernier événement de suppression.
- Le test HTTP réel n'a pas encore été exécuté par l'équipe tant que l'utilisateur n'a pas ouvert le fichier et fourni une session Auth dans son propre navigateur.
- Ce banc ne valide pas encore le pont V1→V2, la migration des données métier, les médias, ni la mise en production.

## Sécurité
Ne jamais ajouter de clé secrète/service_role, de mot de passe, de JWT, ni de jeton de session dans ce fichier ou dans le dépôt. Ne jamais activer le pont V2 sur l'application de production dans le cadre de ce test.
