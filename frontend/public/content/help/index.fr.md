# Documentation KP Rück

Remplacement numérique du tableau magnétique du poste de commandement. Gère les interventions, le personnel et le matériel de manière centralisée et en temps réel.

## Vues

### Tableau kanban (`G K`)
Vue principale au chargement de l’application. Affiche toutes les interventions dans sept colonnes de statut (Reçu → Clôturé). À gauche la barre latérale du personnel, à droite le matériel et les véhicules.

**La vue reste telle qu’on l’a réglée.** Les barres latérales repliées, le panneau latéral et une liste de mise en route écartée survivent à un rechargement – mémorisés par appareil, comme les autres réglages d’affichage.

**« 3 engins sur place » en tête de la barre du matériel.** Le matériel qu’une équipe a laissé quelque part est autrement invisible sur le tableau – il n’est ni libre ni visiblement en service. La liste dépliante indique l’engin, l’adresse et depuis quand, le plus ancien en haut ; un clic ouvre l’intervention correspondante. Elle n’apparaît que s’il y a réellement quelque chose dehors.

**« Rapports » dans la barre du bas.** Compte les places sinistrées terminées pour lesquelles aucun rapport de place sinistrée n’a encore été saisi, et ouvre la liste – **Ouverts** (le plus ancien en haut, car à la fin plus personne ne s’en souvient) et **Saisis**. Un clic sur une ligne saute à l’intervention.

### Vue carte (`G M`)
Vue d’ensemble géographique de tous les lieux d’intervention. Des marqueurs colorés indiquent la priorité (vert/jaune/rouge).

**Comportement au clic :**
- **Marqueur / carte de la liste (simple clic)** : sélectionne l’intervention et zoome sur le marqueur
- **Carte de la liste (double clic)** : ouvre la fenêtre de détail complète (modale)

**Légende de la carte :**
- **Priorité (remplissage) :** vert = basse, jaune = moyenne, rouge = haute
- **Statut (cadre) :** tirets = ouverte, trait plein = en cours, pointillés + estompé = terminée
- **Véhicules (GPS) :** bleu = en ligne, gris = hors ligne

**Clavier :** `L` étiquettes, `I` lignes, `1-5` afficher un véhicule – voir [Raccourcis clavier](#raccourcis-clavier).

### Panneau latéral (kanban)
Sur les écrans larges (>1280 px), un panneau latéral apparaît à droite avec les **détails** de l’intervention sélectionnée (édition de l’intervention). Se replie et se déplie avec `I` ou `\`. Il n’y a plus de mini-carte dans le panneau – la carte est une page à part (`G M`), et `K` y ouvre l’intervention sélectionnée.

**Comportement au clic :**
- **Simple clic** : affiche les détails de l’intervention dans le panneau latéral
- **Double clic** : ouvre la fenêtre de détail complète (modale)

### Événements (`G E`)
Gérer, changer, archiver et exporter les événements.

### Réglages (`G S`)
Configuration du système : utilisateurs, synchronisation, imprimante, style de carte et plus encore.

### Aide (`G H`)
Cette page de documentation.

**Réel vs exercice :** un événement peut être marqué « exercice ». Le badge « Exercice » apparaît et les données sont tenues séparément. Les événements réels viennent de Divera.

**Export d’audit :** Réglages → Import/export → choisir un événement → export Excel. Contient toutes les interventions, les attributions (historique compris), les changements de statut et les rapports de reconnaissance. Pour la facturation et le débriefing. Le journal d’audit est nettoyé automatiquement en arrière-plan (conservation par défaut 90 jours, 7 jours en mode démo), afin que la table ne grossisse pas indéfiniment.

**Impression et export :** barre du bas → « Imprimer » ou touche `D` ouvre **un seul** panneau à trois colonnes – tout ce qui part sur papier ou dans un fichier au même endroit :
- **Impression thermique** – instantané du tableau sur l’[imprimante thermique](#imprimante-thermique)
- **Imprimer l’état (A4)** – aperçu avant impression avec options : filtrer les interventions par statut, vue d’ensemble cartographique (montre tous les lieux d’intervention sur une carte), afficher l’état des véhicules
- **Export** – rapport (PDF), feuille de situation (A4) et audit (XLSX) comme fichier sur cet appareil

---

## Vues d’affichage (multi-écrans)

Pour les postes de commandement dotés de plusieurs écrans, des pages d’affichage spéciales existent sous `/display`. Elles sont en lecture seule – aucune fonction d’édition.

**Accès :** menu utilisateur → section « Affichage » (s’ouvre dans un nouvel onglet), ou directement `/display`.

### Carte de situation (`/display/map`)
Carte plein écran sans barre latérale. Montre tous les lieux d’intervention, les positions GPS des véhicules et les lignes d’attribution animées (véhicule → intervention). Idéal pour un écran de situation central.

### Tableau (`/display/board`)
Tableau kanban sans possibilité d’édition. Les 7 colonnes de statut sont mises à l’échelle uniformément sur la largeur de la fenêtre – même sur un écran mural étroit, aucune colonne ne reste dehors. **Clôturé** est replié par défaut.

C’est **la même carte d’intervention qu’au poste de commandement**, seulement sans les commandes – mêmes blocs, même ordre, y compris la personne de reconnaissance, le marqueur de rapport, l’effectif et le matériel avec leurs noms, l’annonceur et un ramassage en attente. Le détail montre en plus les messages radio du groupe.

Le mur ne suit **pas** la « Vue » de l’opérateur : *Compact* existe pour caser plus de cartes sur un tableau auquel on travaille – un mur, lui, doit être lisible à cinq mètres. La page d’affichage n’a pas de commutateur pour cela et montre donc toujours la carte complète.

### État (`/display/status`)
Vue à quatre colonnes : véhicules, interventions (groupées par statut), personnel (groupé par rôle) et matériel (groupé par emplacement). Pour les ressources attribuées, le lieu d’intervention est indiqué. S’agrandit automatiquement sur les grands écrans.

### Replier des sections

Dans les vues d’affichage, chaque section peut être repliée – colonnes du tableau, groupes de statut, fonctions pour le personnel, catégories pour le matériel. Dans un corps plus grand, on ne ferait sinon que défiler.

- **L’état par défaut est déplié.** Rien ne se cache à quelqu’un qui vient de s’approcher. Seule exception : **CLÔTURÉES** démarre replié – c’est du travail fait.
- **Un en-tête replié continue d’indiquer le nombre et l’état :** le nombre d’entrées, pour le personnel et le matériel combien sont libres, et un point rouge dès qu’une intervention de cette section est en retard. Replier, c’est cacher – et à 3 heures du matin, rien d’important n’a le droit de se cacher.
- **L’état est mémorisé par appareil**, comme les autres réglages d’affichage. L’écran mural, la tablette sur la table et le portable au fond ne sont pas à la même distance ; ce qui est replié appartient à l’écran, pas à l’intervention.

### Synchronisation entre fenêtres
Toutes les vues d’affichage se synchronisent avec la fenêtre de l’éditeur : lorsqu’une intervention est sélectionnée sur l’écran principal, la carte d’affichage saute au marqueur correspondant et le tableau d’affichage met la carte en évidence – et inversement.

### Style de carte
Sous Réglages → Style de carte, on peut passer d’un style à l’autre : OpenStreetMap (standard), topographique (Esri), Voyager/clair (CARTO) et sombre (CARTO).

### Offline-Maps
La carte va normalement chercher ses tuiles sur Internet. Si la connexion tombe, elle reste vide – précisément dans la situation où l’on en a besoin. C’est à cela que sert le serveur de tuiles fourni.

Sous **Réglages → Mode carte**, trois réglages sont possibles :

- **Auto** (par défaut) : d’abord en ligne, bascule automatiquement hors ligne en cas d’erreur.
- **En ligne** : toujours depuis Internet.
- **Hors ligne** : toujours depuis le serveur de tuiles local.

Les tuiles hors ligne doivent être téléchargées une fois, et pour **votre** région – le réglage par défaut couvre Bâle-Campagne. C’est la personne qui s’occupe du serveur qui le fait, avec `just tiles-download` sur l’hôte Docker ; la marche à suivre est dans `docs/OFFLINE_MAPS.md`. Le téléchargement est volumineux et long : il se fait un après-midi calme, pas la veille d’un exercice.

Pour vérifier que cela a fonctionné, `just tiles-status` distingue « uniquement les tuiles minimales de départ » de « vraies données hors ligne pour la région ».

---

## Recherche

La barre de recherche (`S` ou `/`) parcourt toutes les interventions par adresse, genre, texte de l’annonce et **nom de mission** – qui cherche l’itinéraire en trouve les étapes. Idéal pour retrouver rapidement la bonne carte quand il y a beaucoup d’interventions.

Sur les pages d’affichage [Tableau](#tableau-displayboard) et [État](#état-displaystatus), la même recherche se trouve dans l’en-tête, avec les deux mêmes touches – qui passe du PC à l’écran mural n’a rien de second à retenir. Elle ne réagit pas tant qu’un champ a le curseur ou qu’une fenêtre est ouverte.

---

## Genres d’intervention

| Genre | Description |
|-----|-------------|
| Lutte contre le feu | Éteindre un feu, garde d’incendie |
| Événement naturel | Intempéries, inondation, tempête |
| Sauvetage routier | Accidents de la circulation, personnes coincées |
| Aide technique | Ouvertures de porte, sauvetage en ascenseur, dégâts d’eau |
| Défense contre les hydrocarbures | Traces d’huile, fuite de carburant |
| Défense chimique | Accidents chimiques, marchandises dangereuses |
| Défense contre les radiations | Matières radioactives |
| Intervention sur installations ferroviaires | Accidents sur les voies et dans les gares |
| DAI / fausses alarmes | Détection automatique d’incendie, fausses alarmes |
| Prestations de service | Essaims d’abeilles, chat dans un arbre |
| Interventions diverses | Tout le reste |
| Personnes sauvées | Documenter le sauvetage de personnes |
| Animaux sauvés | Documenter le sauvetage d’animaux |

---

## Cartes d’intervention

Chaque carte montre : adresse, genre, ressources attribuées, priorité et ancienneté.

### Priorités

| Niveau | Badge (carte) | Marqueur (carte) | Raccourci |
|-------|---------------|----------------|----------|
| Basse | Gris | Vert | `Shift+1` |
| Moyenne | Orange | Jaune | `Shift+2` |
| Haute | Rouge | Rouge | `Shift+3` |

### Indicateurs d’ancienneté

Ils montrent depuis combien de temps une intervention est ouverte :

- **Vert** = nouvelle (< 15 min)
- **Jaune** = en cours (15–60 min)
- **Orange** = ouverte depuis un moment (1–2 h)
- **Rouge** = ouverte depuis longtemps (> 2 h) – demande de l’attention

### Entraide

Pour les interventions avec l’appui d’un corps voisin, « Entraide » peut être activée. Clic droit sur la carte → « Entraide », ou dans la fenêtre de détail. Les interventions marquées affichent une icône de bâtiment.

### Badge téléphone / guichet

Les alarmes saisies via le [lien d’alarme](#lien-dalarme-téléphone-guichet) affichent en haut à droite un **symbole de téléphone** bleu (aligné avec les autres symboles de statut). Il signale les annonces provenant d’une source non vérifiée, que la conduite de l’intervention devrait contrôler.

### Vue – ce qui figure sur les cartes

Le menu **Vue** se trouve dans la barre du bas. Il détermine les blocs qu’affiche une carte d’intervention : genre d’intervention, horaires, annonce, annonceur, effectif, véhicules, matériel, mission et reconnaissance – neuf commutateurs, plus trois modèles comme point de départ :

- **Compact** – seulement l’en-tête de la carte (le plus d’interventions possible à l’écran)
- **Standard** – tout sauf l’annonceur
- **Tout** – en plus l’annonceur et son numéro de téléphone

Un modèle règle les neuf commutateurs ; ensuite, un commutateur ne change que lui-même, rien ne revient en arrière. **L’adresse, la priorité et tous les avertissements** (ramassage, rapport, annonce du terrain) ne peuvent pas être désactivés.

Le réglage vaut **par appareil** et survit à un rechargement – deux postes de travail sur le même événement ont le droit de diverger, et un clic ici ne repeint le tableau de personne d’autre. Les pages d’affichage sous `/display` ne le suivent pas : un mur doit être lisible à cinq mètres et montre toujours la carte complète.

### Icône de carte

Les interventions dotées de coordonnées affichent une petite icône de carte en haut à droite. Un clic dessus ouvre la vue carte avec l’intervention mise en évidence.

### Menu contextuel (clic droit)

Un clic droit sur une carte d’intervention ouvre un menu avec les options suivantes :

| Action | Description |
|--------|-------------|
| Modifier | Ouvre la fenêtre de détail |
| Attribuer la reconnaissance | Choisir un officier pour la reconnaissance préalable |
| Attribuer un véhicule | Attribuer directement un véhicule |
| Entraide | Marque l’intervention comme impliquant un corps voisin |
| Montrer sur la carte | Saute à la vue carte |
| Imprimer la fiche d’intervention | Imprime sur l’imprimante thermique (uniquement si activée) |

---

## Comment ça marche : déroulements types

### Liste de contrôle (au démarrage du PC arrière)

S’ouvre d’elle-même dès qu’un événement est sélectionné, puis reste accessible
par **« Checklist n/m »** dans la barre du bas. Elle guide ce qui doit se passer
dans les premières minutes : informer l’effectif, distribuer les liens d’arrivée,
de reconnaissance, d’alarme et de terrain, attribuer les conducteurs, vérifier
l’imprimante, armer le repli papier.

- **Les lignes chiffrées se cochent toutes seules** (personnes annoncées,
  conducteurs par véhicule, imprimante joignable). Chaque ligne peut en plus être
  cochée et décochée **à la main** – retenu par appareil.
- **Sous les lignes de lien figure à qui il est destiné et combien d’exemplaires
  imprimer** (« Pour chaque équipe qui part · 1 exemplaire par véhicule »). Si une
  imprimante thermique est joignable, la ligne imprime le code QR ; sinon elle
  copie le lien.
- **Adaptable :** Réglages → Checklist. Chaque étape peut y être **masquée** (une
  étape masquée ne compte plus dans la progression) et la note remplacée par vos
  propres chiffres.

### Une nouvelle intervention arrive

1. Appuyer sur `N` ou cliquer sur « Nouvelle intervention »
2. Saisir l’adresse et le genre
3. L’intervention apparaît dans « Reçu »
4. Définir la priorité (`Shift+1/2/3`)
5. Décider : engager directement ou d’abord reconnaître ?

### Faire une reconnaissance

1. Déplacer l’intervention dans « Reconnaissance » (glisser ou `>`)
2. Marquer un officier comme « Reconnaissance » par clic droit
3. Copier le lien et l’envoyer par WhatsApp → l’officier l’ouvre sur place
4. L’officier clique sur « Je suis sur place » → le poste de commandement voit l’arrivée avec l’horodatage
5. Remplir le formulaire de reconnaissance, téléverser des photos
6. Sur la base du rapport : engager ou clôturer

**Où atterrit le résultat de la reconnaissance :** dans le détail de l’intervention – y compris dans les vues d’affichage sous `/display` – la rubrique **Résultat de la reconnaissance** donne l’appréciation, les dangers, les besoins en personnel et en temps, le texte de situation **et les photos téléversées**. Un clic sur une image l’ouvre en taille réelle. Les images sont **aussi** visibles via un lien de partage – sans connexion, pour toute personne qui détient le lien. Seules apparaissent alors les photos des rapports de reconnaissance **envoyés** de l’événement lié ; les photos d’un brouillon et celles du rapport de place sinistrée restent derrière l’authentification. Qui transmet le lien transmet les photos de reconnaissance avec.

**Sans téléphone dehors :** si l’officier annonce par radio plutôt que par le lien,
le même rapport est saisi au PC – voir
[Tout saisir depuis le PC](#tout-saisir-depuis-le-pc-quand-les-téléphones-lâchent).

**État de la reconnaissance sur les cartes :**
- Aucune icône : aucune activité de reconnaissance
- Jumelles (gris) : officier sur place, apprécie la situation (« sur place HH:MM » à côté du nom)
- Jumelles (vert avec fond) : rapport de reconnaissance remis

### Attribuer des ressources et envoyer

1. Attribuer des véhicules : touches `1-5`
2. Faire glisser personnel et matériel sur la carte d’intervention (glisser-déposer)
3. Déplacer l’intervention dans « Engagé »
4. Cliquer sur « Copier pour WhatsApp » → envoyer les détails dans le chat de groupe
5. Facultatif : cliquer sur « Alarme Divera » → alarmer directement les personnes attribuées par push Divera
6. Dès qu’on annonce l’arrivée sur place → déplacer dans « Intervention »

### Alarmement par Divera

En plus de WhatsApp et de l’imprimante, les personnes attribuées peuvent être alarmées directement via **Divera 24/7** (push). L’alarme contient comme **mot-clé** le genre d’intervention (p. ex. « KP : événement naturel ») et comme texte les détails de l’intervention (annonce, véhicules, effectif, matériel) ; l’adresse est transmise comme champ Divera.

- **Où :** bouton **« Alarme Divera »** dans la fenêtre de détail de l’intervention et dans la fenêtre d’engagement.
- **Destinataires :** l’effectif attribué à l’intervention (présélectionné) ainsi que les **conducteurs** des véhicules attribués (listés, mais non présélectionnés). À confirmer avant l’envoi.
- **Liaison :** seules les personnes **liées** à Divera peuvent être alarmées – les autres sont grisées. La liaison se fait par la synchronisation des personnes Divera (Réglages → Personnel).
- **Activer :** Réglages → Alarmement → activer « Alarmement Divera » (nécessite une clé d’accès Divera). On y trouve aussi une **alarme de test** vers une seule personne.
- N’est **pas** déclenché en mode exercice ni en mode démo ; le pager n’est délibérément pas sollicité (push / pas de double alarmement).

### Message Divera (information, pas une alarme)

Le message de mise en attente de la liste de contrôle – « le PC arrière est
actif, prendre son téléphone » – peut partir directement comme **message
Divera** au lieu de passer par WhatsApp. Un message n’est délibérément **pas une
alarme** : il arrive comme notification dans l’app Divera, ne réveille personne
comme une convocation et ne sollicite aucun pager.

- **Où :** bouton **« Message Divera »** à côté de « Envoyer par WhatsApp » dans
  la liste de contrôle (sur les deux lignes de message). Il n’apparaît que si un
  fournisseur d’alarmement est configuré **et** que l’alarmement est activé.
- **Destinataires :** **rien** n’est présélectionné. Dans la fenêtre de
  confirmation, cocher les **groupes Divera** visés. « Tout le site » existe,
  mais c’est un choix délibéré, signalé par un avertissement – un message destiné
  au piquet ne doit pas atteindre tout le corps par inadvertance.
- **Texte :** vient du modèle (Réglages → Alarmement) et reste modifiable dans la
  fenêtre avant l’envoi.
- N’est **pas** réellement envoyé en mode exercice ni en mode démo.
- **Divera FREE :** un seul message toutes les cinq minutes.

### Arrivée du personnel

Scanner le code QR → marquer la personne comme présente. Celui qui n’a pas de téléphone
ou ne peut pas scanner est annoncé depuis le PC dans l’**appel** – voir ci-dessous.

### Tout saisir depuis le PC (quand les téléphones lâchent)

Chaque lien sans connexion – arrivée, reconnaissance, terrain, alarme – est un **canal
d’entrée, pas l’endroit où les données habitent**. Tout ce qu’un groupe peut taper
dehors, le PC peut le saisir tout autant au tableau. Ce n’est pas du confort, c’est le
cas normal : pas de réseau à la cave, batterie vide, gants, ou un effectif qui à 02h00
n’ouvre aucune application – alors le groupe dicte par radio, et le PC est le seul
appareil de saisie qu’il reste au système.

**Appel (présence).** Barre du bas → *Arrivée* → ligne **Présence** →
« Ouvrir l’appel » (également accessible depuis la liste de contrôle de l’événement).

- Une ligne par personne, par ordre alphabétique et **stable** – la liste ne se
  réordonne pas quand on coche. Un clic sur la ligne fait avancer :
  *absent → présent → parti*.
- « Parti » est une affirmation, pas une absence : celui qui est rentré à 20h40
  n’est pas la même chose que quelqu’un qui n’est jamais venu. Le rapport
  d’événement lit la différence.
- En-tête : `{présents} présents · {partis} partis · {total} effectif`.
- **« Annoncer tous partants »** met, à la fin de l’événement, tous les présents sur
  « parti ». Les affectations subsistent, les autres événements ne sont pas touchés.
- Celui qui est encore affecté à une intervention reçoit une question à l’annonce de
  départ – ensuite il est annoncé partant, l’affectation reste. Le tableau est
  l’endroit qui peut la dissoudre ; une interdiction stricte obligerait à changer de
  vue pour annoncer un départ.
- Celui qui est enregistré comme *indisponible* apparaît grisé, avec le motif.
- **« Ajouter une personne »** dans l’appel crée la personne **et l’annonce directement**.

> **L’entraide et la protection civile ne peuvent pas s’annoncer elles-mêmes.** L’arrivée
> ne montre que l’effectif propre, et la visibilité vient des affectations. La marche à
> suivre prévue est : les saisir dans l’appel (ou dans la barre latérale) via **« Ajouter
> une personne »**, puis les affecter à l’intervention. Ce n’est ni un défaut ni une
> fonction manquante – c’est le chemin de travail.

**Rapport de reconnaissance par radio.** Dans le détail de l’intervention, bloc
*Reconnaissance* : **« Saisir le rapport de reconnaissance »** – même pour une
intervention où personne n’est jamais allé dehors. C’est le même formulaire que sur le
lien de reconnaissance, seul l’expéditeur change. Un rapport déjà remis par le groupe est
mis à jour avec **« Compléter le rapport de reconnaissance »** dans le même enregistrement,
et non comme un second rapport à côté. Il n’y a délibérément pas de photos ici : un
message radio n’en apporte aucune.

**« Reconnaissance sur place » par radio.** Dans le détail de l’intervention, bloc
*Annonces radio* – la même ligne où figurent aussi « Arrivé », « Intervention terminée »
et « Récupération nécessaire ». L’heure est librement modifiable (une annonce notée cinq
minutes plus tard appartient cinq minutes plus tôt) et effaçable (un message radio mal
compris se corrige, il ne se complète pas).

**« Annoncé par téléphone ».** Dans la fenêtre *Nouvelle intervention*, au champ
contact/annonceur – et corrigeable après coup dans le détail, parce que l’ordre réaliste
est « d’abord taper, puis se rendre compte que c’était un appel ». L’intervention reçoit
le même [badge téléphone](#badge-téléphone-guichet) bleu qu’une annonce arrivée par le
lien d’alarme.

**Comment on voit par quel chemin c’est passé.** Les documents imprimés et exportés
(feuille de situation, PDF du rapport d’événement, export des interventions, instantané
thermique du tableau) écrivent **« (terrain) »** à côté d’une saisie faite depuis le
terrain et **« (annonce radio) »** à côté d’une saisie faite au PC. Un rapport remis par
le groupe puis complété par le PC affiche les deux lignes. Dans le cas normal – quelqu’un
s’annonce lui-même – rien n’est écrit, délibérément.

**Limites qu’il faut connaître :**

- Le lien d’arrivée est **anonyme** : quiconque a le code QR peut annoncer n’importe
  quelle personne, et cette saisie ne porte aucun nom. Seule une saisie au tableau est
  attribuée à une personne.
- **« Annoncé par téléphone » est une affirmation, pas une preuve** – cela signifie
  qu’une personne aux commandes l’a dit ainsi. Pour la statistique, ce n’est pas un
  justificatif de provenance.
- Le tableau connaît **trois** états, l’arrivée sur le téléphone **deux** : celui qui y est
  « parti » apparaît simplement comme non annoncé et revient d’un seul geste.
  « Je suis parti », personne ne le tape – c’est pourquoi cela se note au PC.
- Le bloc reconnaissance ne dit plus si la reconnaissance est sur place ; cette
  information figure maintenant à un seul endroit, dans les *annonces radio*.

### Plusieurs interventions à la fois

- Chercher la bonne carte avec `S` ou `/` plutôt que de la chercher des yeux
- Les priorités aident à garder la vue d’ensemble (rouge = urgent)
- Les badges d’ancienneté montrent quelles interventions sont ouvertes depuis longtemps
- Utiliser le panneau latéral pour les détails (sur les écrans larges), la carte est sur `G M`
- Dans la fenêtre de détail ouverte, `←`/`→` passent d’un onglet à l’autre

---

## Déroulement d’une intervention

Une intervention traverse 7 colonnes : **Reçu** → **Reconnaissance** → **Reconnaissance terminée** → **Engagé / en route** → **En intervention** → **Terminé / retour** → **Clôturé**

| Colonne | Description |
|-------|-------------|
| Reçu | Nouvellement annoncée, détails à saisir |
| Reconnaissance | Reconnaissance sur place en cours (facultative) |
| Reconnaissance terminée | Le rapport de reconnaissance est là, la décision reste à prendre |
| Engagé / en route | Ressources attribuées, le groupe est en route |
| En intervention | Phase de travail active |
| Terminé / retour | Travail achevé, le groupe rentre |
| Clôturé | Réglé, personnel et véhicules libérés automatiquement. La colonne peut être repliée. |

Il n’existe pas d’« archive » pour une intervention isolée – c’est l’**événement** entier qui s’archive (`G E`).

**Déplacer :** faire glisser la carte dans une nouvelle colonne, ou utiliser les touches `>` / `<`.

**Ordre à l’intérieur d’une colonne :** les cartes se trient par glisser-déposer à l’intérieur d’une même colonne. L’ordre manuel est conservé et s’affiche à l’identique après un rechargement ou sur d’autres appareils (il ne revient plus à l’ordre initial).

**Sauter des colonnes :** autorisé. Toutes les interventions n’ont pas besoin d’une reconnaissance.

**Annonce du terrain « intervention terminée » :** l’indication sur la carte ou dans le détail déplace l’intervention d’un clic vers **Terminé / retour** – et s’arrête là. Elle ne lance **pas** la clôture (relevé du matériel, questions en retour) : le groupe est justement en train de rentrer, et c’est exactement cette colonne. La clôture vient après, comme d’habitude. Si le groupe a besoin d’être ramené, il annonce un **ramassage** – qui apparaît comme bandeau propre dans le détail de l’intervention, juste à côté de l’annonce du terrain.

---

## Missions (itinéraires à plusieurs étapes)

Lors d’une **situation étendue** (p. ex. dégâts de tempête ou d’inondation avec beaucoup de petites interventions), **un seul groupe** parcourt souvent plusieurs places sinistrées l’une après l’autre. Une **mission** regroupe pour cela plusieurs interventions en un **itinéraire ordonné** destiné précisément à ce groupe – au lieu d’engager chaque intervention séparément, tu planifies toute la tournée comme un tout.

Ouvrir avec la touche `A` ou via la barre **Missions** en bas de l’écran.

### Créer une mission et ajouter des étapes

1. **Nouvelle mission** dans la barre des missions (choisir un nom et une couleur – la couleur identifie l’itinéraire sur le tableau et sur la carte).
2. **Ajouter des étapes (interventions)** – trois chemins :
   - **Sélection d’interventions** (« + étape ») : choisir des interventions existantes dans une liste. Basculer sur **Carte** les montre géographiquement – cliquer sur un marqueur les sélectionne.
   - **Carte** (`/map` → planification d’itinéraire) : cliquer sur un marqueur d’intervention ou sur un endroit libre.
   - **Glisser-déposer** : faire glisser une carte d’intervention directement sur la mission.

Une intervention qui appartient déjà à une autre mission est **déplacée** lors de l’ajout (une intervention appartient au plus à un itinéraire).

### Ressources propres à l’itinéraire

Le modèle de base : **une mission est une unité unique qui parcourt tout l’itinéraire de manière autonome** – nous ne faisons que guider ce groupe d’étape en étape.

Il en découle :

- Une mission **possède ses ressources elle-même** : véhicule, personnel et matériel sont attribués **à la mission** et valent **pour toutes les étapes en commun** – le groupe les parcourt bien l’une après l’autre. Les étapes individuelles ne portent **aucune ressource propre**.
- Une intervention est **entièrement dans la mission ou pas du tout** – il n’y a pas de « à moitié dedans ». Des ressources supplémentaires pour une seule étape (à moitié dans la mission) ne sont **pas** prises en charge. Si une place sinistrée a besoin de son propre groupe avec son propre matériel, elle n’a pas sa place dans cette mission : elle reste une intervention autonome (ou entre dans une deuxième mission).
- Les ressources sont **libérées automatiquement lorsque la dernière étape est clôturée**.

### Planifier et optimiser l’itinéraire

- **Éditeur d’itinéraire** (dans la barre des missions) : grande carte avec les étapes numérotées et la ligne d’itinéraire, à côté de la liste ordonnée des étapes. Réordonner les étapes par glisser-déposer, ajouter de nouvelles étapes par un clic sur la carte.
- **Planification d’itinéraire** sur `/map` : la même planification sur la grande carte plein écran.
- **Optimiser l’ordre** : calcule, par heuristique du plus proche voisin, un ordre court à partir d’un point de départ (**caserne**, **GPS du véhicule** ou **première étape**). La proposition s’affiche en aperçu – **Reprendre** ou **Abandonner**.

### Message radio pour une mission

Une mission est **attribuée une fois, pas à nouveau à chaque étape**. L’application reconnaît elle-même le cas de figure – il n’y a pas de bouton supplémentaire, la fenêtre d’engagement reste le déclencheur, seul le texte diffère :

- **La première étape qui passe sur « Engagé » constitue l’attribution de la mission.** Le message nomme la mission entière : effectif, véhicules et matériel d’abord, puis la liste numérotée de toutes les étapes.
- **Chaque étape suivante est une continuation** et n’est annoncée que brièvement : « Mission ‹ Bois de tempête Oberwil ›, suite à l’étape 3 : Mühlemattstrasse 12. » L’effectif n’est pas relu une seconde fois.
- **Si l’itinéraire reçoit entre-temps de l’effectif, un véhicule ou du matériel**, le message complet est repris – celui qui vient d’arriver n’a jamais entendu la mission.

**Les étapes faites disparaissent de la liste mais conservent leur numéro.** Une fois l’étape 1 traitée, on dit « 2 étapes : 2. …, 3. … ». Ainsi « étape 3 » désigne la même adresse pendant toute la durée de vie de la mission.

**Les particularités** (dangers issus de la reconnaissance, entraide) figurent regroupées à la fin, chacune avec son adresse – et non éparpillées entre les étapes.

**Répéter le message :** le trafic radio se perd. Dans la barre des missions, chaque mission dispose du bouton **Répéter le message** (dans la mission dépliée, à côté de « Éditeur d’itinéraire », ainsi que dans le menu ⋮ et par clic droit). Il affiche à nouveau le dernier message diffusé, mot pour mot – sans devoir rouvrir une fenêtre d’étape et sans le recompter.

### Afficher sur la carte

**Afficher les missions** sur `/map` dessine tous les itinéraires en lignes colorées avec des étapes numérotées. La coloration des marqueurs bascule automatiquement sur **Colorer par : mission**, de sorte que chaque intervention porte la couleur de son itinéraire (les interventions sans mission = « Aucune mission »).

---

## Attribuer des ressources

**Glisser-déposer :** faire glisser une personne ou du matériel depuis la barre latérale sur une carte d’intervention.

**Véhicules :** sélectionner l’intervention, puis les touches `1-5`.

**Par fenêtre :** cliquer sur le bouton [+] à côté d’une catégorie de ressources, puis choisir la ressource.

Seules les ressources disponibles (point vert) peuvent être attribuées.

### Rôles spéciaux (clic droit sur une personne)

| Rôle | Signification |
|-------|-----------|
| **Conducteur** | Conduit un véhicule déterminé (1-5). Permet un service de navette sans changement constant de conducteur. |
| **Reconnaissance** | Officier chargé de la reconnaissance préalable. Vérifie sur place si l’intervention est pertinente avant que toute l’équipe ne parte. |
| **Caserne** | Fourrier à la caserne. Coordonne la remise en état et le nettoyage du matériel. |

Un nouveau clic droit retire l’attribution.

**Conducteur : rentre-t-il ou reste-t-il sur place ?** Pour chaque véhicule attribué, un clic sur le badge du conducteur permet de basculer entre **rentre** et **reste sur place** après la livraison. Le réglage par défaut est « rentre » – dans ces interventions, nos véhicules ne doivent que faire la navette (livrer personnel et matériel puis redevenir disponibles) plutôt que de rester immobilisés sur le lieu d’intervention.

### Questions de sécurité – le filet

Pour qu’aucune étape ne soit oubliée dans les moments agités, le système affiche automatiquement une question dans les situations suivantes. Elles sont pensées comme un **filet** : le déroulement normal fonctionne aussi sans elles – mais si on oublie quelque chose, la question le rattrape. Le bouton recommandé (le plus sûr) est chaque fois mis en évidence.

| Situation | Question |
|-----------|---------|
| **Attribuer un véhicule sans conducteur** | Le choix du conducteur apparaît directement à l’attribution. « Fermer » laisse sciemment le véhicule sans conducteur. |
| **Véhicule déjà en intervention** (double affectation) | Un véhicule n’existe physiquement qu’une fois – lors d’une nouvelle attribution : **Déplacer ici** (le retirer des autres interventions) ou **Attribuer plusieurs fois** (conserver sciemment la double affectation). |
| **Vers la colonne Reconnaissance sans personne de reconnaissance** | Si une intervention est déplacée vers « Reconnaissance » sans qu’une personne de reconnaissance soit attribuée, « Aucune personne de reconnaissance attribuée » apparaît : **Attribuer une personne de reconnaissance** (elle reçoit alors le formulaire) ou « Continuer quand même ». |
| **Engager sans ressources** | S’il manque du **personnel, des véhicules ou des moyens** lors du passage à « Engagé » (les véhicules ne comptent pas en mode « à pied »), « Il manque des ressources » apparaît. Le choix recommandé est **Attribuer** – cela ouvre l’attribution puis mène directement à la fenêtre radio/alarme ; « Engager quand même » part sciemment sous-doté. |
| **Ajouter une intervention clôturée comme étape** | Si une intervention déjà clôturée est rattachée à une mission – par la sélection d’étapes, « Répartir sur une mission » ou glisser-déposer –, le système demande confirmation. C’est **autorisé** (reprise, deuxième visite à la même adresse), mais cela ne doit pas passer inaperçu. |
| **Clôturer avec du matériel attribué** | Si une intervention est clôturée alors que du matériel est encore attribué, le système demande : **Matériel de retour** (libérer) ou « Laissé sur place » (le laisser attribué, p. ex. s’il reste sur le lieu). |

Le personnel et les véhicules sont libérés automatiquement à la clôture ; seul le matériel fait l’objet d’une question, parce qu’il peut sciemment rester sur place.

---

## Raccourcis clavier

Appuie sur `Cmd/Ctrl+K` pour la palette de commandes – elle liste toutes les commandes
avec leur raccourci et est également accessible depuis le menu utilisateur
(« Commandes et raccourcis clavier »). Les raccourcis sont inactifs tant qu’un champ de
saisie a le focus.

### Global
| Raccourci | Action |
|----------|--------|
| `Cmd/Ctrl+K` ou `?` | Ouvrir/fermer la palette de commandes |
| `G K` | Tableau kanban |
| `G M` | Vue carte |
| `G E` | Événements |
| `G S` | Réglages |
| `G H` | Aide |
| `Esc` | Annuler / quitter le champ de saisie / fermer la fenêtre |

### Tableau kanban – actions
| Raccourci | Action |
|----------|--------|
| `N` | Nouvelle intervention |
| `A` | Ouvrir/fermer les missions (itinéraires) |
| `S` / `/` | Mettre le focus sur la recherche |
| `D` | Ouvrir/fermer Impression et export |
| `R` / `F5` | Actualiser |
| `F` | État des véhicules |

### Tableau kanban – intervention (souris sur la carte)
| Raccourci | Action |
|----------|--------|
| `E` / `Enter` | Ouvrir les détails |
| `1-5` | Attribuer/retirer un véhicule |
| `Shift+1-3` | Priorité : basse / moyenne / haute |
| `0` | Basculer « à pied » |
| `>` / `.` | Statut suivant |
| `<` / `,` | Statut précédent |
| `Delete` / `Backspace` | Supprimer (avec confirmation) |

`Shift+1-3`, `0` et `1-5` fonctionnent aussi dans la fenêtre de détail ouverte.

### Tableau kanban – vue
| Raccourci | Action |
|----------|--------|
| `Q` / `[` | Barre latérale du personnel afficher/masquer |
| `W` / `]` | Barre latérale du matériel afficher/masquer |
| `I` / `\` | Panneau latéral afficher/masquer |
| `K` | Ouvrir l’intervention sélectionnée sur la page carte (panneau latéral ouvert requis) |
| `B` | Notifications |
| `P` | Rechercher du personnel |
| `M` | Rechercher du matériel |

### Vue carte (carte de situation)
| Raccourci | Action |
|----------|--------|
| `L` | Étiquettes (légendes des marqueurs) afficher/masquer |
| `I` | Lignes d’attribution afficher/masquer |
| `1-5` | Zoomer sur le véhicule correspondant |
| `E` / `Enter` | Ouvrir les détails de l’intervention sélectionnée |
| `Z` | Réinitialiser le zoom / annuler la sélection |
| `R` / `F5` | Actualiser |
| `S` / `/` | Mettre le focus sur la recherche |
| Double clic | Sur une carte de la liste → ouvrir les détails |

---

## Mode exercice et démo

Les événements peuvent être marqués **exercice** (badge « Exercice »). Les données d’exercice sont tenues séparément et ne se mélangent pas aux interventions réelles.

### Commande d’exercice

Pour les événements d’exercice, la **commande d’exercice** apparaît dans les réglages, pour générer des interventions d’exercice :

| Bouton | Effet |
|-------|---------|
| **Normale** | Une intervention courante au hasard (eau, tempête, arbre) |
| **Critique** | Une intervention critique au hasard (incendie, DAI, sauvetage de personnes) |
| **Alarme téléphonique** | Simule une annonce d’un habitant via le lien d’alarme – l’intervention reçoit le **badge téléphone**, un annonceur inventé (nom + numéro) et une courte note de contexte. Volontairement des situations **non critiques** uniquement (eau, arbre, ascenseur, etc.) – pour un vrai incendie, on appelle la centrale d’alarme officielle, pas le PC |
| **Rafale (5×)** | Cinq interventions au hasard d’un coup |
| **Intervention ciblée** | Un scénario déterminé à une adresse choisie ou sur un repère de la carte |

Chaque génération est confirmée par une courte annonce (toast) indiquant quelle intervention a été créée – on voit ainsi immédiatement qu’il s’est passé quelque chose, et on ne clique pas plusieurs fois par mégarde (p. ex. sur « Rafale ») en créant trop d’interventions.

### Bac à sable de la démo

En mode démo public, chaque connexion éditeur (`demo-editor`) reçoit une **situation d’exercice personnelle** (sa propre « Demo-Lage »), afin que des visiteurs simultanés ne partagent pas le même tableau. La bannière de démo signale un tel bac à sable et affiche le temps restant avant la réinitialisation.

---

## En ligne vs hors ligne

### En ligne (Railway)
- L’arrivée par code QR et la reconnaissance fonctionnent
- Synchronisation automatique de tous les appareils
- Accès mobile depuis partout

### Lien observateur (lecture seule)

Pour les personnes sans compte : barre du bas → « Observateur » génère un lien valable 24 h. Il montre le tableau kanban et la carte sans possibilité d’édition – la même carte d’intervention qu’au poste de commandement. Actualisation automatique toutes les 5 secondes.

**Le lien montre désormais aussi le résultat de la reconnaissance** : pertinent oui/non, dangers, estimation de l’engagement, rapport bref **et les photos de la place sinistrée**. Auparavant il n’y figurait que le fait *qu’*une reconnaissance avait eu lieu – ce qui rendait le lien peu utile pour la commune ou un corps voisin.

> **Qui détient le lien voit cela.** Délibérément **non** inclus : le champ « Autres remarques » (texte libre dans lequel des riverains sont régulièrement nommés), **qui** a saisi le rapport, et les photos d’un brouillon non encore envoyé. Les photos du rapport de place sinistrée restent elles aussi derrière l’authentification. Le lien vaut pour **un** événement : un lien transmis n’ouvre rien d’un autre. À transmettre en connaissance de cause.

### Lien d’alarme (téléphone / guichet)

Pour les personnes qui doivent **saisir** une alarme, sans connexion et sans connaître le reste du système – p. ex. quelqu’un au téléphone ou au guichet.

**Créer :** barre d’outils → « Alarme » (symbole de sirène) génère un lien ou un code QR valable **30 jours** par événement. À générer une fois, puis à afficher au poste téléphonique ou à enregistrer en favori.

**Utiliser :** qui ouvre le lien voit un formulaire épuré, optimisé pour le mobile, et peut saisir autant d’alarmes qu’il veut – aucune connexion nécessaire. Ordre des champs : d’abord le **lieu** (avec recherche d’adresse), puis l’**annonce** (ce qui a été annoncé – l’adresse figure déjà en haut, donc pas de double saisie), la **priorité** sous forme de trois touches de sélection rapide (basse / moyenne / haute), le genre d’intervention, d’autres indications et l’annonceur/appelant.

**Sur le tableau :** les alarmes ainsi saisies atterrissent dans la colonne « Reçu » et portent un **badge « téléphone »** bleu – afin que la conduite de l’intervention voie que l’annonce provient d’une source non vérifiée et puisse la contrôler. L’adresse et le lieu sont transmis directement.

> Le lien ne permet que la **création** d’alarmes (pas de lecture ni de modification) et est protégé par une limite de requêtes stricte. Comme il est valable 30 jours : ne le transmettre qu’à des endroits de confiance.

### Hors ligne (localhost/Docker)
- Tableau kanban complet disponible
- Les codes QR ne fonctionnent que sur le réseau local
- Sauvegarde en cas de panne d’Internet
- Si possible via un point d’accès mobile
- Sinon communication uniquement par radio et tout saisir à la main dans un autre onglet (arrivée, reconnaissance)

### Synchroniser les données

L’instance locale se synchronise automatiquement avec Railway. L’état de la synchronisation est indiqué dans la barre de navigation (point coloré).

**Railway → local :** les données sont téléchargées automatiquement depuis Railway.

**Local → Railway :** lorsque Railway est de nouveau en ligne, une notification apparaît avec le bouton « Synchroniser maintenant ».

Réglages de synchronisation sous Réglages → onglet Sync.

### État des liaisons (menu utilisateur)

Dans le menu utilisateur (en haut à droite), la section « Liaison » montre l’état de tous les systèmes :

| Système | Signification |
|--------|-----------|
| **Backend** | Liaison au serveur d’API |
| **WebSocket** | Mises à jour en temps réel (repli sur l’interrogation si hors ligne) |
| **Sync** | Synchronisation Railway ↔ local |
| **Imprimante** | État de l’imprimante thermique : désactivée / prête / erreur |

Un clic sur une entrée ouvre les réglages correspondants.

---

## Installation locale

Pour un engagement sans connexion Internet, KP Rück peut tourner localement sur un ordinateur du poste de commandement.

### Prérequis
- Docker Desktop installé
- Dépôt Git cloné

### Démarrer
```bash
just dev        # Démarre tous les services
```

Les données sont synchronisées automatiquement depuis Railway (voir les réglages de synchronisation).

### Arrêter
```bash
just dev-stop    # Arrêter les services
just dev-clean   # Tout réinitialiser (supprime les données) – demande confirmation
```

L’instance locale tourne sur `http://localhost:3000`.

---

## Imprimante thermique

Imprime les fiches d’intervention et les instantanés du tableau sur une imprimante thermique ESC/POS **80 mm** (p. ex. Epson TM-T20III ou compatible). La mise en forme est fixée sur 80 mm – 48 caractères par ligne en police A ; sur un appareil 58 mm, chaque ligne se renvoie à la ligne.

### Montage

Un **agent d’impression** tourne sur un Raspberry Pi dans le réseau du poste de commandement. Il interroge régulièrement le backend pour de nouveaux travaux d’impression et les envoie à l’imprimante par le réseau local. Aucune ouverture de port nécessaire – uniquement des connexions sortantes.

### Mise en place
1. Raccorder l’imprimante au réseau local par Ethernet
2. Mettre en place le Raspberry Pi (voir `docs/PRINT_AGENT.md` dans le dépôt)
3. Réglages → Imprimante → configurer l’adresse IP et le port, activer l’imprimante

> **Remarque (exploitation) :** les points d’accès de l’agent d’impression peuvent être protégés par un jeton partagé (`PRINT_AGENT_TOKEN`). S’il est défini sur le serveur, la même valeur doit être enregistrée dans l’unité systemd du Pi – sinon l’agent reçoit des erreurs 401. Sans jeton, les points d’accès sont ouverts (prévus uniquement pour des installations purement LAN) ; en production, un avertissement est alors journalisé.

### Travaux d’impression

| Travail | Déclencheur | Contenu |
|---------|----------|--------|
| **Fiche d’intervention** | Automatiquement au statut « Engagé »/« Intervention », ou clic droit → « Imprimer la fiche d’intervention » | Adresse, genre, priorité, description, véhicules, personnel, matériel |
| **Instantané du tableau** | Barre du bas → « Imprimer » (ou touche `D`) → colonne **Impression thermique** → choisir les options → « Imprimer » | Vue d’ensemble de l’événement, interventions avec détails, état des véhicules, liste du personnel |
| **Fiche code QR** | Dans les panneaux Arrivée / Reconnaissance / Observateur / Alarme → symbole d’imprimante | Titre, brève description et code QR scannable du lien – à distribuer sur papier |

### Fiche code QR

Chaque panneau de lien (arrivée du personnel, tableau de reconnaissance, lien observateur, lien d’alarme) comporte, à côté de « Copier » et « Ouvrir », un symbole d’imprimante (visible uniquement si l’imprimante est activée). Il imprime une fiche compacte avec le code QR et une brève description – pratique pour mettre le bon lien dans la main de quelqu’un sans devoir partager un appareil.

### Options de l’instantané du tableau

La colonne **Impression thermique** du panneau d’impression comporte pour cela trois commutateurs :

- **Interventions terminées** – inclure aussi les interventions archivées (par défaut : désactivé)
- **État des véhicules** – afficher la disponibilité de tous les véhicules (par défaut : activé)
- **Vue d’ensemble du personnel** – liste de toutes les personnes présentes avec leur statut d’affectation (par défaut : activé)

### Comportement d’interrogation

Pour éviter les requêtes inutiles, l’agent utilise une **interrogation adaptative** :

- **Au repos** : interrogation toutes les **60 secondes**
- **Après un travail d’impression** : passage à **5 secondes** pendant **15 minutes**, puis retour à 60 s

Ainsi, en exploitation normale, seules environ 60 requêtes par heure sont envoyées, tandis que lors d’interventions actives les travaux suivants sont traités presque immédiatement.
