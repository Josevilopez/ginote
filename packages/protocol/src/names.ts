/**
 * S4-08: filtro básico de nombres ofensivos (compartido web/servidor).
 *
 * Se normaliza (minúsculas, sin acentos salvo la ñ, 0→o, 1→i, 3→e, 4→a,
 * 5→s, 7→t, @→a, $→s) y se comprueba:
 *  - palabras largas: si aparecen en cualquier parte del nombre (también
 *    con letras repetidas, "gilipoooollas");
 *  - palabras cortas: solo como palabra entera, para no bloquear "Pola",
 *    "Pollo", "Apolonia", "Culebra", "Penélope"…
 * No es perfecto ni pretende serlo: corta lo obvio.
 */
const ANYWHERE = [
  'gilipollas', 'gilipolla', 'hijoputa', 'hijodeputa', 'hijaputa', 'cabron', 'cabrona', 'maricon', 'bollera',
  'subnormal', 'retrasado', 'mongolo', 'cojones', 'follar', 'mamada', 'putero', 'putita', 'zorrita',
  'chupapollas', 'comepollas', 'soplapollas', 'mierda', 'negrata', 'sudaca', 'panchito', 'hitler',
  'violador', 'pederasta', 'pedofilo', 'fuck', 'bitch', 'nigger', 'nigga', 'faggot', 'asshole', 'dickhead',
];
const WHOLE = [
  'puta', 'puto', 'putas', 'putos', 'zorra', 'polla', 'pollon', 'coño', 'cono', 'pene', 'verga', 'nazi', 'nazis',
  'hdp', 'joputa', 'marica', 'chocho', 'culero', 'mamon', 'ojete', 'porno', 'sexo', 'capullo', 'shit', 'cunt',
  'dick', 'cock', 'pussy', 'porn',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ñ/g, '\u0001')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ñ')
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c);
}

/** "puuuta" → "puta". */
const collapse = (s: string) => s.replace(/(.)\1+/g, '$1');

const ANYWHERE_N = ANYWHERE.map((w) => collapse(norm(w)));
const WHOLE_N = new Set(WHOLE.map(norm));
const WHOLE_C = new Set(WHOLE.map((w) => collapse(norm(w))));

function badWord(w: string): boolean {
  if (WHOLE_N.has(w)) return true;
  // Solo si el nombre tenía letras repetidas de más ("puuuta", "pollla").
  const c = collapse(w);
  return c !== w && WHOLE_C.has(c) && !WHOLE_C.has(w);
}

export function isOffensiveName(name: string): boolean {
  const n = norm(name);
  const squashed = n.replace(/[^a-zñ]/g, ''); // "p.u.t.a" → "puta"
  if (ANYWHERE_N.some((w) => collapse(squashed).includes(w))) return true;
  const words = n.split(/[^a-zñ]+/).filter(Boolean);
  if (words.some(badWord)) return true;
  // Todo el nombre es una palabrota corta escrita con separadores ("p u t a").
  return words.length > 1 && badWord(squashed);
}
