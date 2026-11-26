# Chabanal et fils — stockage média V2 et validation multi-appareils

## État et périmètre

Ce document prépare la prochaine étape de V2. Il ne crée aucun bucket, aucune policy, aucun objet Storage et ne déplace aucune donnée. Le moteur V1 reste le moteur actif. La migration des données réelles est interdite tant que les validations ci-dessous ne sont pas signées.

## 1. Constat sur les pièces jointes V1

Le module `media-sync.js` stocke actuellement les fichiers sous forme de Data URL/base64 dans `public.app_sync_state.value_json`, avec des clés `metier_media_v1_...`. Il conserve aussi une file locale `chabanal_media_pending_v1`. Les fichiers sont actuellement plafonnés à 3 Mo dans le module. Les anciennes photos client et pièces jointes diagnostic peuvent encore être incorporées dans les données historiques.

Conséquences :
- les fichiers binaires gonflent les lignes JSON et la base ;
- les Data URL dans localStorage aggravent les risques de quota sur les téléphones ;
- la migration des médias ne peut pas être traitée comme une simple copie des enregistrements JSON ;
- les pièces déjà synchronisées dans `app_sync_state` doivent être lues côté source puis transférées séparément vers Storage.

Aucun contenu de fichier ne doit être placé dans `app_v2_records.payload`. Ce champ ne doit contenir que les métadonnées et la référence Storage.

## 2. Cible proposée

Créer un bucket Supabase **privé** nommé `app-v2-media`. Les fichiers restent privés ; aucune URL publique ne doit être persistée dans les fiches.

Chemin canonique :
`<workspace_id>/<entity_type>/<record_id>/<media_id>.<extension>`

Métadonnées d'un enregistrement V2 de type `media` :
- `id` : identifiant média stable ;
- `scope` : client, équipement ou diagnostic ;
- `owner_id` : identifiant de la fiche propriétaire ;
- `name`, `mime`, `size_bytes` ;
- `storage_bucket` : `app-v2-media` ;
- `storage_path` : chemin canonique ;
- `sha256` : empreinte du contenu pour contrôle d'intégrité ;
- `created_at`, `deleted_at` ;
- éventuellement `legacy_source_key` pour tracer la source sans recopier son contenu.

Ne pas conserver de Data URL dans ce payload. Ne jamais placer la clé `service_role` dans le navigateur.

## 3. Contrôles de sécurité obligatoires avant activation

1. Bucket privé, limites de taille et types MIME autorisés définis au niveau du bucket.
2. Policies RLS sur `storage.objects` limitées au bucket `app-v2-media` et au workspace autorisé.
3. Vérifier l'appartenance au workspace à partir d'une source fiable côté base ; ne pas faire confiance à un workspace fourni librement par le client.
4. Upload, lecture et suppression testés avec un vrai JWT utilisateur ; aucune lecture anonyme.
5. Les règles Storage sont distinctes des policies des tables `app_v2_*` : les deux doivent être auditées.
6. Les téléchargements passent par le SDK authentifié ou par des URL signées à durée courte ; aucune URL signée persistée dans les fiches.
7. Le navigateur n'embarque jamais de clé secrète/service role.
8. Pour les fichiers volumineux ou les réseaux instables, utiliser l'upload résumable TUS ; pour les petits fichiers, upload standard avec reprise applicative.
9. Ne pas utiliser `upsert` pour écraser un objet média existant : générer un nouveau `media_id` et un nouveau chemin. Cela évite les collisions entre appareils et les contenus CDN périmés.
10. Valider le MIME réel et la taille côté serveur autant que possible ; ne pas se fier uniquement au nom ou au MIME fourni par le navigateur.

## 4. Migration sans perte

La migration doit être une copie en deux phases, jamais un déplacement direct :

### Phase A — inventaire en lecture seule
- parcourir les médias locaux en attente, les photos client historiques, les pièces jointes diagnostic et les lignes `metier_media_v1_*` de `app_sync_state` ;
- produire un manifeste avec source, propriétaire, taille, MIME, hash, état et éventuelle destination ;
- repérer les Data URL invalides, les doublons de contenu et les références orphelines ;
- ne supprimer ni ne modifier aucune source.

### Phase B — copie et vérification
Pour chaque fichier :
1. lire le binaire depuis la source sans effacer la source ;
2. calculer SHA-256 ;
3. envoyer sous un nouveau chemin Storage unique ;
4. télécharger l'objet depuis Storage et recalculer SHA-256 ;
5. comparer les empreintes et tailles ;
6. créer ensuite seulement le pointeur `media` dans `app_v2_records` ;
7. enregistrer le résultat dans un manifeste de migration idempotent.

Si une étape échoue, marquer l'élément en échec et conserver la source. Une reprise doit réutiliser le manifeste, vérifier si le même objet existe et ne jamais créer un doublon sans nécessité.

### Phase C — contrôle de cohérence
- comparer nombre de médias source, copiés, vérifiés, en échec et ignorés ;
- vérifier les références client/équipement/diagnostic ;
- tester l'ouverture sur deux appareils ;
- obtenir une sauvegarde exportée avant toute décision de nettoyage.

**Aucune suppression des Data URL V1 ou des fichiers locaux n'est autorisée par cette procédure.** Le nettoyage sera une opération ultérieure, séparée, avec accord explicite et preuve de restauration.

## 5. Protocole réel à deux téléphones

Préconditions :
- deux appareils connectés au même compte utilisateur autorisé ;
- V1 toujours active et données sauvegardées ;
- build de test isolé, jamais l'application de production ;
- workspace de test séparé, sans données clients réelles ;
- journaux de test horodatés et identifiants de test reconnaissables.

Scénarios et critères d'acceptation :

| Test | Action | Résultat attendu |
|---|---|---|
| Appairage | Enregistrer les deux appareils | Deux identifiants distincts, même workspace |
| Création | Téléphone A crée une fiche test | B reçoit une seule création |
| Modification | B modifie la fiche | A reçoit la nouvelle révision |
| Conflit | A et B modifient la même révision hors ligne | Une écriture est refusée en conflit, aucune perte silencieuse |
| Suppression | B supprime la fiche test | A reçoit un tombstone, pas de résurrection |
| Hors ligne | A crée hors ligne puis revient en ligne | Une seule création est appliquée |
| Reprise | Couper le réseau pendant un pull | Le curseur ne dépasse jamais le dernier événement traité |
| Médias | A envoie une photo et un PDF | B les ouvre ; taille et SHA-256 identiques |
| Isolation | Utiliser un utilisateur non autorisé | Aucun accès aux fiches ou objets |
| Redémarrage | Fermer/réouvrir les deux navigateurs | Les curseurs reprennent sans doublon |

Un test est réussi uniquement si les données finales concordent sur A, B et le serveur, si aucun conflit n'est silencieusement écrasé et si les journaux ne montrent aucune erreur non traitée.

## 6. Feuille de validation à remplir

- Date / build :
- Workspace de test :
- Appareil A / navigateur :
- Appareil B / navigateur :
- Création :
- Modification :
- Conflit :
- Suppression :
- Hors ligne / reprise :
- Photo + PDF / empreintes :
- Isolation :
- Redémarrage :
- Écarts observés :
- Décision : accepté / refusé / à corriger.

## 7. Inventaire média local — implémenté en prévisualisation

Le module `v2-media-inventory.js` analyse en lecture seule les Data URL issues du mapper V1 et de la file locale des pièces jointes. Il contrôle l'encodage, le MIME, la limite de 3 Mo, calcule SHA-256 lorsque Web Crypto est disponible, signale les doublons potentiels et inspecte les métadonnées des événements média déjà reçus dans la zone tampon. Un manifeste JSON peut être exporté sans contenu binaire.

Limites : le module ne lit pas les lignes distantes `metier_media_v1_*` de l'ancien `app_sync_state`, ne télécharge aucun objet Storage et ne vérifie donc pas l'intégrité des objets distants. Aucun transfert, déplacement ou nettoyage n'est effectué.

## 8. Préparation du transfert média — implémentée en dry-run

Le module `v2-media-transfer.js` prépare un manifeste de copie à partir des médias locaux issus du mapper :
- validation stricte de la Data URL, du MIME autorisé et de la taille (3 Mo maximum) ;
- décodage binaire et calcul SHA-256 obligatoire ;
- préparation du bucket cible privé `app-v2-media` et du chemin déterministe workspace/type/propriétaire/média ;
- export du manifeste JSON et liste des éléments rejetés.

Le bouton est intégré au panneau de prévisualisation. **Le transfert réel est verrouillé dans le code** (`ENABLE_REAL_TRANSFER=false`) : la fonction d'exécution refuse de démarrer. Aucun appel Storage, aucune écriture V2 et aucune modification V1 ne sont possibles via ce module à ce stade. Le manifeste ne contient pas les octets ni les Data URL, seulement les métadonnées et empreintes.

La documentation Supabase confirme qu'un bucket privé impose les contrôles RLS aussi bien en lecture qu'en écriture ; le téléchargement privé se fait via le SDK authentifié ou une URL signée temporaire. L'upload standard documenté permet de désactiver l'écrasement avec `upsert:false`. Ces règles devront être respectées lors de l'implémentation réelle.

## 9. Ordre de réalisation retenu

1. Valider les policies et le bucket privé en environnement de test.
2. Développer un adaptateur média isolé qui ne modifie pas `media-sync.js`.
3. Tester upload, download, hash, suppression logique et reprise.
4. Construire un export/manifeste de migration en lecture seule.
5. Exécuter une migration pilote sur un jeu de données synthétique.
6. Faire les tests réels sur deux téléphones.
7. Présenter un bilan et demander un accord distinct avant toute bascule ou migration réelle.
