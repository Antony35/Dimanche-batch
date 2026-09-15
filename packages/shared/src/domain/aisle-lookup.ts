import type { Aisle } from '../schemas/common';
import { AISLES } from '../schemas/common';
import { normalizeName, parseList, singularizeWords } from './text';

/**
 * Rayon d'un article, deviné depuis son nom.
 *
 * La liste de courses cesse d'être celle du batch pour devenir celle du foyer :
 * on y ajoute du sac poubelle et du produit vaisselle à la main. Il faut donc
 * classer un nom libre dans un rayon, et il y avait trois façons de le faire.
 * Demander à Gemini coûte un appel réseau et un décompte de quota pour ranger
 * une éponge, et ne marche pas dans un magasin sans réseau. Interroger une API
 * de produits classe des codes-barres, pas le mot « courgette ». Une table
 * locale répond en zéro milliseconde, hors ligne, et se teste comme n'importe
 * quelle fonction pure.
 *
 * Elle sera incomplète : c'est prévu. Ce que le foyer corrige est conservé dans
 * son propre lexique et repasse devant cette table — voir `guessAisle`.
 *
 * Les entrées sont écrites en français lisible, accents compris, et normalisées
 * au chargement : la table doit rester relisible par un humain qui vient y
 * ajouter un oubli.
 */

/**
 * Un nom par entrée, séparés par des virgules ou des retours à la ligne.
 *
 * Chaînes et non tableaux, pour que sept cents entrées tiennent en un fichier
 * qu'on parcourt — et que le formateur ne les éclate pas à raison d'une ligne
 * par article.
 */
const CATALOG: Record<Aisle, string> = {
  'fruits-legumes': `
    ail, ail nouveau, ananas, aneth, artichaut, asperge, aubergine, avocat,
    banane, basilic, batavia, betterave, betterave cuite, blette, brocoli,
    carotte, carotte nouvelle, cassis, céleri, céleri branche, céleri-rave,
    cerfeuil, cerise, champignon, champignon de Paris, cèpe, chicorée,
    chou, chou blanc, chou chinois, chou de Bruxelles, chou kale, chou rave,
    chou rouge, chou vert, chou-fleur, ciboule, ciboulette, citron,
    citron vert, citronnelle, clémentine, coing, concombre, coriandre,
    courge, courge butternut, courge spaghetti, courgette, cresson, crosne,
    échalote, endive, épinard, estragon, fenouil, fève, figue, fraise,
    framboise, frisée, fruit de la passion, germe de soja, gingembre,
    grenade, groseille, haricot beurre, haricot vert, kaki, kiwi, laitue,
    mâche, maïs, mandarine, mangue, melon, menthe, mesclun, mirabelle, mûre,
    myrtille, navet, navet nouveau, nectarine, oignon, oignon nouveau,
    oignon rouge, orange, pamplemousse, panais, papaye, pastèque,
    patate douce, pêche, persil, petit pois, poire, poireau, poivron,
    pomelo, pomme, pomme de terre, pomme de terre nouvelle, potimarron,
    potiron, pousse d'épinard, prune, quetsche, radis, radis noir, raisin,
    rhubarbe, romarin, roquette, rutabaga, salade, salsifis, sarriette,
    sauge, scarole, shiitake, thym, tomate, tomate cerise, topinambour
  `,

  boucherie: `
    agneau, aiguillette de poulet, andouille, andouillette, bacon, bavette,
    blanc de poulet, bœuf, bœuf bourguignon, bœuf haché, boudin blanc,
    boudin noir, bresaola, brochette, canard, cervelas, chapon, chipolata,
    chorizo, confit de canard, coppa, côte de bœuf, côte de porc, côtelette,
    cuisse de canard, cuisse de poulet, dinde, échine de porc, entrecôte,
    épaule d'agneau, escalope, escalope de dinde, escalope de veau,
    faux-filet, filet de bœuf, filet de poulet, filet mignon, foie de veau,
    galantine, gigot, gigot d'agneau, jambon, jambon blanc, jambon cru,
    jambon de Bayonne, jarret, jarret de veau, joue de bœuf, knack,
    langue de bœuf, lapin, lard, lardon, magret de canard, merguez,
    mortadelle, mouton, onglet, os à moelle, paleron, pancetta, pâté,
    paupiette, pintade, plat de côtes, poitrine fumée, porc, poulet,
    poulet entier, quasi de veau, rillettes, rognon, rosbif, rôti de porc,
    rumsteck, salami, saucisse, saucisse de Morteau, saucisse de Toulouse,
    saucisson, sauté de porc, speck, steak, steak haché, tendron, terrine,
    tournedos, travers de porc, tripes, veau, viande hachée, volaille
  `,

  poissonnerie: `
    anchois, anguille, bar, barbue, bigorneau, brochet, bulot, cabillaud,
    calamar, carrelet, colin, coque, coquille Saint-Jacques, couteau, crabe,
    crevette, crevette rose, daurade, dorade, dos de cabillaud, églefin,
    encornet, espadon, filet de cabillaud, flétan, gambas, hareng,
    hareng fumé, homard, huître, julienne, langoustine, lieu, lieu noir,
    limande, lotte, loup de mer, maquereau, merlan, merlu, morue, moule,
    mulet, œufs de lump, oursin, palourde, pavé de saumon, poulpe,
    queue de lotte, raie, rascasse, rouget, saint-pierre, sandre, sardine,
    saumon, saumon fumé, sébaste, seiche, sole, surimi, tacaud, tarama,
    thon, tourteau, truite, truite fumée, turbot
  `,

  cremerie: `
    babeurre, beaufort, beurre, beurre demi-sel, beurre doux, bleu, boursin,
    brebis, brie, bûche de chèvre, burrata, camembert, cancoillotte,
    chantilly, cheddar, chèvre, comté, crème, crème épaisse, crème fraîche,
    crème liquide, crottin, edam, emmental, faisselle, feta, fourme d'Ambert,
    fromage, fromage blanc, fromage de chèvre, fromage râpé, gorgonzola,
    gouda, gruyère, halloumi, kéfir, lait, lait demi-écrémé, lait écrémé,
    lait entier, lait ribot, margarine, maroilles, mascarpone, mimolette,
    morbier, mozzarella, munster, neufchâtel, œuf, ossau-iraty, parmesan,
    pâte à pizza, pâte brisée, pâte feuilletée, pâte sablée, pecorino,
    petit-suisse, pont-l'évêque, raclette, reblochon, ricotta, rocamadour,
    roquefort, saint-nectaire, sainte-maure, skyr, tomme, tomme de Savoie,
    vache qui rit, yaourt, yaourt grec, yaourt nature
  `,

  boulangerie: `
    bagel, baguette, biscotte, boule, brioche, buns, chausson aux pommes,
    ciabatta, croissant, éclair, ficelle, focaccia, fougasse, muffin anglais,
    naan, pain, pain au chocolat, pain aux céréales, pain aux noix,
    pain azyme, pain complet, pain d'épices, pain de campagne, pain de mie,
    pain de seigle, pain pita, pain suédois, pain à burger, pain à hot-dog,
    tresse, viennoiserie, wrap
  `,

  epicerie: `
    abricot sec, agar-agar, amande, amande en poudre, ananas en boîte,
    anis, arachide, artichaut en bocal, barre de céréales,
    beurre de cacahuète, bicarbonate, biscuit, biscuit apéritif, bonbon,
    boulgour, bouillon, bouillon cube, cacahuète, cacao, cannelle, câpre,
    cardamome, cassonade, céréales, champignon en boîte, chapelure,
    chocolat, chocolat en poudre, chocolat noir, chutney, clou de girofle,
    coco râpé, compote, concentré de tomate, confiture, cornichon,
    corn flakes, couscous, crème de marron, croûton, cumin, curcuma, curry,
    datte, épice, farine, farine de blé, farine de maïs, fécule,
    feuille de brick, feuille de laurier, figue sèche, flageolet,
    flocon d'avoine, fleur d'oranger, fond de veau, fruit sec, fusilli,
    galette de riz, gâteau, gelée, germe de blé, graine de chia,
    graine de courge, graine de lin, graine de sésame, graine de tournesol,
    gressin, haricot blanc, haricot rouge, harissa, herbes de Provence,
    huile, huile d'olive, huile de colza, huile de sésame,
    huile de tournesol, ketchup, lait concentré, lait de coco, lasagne,
    lentille, lentille corail, lentille verte, levure, levure chimique,
    levure de boulanger, macaroni, maïs en boîte, maïzena,
    maquereau en boîte, marmelade, mayonnaise, miel, miso, moutarde,
    muesli, noix, noix de cajou, noix de coco, noix de muscade, noisette,
    nouille, olive, orzo, pain de seigle suédois, paprika, pâte à tartiner,
    pâte de curry, pâtes, penne, pesto, piment, pistache, pois cassé,
    pois chiche, poivre, polenta, pop-corn, porridge, pruneau,
    purée de tomate, quinoa, raisin sec, ras el hanout, ravioli, riz,
    riz basmati, riz complet, riz rond, safran, sardine en boîte, sarrasin,
    sauce, sauce soja, sauce tomate, sel, semoule, sésame, sirop,
    sirop d'agave, sirop d'érable, son d'avoine, soupe, spaghetti,
    spéculoos, sucre, sucre glace, sucre vanillé, tabasco, tahini, tapioca,
    thé, thon en boîte, tofu, tomate concassée, tomate pelée, tortilla,
    vanille, vermicelle, vinaigre, vinaigre balsamique, vinaigre de cidre,
    wasabi, chips
  `,

  surgeles: `
    bâtonnet de poisson, brocoli surgelé, chou-fleur surgelé, crème glacée,
    edamame, épinard surgelé, feuilleté surgelé, framboise surgelée, frite,
    fruit rouge surgelé, galette de légumes, glace, glaçon,
    haricot vert surgelé, julienne de légumes, lasagne surgelée,
    légume surgelé, macédoine, mélange forestier, myrtille surgelée, nugget,
    petit pois surgelé, pizza surgelée, poêlée de légumes, poisson pané,
    pomme noisette, purée surgelée, quiche surgelée, ratatouille surgelée,
    riz cantonais, sorbet
  `,

  boissons: `
    apéritif, badoit, bière, boisson végétale, café, café glacé, champagne,
    cidre, coca, cola, eau, eau gazeuse, eau pétillante, eau plate, evian,
    gin, ice tea, jus, jus d'orange, jus de pomme, jus de raisin,
    jus multifruits, kéfir de fruits, kombucha, lait d'amande, lait d'avoine,
    lait de riz, lait de soja, limonade, martini, nectar, pastis, perrier,
    porto, rhum, San Pellegrino, schweppes, sirop de menthe, smoothie, soda,
    thé glacé, tonic, vin, vin blanc, vin rosé, vin rouge, vittel, vodka,
    whisky
  `,

  entretien: `
    adoucissant, allumette, ampoule, anticalcaire, antimite, assouplissant,
    balai, bougie, briquet, brosse WC, chiffon, cire, cristaux de soude,
    déboucheur, désinfectant, désodorisant, désodorisant WC, détartrant,
    eau de javel, éponge, éponge grattante, essuie-tout, film alimentaire,
    gant de ménage, gel WC, insecticide, javel, lavette, lave-vitre,
    lessive, lingette, liquide de rinçage, liquide vaisselle, microfibre,
    nettoyant, nettoyant four, nettoyant multi-usage, papier absorbant,
    papier aluminium, papier cuisson, papier sulfurisé, pelle, pile,
    produit sol, produit vaisselle, raclette vitre, sac congélation,
    sac poubelle, savon noir, seau, sel régénérant, serpillière, sopalin,
    tablette lave-vaisselle, torchon, vinaigre blanc
  `,

  hygiene: `
    alcool à 90, anti-transpirant, après-rasage, après-shampoing,
    bain de bouche, brosse à cheveux, brosse à dents, coton, coton-tige,
    coupe menstruelle, coupe-ongles, couche, crème hydratante, crème solaire,
    crème visage, démaquillant, dentifrice, déodorant, disque démaquillant,
    dissolvant, doliprane, fil dentaire, gel à raser, gel coiffant,
    gel douche, gel hydroalcoolique, laque, lait corporel, lime à ongles,
    liniment, lingette bébé, mouchoir, mousse à raser, pansement,
    papier toilette, paracétamol, peigne, pince à épiler, préservatif,
    protection solaire, protège-slip, rasoir, savon, sérum physiologique,
    serviette hygiénique, shampoing, shampooing, talc, tampon, thermomètre,
    vernis, vitamine
  `,

  autre: '',
};

/**
 * Nom ramené à sa forme de recherche.
 *
 * Au-delà de `normalizeName`, les traits d'union et les apostrophes — droites
 * comme typographiques — deviennent des espaces : « chou-fleur » doit répondre à
 * « chou fleur », et « huile d'olive » à « huile d’olive ». Les deux côtés de la
 * comparaison passent par ici, donc la forme obtenue n'a pas à être jolie.
 */
function lookupKey(value: string): string {
  return normalizeName(value)
    .replace(/[-'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface AisleIndex {
  byName: ReadonlyMap<string, Aisle>;
  /** Articles réellement écrits dans la table, alias singuliers exclus. */
  writtenCount: number;
}

function buildIndex(): AisleIndex {
  const byName = new Map<string, Aisle>();
  let writtenCount = 0;

  for (const aisle of AISLES) {
    for (const entry of parseList(CATALOG[aisle])) {
      const key = lookupKey(entry);
      if (!key) continue;

      // Première occurrence gagnante : si un nom se glisse dans deux rayons,
      // c'est une faute de la table, et l'écraser en silence la cacherait.
      if (!byName.has(key)) {
        byName.set(key, aisle);
        writtenCount += 1;
      }

      // La forme singulière est indexée en plus de la forme écrite, parce que
      // dépluraliser la recherche seule ne suffit pas : « petits pois » devient
      // « petit poi », qui ne ressemble à aucune entrée. En dépluralisant les
      // deux côtés, les deux tombent sur la même clé.
      const singular = singularizeWords(key);
      if (!byName.has(singular)) byName.set(singular, aisle);
    }
  }

  return { byName, writtenCount };
}

const INDEX = buildIndex();

/**
 * Rayon connu pour ce nom, ou `null`.
 *
 * Les groupes de mots sont essayés **du plus long au plus court**, et c'est ce
 * qui fait toute la justesse de la table : « sauce tomate » doit tomber en
 * épicerie et non en fruits et légumes, « épinard surgelé » aux surgelés et non
 * au frais. Un nom sans aucun groupe connu ne rend rien — on ne devine pas.
 */
export function lookupAisle(name: string, overrides?: ReadonlyMap<string, Aisle>): Aisle | null {
  const tokens = lookupKey(name).split(' ').filter(Boolean);

  for (let size = tokens.length; size > 0; size -= 1) {
    for (let start = 0; start + size <= tokens.length; start += 1) {
      const gram = tokens.slice(start, start + size).join(' ');
      const singular = singularizeWords(gram);

      // Le lexique du foyer passe devant la table livrée, à longueur égale : une
      // correction de l'utilisateur n'a pas à être discutée.
      const hit =
        overrides?.get(gram) ??
        overrides?.get(singular) ??
        INDEX.byName.get(gram) ??
        INDEX.byName.get(singular);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Rayon d'un article ajouté à la main, `autre` à défaut.
 *
 * `autre` n'est pas un échec silencieux : l'écran d'ajout ouvre alors son
 * sélecteur de rayon, et ce que l'utilisateur choisit rejoint le lexique du
 * foyer, où les deux téléphones le retrouvent.
 */
export function guessAisle(name: string, overrides?: ReadonlyMap<string, Aisle>): Aisle {
  return lookupAisle(name, overrides) ?? 'autre';
}

/** Clé sous laquelle une correction du foyer est enregistrée et relue. */
export function aisleOverrideKey(name: string): string {
  return lookupKey(name);
}

/**
 * Nombre d'articles livrés — lu par le test qui garde la taille de la table.
 *
 * Compte les noms écrits, pas les clés de l'index : celui-ci porte en plus une
 * forme singulière par entrée, et les compter doublerait le chiffre sans qu'un
 * seul article de plus soit reconnu.
 */
export function countKnownIngredients(): number {
  return INDEX.writtenCount;
}
