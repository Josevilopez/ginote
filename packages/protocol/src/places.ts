/**
 * S4-03: provincias de España (código INE de 2 cifras). Compartido por
 * servidor y web. Los municipios están en `apps/server/data/municipios.json`
 * (lista oficial del INE, 8.132) y la web los pide por provincia.
 */
export const PROVINCES: readonly { code: string; name: string }[] = [
  { code: '15', name: 'A Coruña' },
  { code: '01', name: 'Álava/Araba' },
  { code: '02', name: 'Albacete' },
  { code: '03', name: 'Alicante/Alacant' },
  { code: '04', name: 'Almería' },
  { code: '33', name: 'Asturias' },
  { code: '05', name: 'Ávila' },
  { code: '06', name: 'Badajoz' },
  { code: '08', name: 'Barcelona' },
  { code: '48', name: 'Bizkaia' },
  { code: '09', name: 'Burgos' },
  { code: '10', name: 'Cáceres' },
  { code: '11', name: 'Cádiz' },
  { code: '39', name: 'Cantabria' },
  { code: '12', name: 'Castellón/Castelló' },
  { code: '51', name: 'Ceuta' },
  { code: '13', name: 'Ciudad Real' },
  { code: '14', name: 'Córdoba' },
  { code: '16', name: 'Cuenca' },
  { code: '20', name: 'Gipuzkoa' },
  { code: '17', name: 'Girona' },
  { code: '18', name: 'Granada' },
  { code: '19', name: 'Guadalajara' },
  { code: '21', name: 'Huelva' },
  { code: '22', name: 'Huesca' },
  { code: '07', name: 'Illes Balears' },
  { code: '23', name: 'Jaén' },
  { code: '26', name: 'La Rioja' },
  { code: '35', name: 'Las Palmas' },
  { code: '24', name: 'León' },
  { code: '25', name: 'Lleida' },
  { code: '27', name: 'Lugo' },
  { code: '28', name: 'Madrid' },
  { code: '29', name: 'Málaga' },
  { code: '52', name: 'Melilla' },
  { code: '30', name: 'Murcia' },
  { code: '31', name: 'Navarra' },
  { code: '32', name: 'Ourense' },
  { code: '34', name: 'Palencia' },
  { code: '36', name: 'Pontevedra' },
  { code: '37', name: 'Salamanca' },
  { code: '38', name: 'Santa Cruz de Tenerife' },
  { code: '40', name: 'Segovia' },
  { code: '41', name: 'Sevilla' },
  { code: '42', name: 'Soria' },
  { code: '43', name: 'Tarragona' },
  { code: '44', name: 'Teruel' },
  { code: '45', name: 'Toledo' },
  { code: '46', name: 'Valencia/València' },
  { code: '47', name: 'Valladolid' },
  { code: '49', name: 'Zamora' },
  { code: '50', name: 'Zaragoza' },
];

export function provinceName(code: string): string | null {
  return PROVINCES.find((p) => p.code === code)?.name ?? null;
}

/** Días entre cambios de pueblo/provincia (que nadie salte de ranking en ranking). */
export const PLACE_CHANGE_DAYS = 30;

/** Para buscar sin acentos ni mayúsculas: "Alcañiz" ≈ "alcaniz". */
export function searchKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
