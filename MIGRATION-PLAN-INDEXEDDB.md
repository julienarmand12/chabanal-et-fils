# Migration progressive des fiches clients vers IndexedDB

## État actuel

- Le module `client-store.js` est isolé et validé par les tests automatisés Chromium.
- L'application métier continue d'utiliser son stockage actuel `localStorage`.
- Aucun appel de l'application à `ChabanalClientStore` n'est activé.
- La copie historique `metier_clients_v1_2_corrigee` n'est jamais supprimée par le module.
- Cette branche ne doit pas être fusionnée dans `main` à ce stade.

## Étape 1 — Précontrôle local, sans écriture (ajouté)

Ouvrir `client-store-preflight.html` séparément sur chacun des deux téléphones.

Ce contrôle est strictement en lecture seule. Il vérifie :
- la présence de la sauvegarde locale des clients ;
- la validité du JSON et le fait qu'il s'agit d'une liste ;
- le nombre de fiches ;
- les fiches sans identifiant et les identifiants en doublon ;
- la disponibilité d'IndexedDB et, si le navigateur le permet, une estimation du stockage.

Le rapport ne contient aucun nom, adresse, téléphone, note, ni contenu de fiche. Il ne contacte pas Supabase et n'écrit ni dans localStorage ni dans IndexedDB.

**Critère de passage :** les deux téléphones ont un JSON valide, zéro fiche sans identifiant, zéro identifiant en doublon, et les compteurs ont été rapprochés du diagnostic de synchronisation. En cas d'écart, arrêt et investigation.

## Étape 2 — Sauvegardes indépendantes

Avant tout essai d'écriture, produire une sauvegarde JSON indépendante depuis chaque téléphone, puis vérifier que les fichiers sont bien enregistrés et lisibles. Ne jamais considérer une seule sauvegarde cloud comme substitut aux deux copies locales.

## Étape 3 — Mode miroir contrôlé (à développer, non activé)

Après validation des étapes 1 et 2, développer un mode qui :
1. lit d'abord les données depuis localStorage comme aujourd'hui ;
2. écrit une copie dans IndexedDB ;
3. relit immédiatement cette copie et compare son contenu de façon stable ;
4. conserve localStorage comme source de secours ;
5. n'envoie aucune donnée supplémentaire à Supabase ;
6. journalise seulement les résultats techniques, sans contenu personnel.

Aucune lecture applicative ne doit encore dépendre d'IndexedDB pendant cette étape.

## Étape 4 — Bascule de lecture sur un appareil pilote (à développer, non activée)

Après plusieurs synchronisations et rechargements réussis en mode miroir :
- activer la lecture IndexedDB uniquement derrière un drapeau explicite et réversible ;
- utiliser un seul téléphone pilote ;
- en cas d'erreur, de snapshot invalide ou de différence de comptage/contenu, revenir à localStorage sans supprimer aucune copie ;
- ne pas changer la stratégie de synchronisation Supabase dans la même livraison.

## Étape 5 — Généralisation (à valider séparément)

Étendre au second téléphone seulement après validation documentée du pilote. Ne retirer localStorage qu'après une période de fonctionnement stable et une décision explicite distincte.

## Interdictions tant que les étapes précédentes ne sont pas validées

- Ne pas modifier la branche `main`.
- Ne pas lancer de migration réelle sur les téléphones.
- Ne pas modifier ni remplacer les données Supabase.
- Ne pas vider le cache, les données du navigateur, ni désinstaller la PWA.
- Ne pas mélanger migration du stockage local et refonte de la synchronisation cloud.

## Retour arrière

Tant que localStorage est conservé, l'application existante reste le chemin de retour. Toute étape future devra être livrée avec un contrôle d'intégrité avant activation et un mécanisme de désactivation immédiat.
