const DEFAULT_ICON = "fa-graduation-cap";

// Mapeo por palabras clave del nombre del curso, con fallback; no usa IA.
const ICON_RULES = [
  [/miner[ií]a de datos|base de datos|basedatos|sql|ciencia de datos|anal[ií]tica|big data|machine learning|inteligencia artificial|\bia\b|datos/, "fa-database"],
  [/matem|algebra|calculo|geometr|estadistic|trigonometr|aritmetic/, "fa-calculator"],
  [/redes|telecom|network|ciber|seguridad informatica/, "fa-network-wired"],
  [/program|software|desarrollo|codigo|comput|informatic|algoritm|\bweb\b|\bapp\b/, "fa-code"],
  [/fisic|quimic|biolog|laborator|ciencias naturales/, "fa-flask"],
  [/lengua|espanol|literatura|redaccion|ingles|idioma|lectura|escritura/, "fa-book-open"],
  [/historia|sociales|geograf|filosof|politic/, "fa-landmark"],
  [/econom|administracion|contab|finanz|negoci|empresa|gestion/, "fa-chart-line"],
  [/salud|medicin|enfermer|anatom|nutricion|psicolog/, "fa-heart-pulse"],
  [/derecho|juridic|legal/, "fa-scale-balanced"],
  [/arte|diseno|musica|dibujo|fotograf|teatro/, "fa-palette"],
  [/ingenier|arquitect|civil|mecanic|electric|electron|industrial/, "fa-compass-drafting"],
];

export function courseIcon(name) {
  const text = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const rule = ICON_RULES.find(([pattern]) => pattern.test(text));
  return rule ? rule[1] : DEFAULT_ICON;
}
