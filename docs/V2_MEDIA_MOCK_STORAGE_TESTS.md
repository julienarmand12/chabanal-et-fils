# Banc de test média V2 — stockage simulé

## Objectif et isolation

Le fichier `tests/v2-media-transfer.test.cjs` est un banc de test Node.js autonome. Il utilise uniquement des données synthétiques et un faux stockage en mémoire. Il ne contacte ni Supabase ni aucun service réseau, ne lit pas le navigateur de production et ne touche pas à localStorage.

Commande d'exécution depuis la racine du dépôt :

```bash
node --test tests/v2-media-transfer.test.cjs
```

## Scénarios automatisés

1. Préparer un manifeste et comparer l'empreinte SHA-256 calculée par le module avec une empreinte indépendante Node.js.
2. Refuser un MIME HTML et une Data URL invalide.
3. Copier des octets dans le faux Storage, les relire et vérifier l'égalité des octets et du SHA-256.
4. Refuser l'écrasement d'un objet existant avec `upsert:false` et vérifier que l'original reste intact.
5. Vérifier que l'exécuteur de transfert réel reste bloqué.

## Résultat initial

Exécution locale du banc le 25 novembre 2026 :

- 5 tests exécutés ;
- 5 réussis ;
- 0 échec ;
- 0 appel réseau ;
- 0 écriture Supabase ;
- 0 donnée métier réelle utilisée.

Le faux Storage valide le comportement applicatif de copie/relecture et la règle anti-écrasement. Il ne valide pas les permissions Storage, les policies RLS, les téléchargements authentifiés ni la disponibilité d'un bucket Supabase réel. Ces contrôles restent à faire dans un environnement de test séparé, après inspection de sa configuration.

**Le verrou `ENABLE_REAL_TRANSFER=false` reste en place.** Aucun déploiement, fusion de PR, création de bucket, changement de policy ou migration de données n'est inclus dans cette étape.
