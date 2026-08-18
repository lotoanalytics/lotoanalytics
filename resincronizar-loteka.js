// resincronizar-loteka.js
//
// Herramienta de reparación MASIVA: en vez de corregir fila por fila a mano
// comparando capturas, este script abre cada página de Loteka con Puppeteer
// (la MISMA fuente real que usa el robot — loteriasdominicanas.com), lee las
// últimas ~10 tarjetas de cada juego (fecha + números tal como las publica la
// fuente) y las compara una por una contra lo que hay guardado en Supabase.
// Donde encuentra una diferencia, corrige (UPDATE); donde falta un día,
// lo agrega (INSERT). Al final imprime un resumen de todo lo que tocó.
//
// Corre en GitHub Actions (reutiliza el mismo Puppeteer/Chromium ya cacheado
// del workflow del robot) — no hace falta instalar nada nuevo en tu compu.
//
// USO (disparado por el workflow "Resincronizar Loteka" vía workflow_dispatch):
//   node resincronizar-loteka.js            -> modo lectura, no corrige nada
//   node resincronizar-loteka.js --aplicar  -> corrige lo que encuentre distinto

require('dotenv').config();
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  fuenteBaseUrl: 'https://loteriasdominicanas.com',
};
if (!CONFIG.supabaseUrl || !CONFIG.supabaseServiceKey) {
  console.error('[resync] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseServiceKey);
const APLICAR = process.argv.includes('--aplicar');

// Juegos a resincronizar — TODOS los que tiene el robot, no solo Loteka.
// Revisar uno que ya está bien no hace daño (sale como "ya estaba bien" en
// el resumen) — así no hay que ir adivinando cuáles son los afectados.
const JUEGOS = [
  { loteria: 'Lotería Nacional', juego: 'Gana Más', url: CONFIG.fuenteBaseUrl + '/loteria-nacional/gana-mas/' },
  { loteria: 'Lotería Nacional', juego: 'Juega + Pega +', url: CONFIG.fuenteBaseUrl + '/loteria-nacional/juega-mas-pega-mas/' },
  { loteria: 'Lotería Nacional', juego: 'Quiniela Nacional', url: CONFIG.fuenteBaseUrl + '/loteria-nacional/quiniela/' },
  { loteria: 'Leidsa', juego: 'Súper Kino TV', url: CONFIG.fuenteBaseUrl + '/leidsa/super-kino-tv/' },
  { loteria: 'Loteka', juego: 'Quiniela Loteka', url: CONFIG.fuenteBaseUrl + '/loteka/quiniela-mega-decenas/' },
  { loteria: 'Lotería Real', juego: 'Quiniela', url: CONFIG.fuenteBaseUrl + '/loto-real/quiniela/' },
  { loteria: 'Lotería Real', juego: 'Tu Fecha Real', url: CONFIG.fuenteBaseUrl + '/loto-real/quinielita/' },
  { loteria: 'Lotería Real', juego: 'Nueva Yol Real', url: CONFIG.fuenteBaseUrl + '/loto-real/nueva-yol-real/' },
  { loteria: 'Lotería Real', juego: 'Loto Pool', url: CONFIG.fuenteBaseUrl + '/loto-real/loto-pool/' },
  { loteria: 'Lotería Real', juego: 'Loto Pool Noche', url: CONFIG.fuenteBaseUrl + '/loto-real/loto-pool-noche' },
  { loteria: 'Lotería Real', juego: 'Pega 4 Real', url: CONFIG.fuenteBaseUrl + '/loto-real/pega-4' },
  { loteria: 'Lotería Real', juego: 'Repartidera Real', url: CONFIG.fuenteBaseUrl + '/loto-real/repartidera-real' },
  { loteria: 'Lotería Real', juego: 'Chance Real', url: CONFIG.fuenteBaseUrl + '/loto-real/chance-real' },
  { loteria: 'Lotería Real', juego: 'Súper Palé', url: CONFIG.fuenteBaseUrl + '/loto-real/super-pale/' },
  { loteria: 'Lotería Real', juego: 'Loto Real', url: CONFIG.fuenteBaseUrl + '/loto-real/loto/' },
  { loteria: 'La Suerte Dominicana', juego: 'La Suerte 12:30', url: CONFIG.fuenteBaseUrl + '/la-suerte-dominicana/quiniela/' },
  { loteria: 'La Suerte Dominicana', juego: 'La Suerte 18:00', url: CONFIG.fuenteBaseUrl + '/la-suerte-dominicana/quiniela-tarde/' },
  { loteria: 'LoteDom', juego: 'Quiniela LoteDom', url: CONFIG.fuenteBaseUrl + '/lotedom/quiniela/' },
  { loteria: 'LoteDom', juego: 'El Quemaito Mayor', url: CONFIG.fuenteBaseUrl + '/lotedom/el-quemaito-mayor/' },
  { loteria: 'LoteDom', juego: 'Agarra 4', url: CONFIG.fuenteBaseUrl + '/lotedom/agarra-4' },
  { loteria: 'LoteDom', juego: 'Súper Palé', url: CONFIG.fuenteBaseUrl + '/lotedom/super-pale' },
  { loteria: 'King Lottery', juego: 'Quiniela Día', url: CONFIG.fuenteBaseUrl + '/king-lottery/quiniela-dia/' },
  { loteria: 'King Lottery', juego: 'Quiniela Noche', url: CONFIG.fuenteBaseUrl + '/king-lottery/quiniela-noche/' },
  { loteria: 'King Lottery', juego: 'Pick 3 Día', url: CONFIG.fuenteBaseUrl + '/king-lottery/pick-3-dia/' },
  { loteria: 'King Lottery', juego: 'Pick 3 Noche', url: CONFIG.fuenteBaseUrl + '/king-lottery/pick-3-noche/' },
  { loteria: 'King Lottery', juego: 'Pick 4 Día', url: CONFIG.fuenteBaseUrl + '/king-lottery/pick-4-dia/' },
  { loteria: 'King Lottery', juego: 'Pick 4 Noche', url: CONFIG.fuenteBaseUrl + '/king-lottery/pick-4-noche/' },
  { loteria: 'King Lottery', juego: 'Loto Pool Día', url: CONFIG.fuenteBaseUrl + '/king-lottery/loto-pool-medio-dia' },
  { loteria: 'King Lottery', juego: 'Loto Pool Noche', url: CONFIG.fuenteBaseUrl + '/king-lottery/loto-pool-noche/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 8:00 AM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-8-am/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 9:00 AM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-9-am/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 10:00 AM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-manana/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 11:00 AM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-11-am/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 12:00 PM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-12-pm/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 1:00 PM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-medio-dia/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 2:00 PM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-2-pm/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 3:00 PM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-3-pm/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 4:00 PM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-4pm/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 5:00 PM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-5pm/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 6:00 PM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-tarde/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 7:00 PM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-7pm/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 8:00 PM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-8pm/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 9:00 PM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-noche/' },
  { loteria: 'Anguilla Lottery', juego: 'Anguila 10:00 PM', url: CONFIG.fuenteBaseUrl + '/anguila/anguila-10pm/' },
  { loteria: 'La Primera', juego: 'La Primera Día', url: CONFIG.fuenteBaseUrl + '/la-primera/quiniela-medio-dia/' },
  { loteria: 'La Primera', juego: 'La Primera Noche', url: CONFIG.fuenteBaseUrl + '/la-primera/quiniela-noche/' },
  { loteria: 'La Primera', juego: 'Loto 5 (+ Loto5+)', url: CONFIG.fuenteBaseUrl + '/la-primera/loto-5/' },
  { loteria: 'La Primera', juego: 'El Quinielón Día', url: CONFIG.fuenteBaseUrl + '/la-primera/el-quinielon-dia' },
  { loteria: 'La Primera', juego: 'El Quinielón Noche', url: CONFIG.fuenteBaseUrl + '/la-primera/el-quinielon-noche' },
  { loteria: 'Leidsa', juego: 'Loto Leidsa (+ Más/Súper Más)', url: CONFIG.fuenteBaseUrl + '/leidsa/loto-mas/' },
  { loteria: 'Leidsa', juego: 'Loto Pool', url: CONFIG.fuenteBaseUrl + '/leidsa/loto-pool/' },
  { loteria: 'Leidsa', juego: 'Pega 3 Más', url: CONFIG.fuenteBaseUrl + '/leidsa/pega-3-mas/' },
  { loteria: 'Leidsa', juego: 'Quiniela Leidsa / Palé', url: CONFIG.fuenteBaseUrl + '/leidsa/quiniela-pale/' },
  { loteria: 'Leidsa', juego: 'Súper Palé', url: CONFIG.fuenteBaseUrl + '/leidsa/super-pale/' },
  { loteria: 'Loteka', juego: 'Mega Chances', url: CONFIG.fuenteBaseUrl + '/loteka/mega-chances/' },
  { loteria: 'Loteka', juego: 'Mega Chances Repartidera', url: CONFIG.fuenteBaseUrl + '/loteka/mega-chances-repartidera/' },
  { loteria: 'Loteka', juego: 'Toca 3', url: CONFIG.fuenteBaseUrl + '/loteka/toca-3/' },
  { loteria: 'Loteka', juego: 'Mega Lotto', url: CONFIG.fuenteBaseUrl + '/loteka/megalotto/' },
  { loteria: 'Lotería New York', juego: 'Quiniela New York Tarde', url: CONFIG.fuenteBaseUrl + '/americanas/new-york-medio-dia/' },
  { loteria: 'Lotería New York', juego: 'Quiniela New York Noche', url: CONFIG.fuenteBaseUrl + '/americanas/new-york-noche/' },
  { loteria: 'Florida', juego: 'Quiniela Florida Día', url: CONFIG.fuenteBaseUrl + '/americanas/florida-tarde/' },
  { loteria: 'Florida', juego: 'Quiniela Florida Noche', url: CONFIG.fuenteBaseUrl + '/americanas/florida-noche/' },
  { loteria: 'Mega Millions', juego: 'Mega Millions', url: CONFIG.fuenteBaseUrl + '/americanas/mega-millions/' },
  { loteria: 'PowerBall', juego: 'Powerball', url: CONFIG.fuenteBaseUrl + '/americanas/powerball/' },
];

// Juegos donde ya se confirmó que la fuente puede tardar horas en
// actualizarse (mismo criterio que JUEGOS_LENTOS_EN_PUBLICAR del backend) —
// aquí se usan para activar la protección anti-fantasma de arriba.
const JUEGOS_LENTOS_EN_PUBLICAR = new Set([
  'Loteka|Quiniela Loteka',
  'Loteka|Toca 3',
  'Loteka|Mega Chances Repartidera',
]);

function mismosNumeros(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const oa = [...a].map(Number).sort((x, y) => x - y);
  const ob = [...b].map(Number).sort((x, y) => x - y);
  return oa.every((v, i) => v === ob[i]);
}

function parsearNumerosGuardados(valor) {
  if (Array.isArray(valor)) return valor.map(Number);
  if (typeof valor === 'string') {
    try {
      const p = JSON.parse(valor);
      if (Array.isArray(p)) return p.map(Number);
    } catch (e) {
      return valor.replace(/[[\]]/g, '').split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n));
    }
  }
  return [];
}

// La tarjeta trae "DD-MM" sin año. Como los últimos ~10 días nunca cruzan un
// límite de año hacia atrás salvo en la última semana de diciembre, se asume
// el año actual y se corrige hacia atrás si el mes resultante quedara en el
// futuro (caso borde: hoy es enero y la tarjeta dice diciembre).
function ddmmAFechaISO(ddmm) {
  const m = ddmm.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const dia = parseInt(m[1], 10);
  const mes = parseInt(m[2], 10);
  const hoy = new Date();
  let anio = hoy.getFullYear();
  const candidata = new Date(anio, mes - 1, dia);
  if (candidata.getTime() - hoy.getTime() > 3 * 24 * 60 * 60 * 1000) anio -= 1;
  const yyyy = anio;
  const mm = String(mes).padStart(2, '0');
  const dd = String(dia).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function extraerTarjetas(page, url) {
  await page.setRequestInterception(true);
  page.removeAllListeners('request');
  page.on('request', (req) => {
    try {
      const tipo = req.resourceType();
      if (tipo === 'image' || tipo === 'stylesheet' || tipo === 'font' || tipo === 'media') req.abort();
      else req.continue();
    } catch (e) { /* solicitud residual, se ignora */ }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 3000));
  const html = await page.content();

  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const tarjetas = [];
  $('.p-card').each((i, el) => {
    const fechaTxt = $(el).find('.bg-slate-500').first().text().trim();
    const numeros = [];
    $(el).find('.score-shape-circle span').each((j, sp) => {
      const n = parseInt($(sp).text().trim(), 10);
      if (!isNaN(n)) numeros.push(n);
    });
    const fechaISO = ddmmAFechaISO(fechaTxt);
    if (fechaISO && numeros.length > 0) tarjetas.push({ fecha: fechaISO, numeros });
  });
  return tarjetas;
}

async function main() {
  console.log(APLICAR ? '[resync] Modo APLICAR: se van a corregir las diferencias encontradas.\n' : '[resync] Modo LECTURA: solo se listan diferencias, nada se corrige. Usa --aplicar para corregir.\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let totalCorregidas = 0;
  let totalInsertadas = 0;
  let totalIguales = 0;

  for (const cfg of JUEGOS) {
    console.log(`\n=== ${cfg.loteria} — ${cfg.juego} ===`);
    const page = await browser.newPage();
    let tarjetas = [];
    try {
      tarjetas = await extraerTarjetas(page, cfg.url);
    } catch (e) {
      console.error(`[resync] No se pudo leer la fuente de ${cfg.juego}: ${e.message}`);
      await page.close();
      continue;
    }
    await page.close();

    if (tarjetas.length === 0) {
      console.warn(`[resync] No se encontraron tarjetas para ${cfg.juego} — se salta.`);
      continue;
    }

    for (let i = 0; i < tarjetas.length; i++) {
      const t = tarjetas[i];
      const anterior = tarjetas[i + 1]; // la fuente trae más reciente primero; i+1 es un día más viejo

      // NUEVO — protección anti-fantasma para los juegos ya confirmados
      // lentos en publicar (loteriasdominicanas.com puede tardar horas y,
      // mientras tanto, muestra el número de ayer bajo la fecha de hoy). A
      // diferencia del robot normal (que espera hasta 3 horas después del
      // sorteo antes de confiar en la fuente), este script no tiene noción
      // de tiempo — solo trae lo que la fuente diga en el momento exacto en
      // que corre. Por eso: si la tarjeta más reciente es IDÉNTICA a la del
      // día inmediatamente anterior, se trata como sospechosa y se salta en
      // vez de escribirla — mejor dejar el dato viejo un rato más que
      // arriesgarse a copiar un fantasma.
      if (i === 0 && JUEGOS_LENTOS_EN_PUBLICAR.has(cfg.loteria + '|' + cfg.juego) && anterior && mismosNumeros(t.numeros, anterior.numeros)) {
        console.warn(`[sospechoso] ${cfg.juego} — ${t.fecha}: idéntica a ${anterior.fecha} [${t.numeros.join(',')}] — la fuente probablemente todavía no se actualizó. Se salta esta tarjeta (no se toca).`);
        continue;
      }

      const { data: fila, error } = await supabase
        .from('sorteos')
        .select('id, numeros')
        .eq('loteria', cfg.loteria)
        .eq('juego', cfg.juego)
        .eq('fecha', t.fecha)
        .maybeSingle();

      if (error) {
        console.error(`[resync] Error consultando ${cfg.juego} (${t.fecha}): ${error.message}`);
        continue;
      }

      if (!fila) {
        console.log(`[falta] ${cfg.juego} — ${t.fecha}: no existe fila, la fuente trae [${t.numeros.join(',')}]`);
        totalInsertadas++;
        if (APLICAR) {
          const { error: errIns } = await supabase.from('sorteos').insert({
            loteria: cfg.loteria, juego: cfg.juego, fecha: t.fecha,
            numeros: '[' + t.numeros.join(',') + ']',
            hora_publicacion: new Date().toISOString(),
          });
          if (errIns) console.error(`  -> No se pudo insertar: ${errIns.message}`);
          else console.log('  -> Insertado.');
        }
        continue;
      }

      const guardados = parsearNumerosGuardados(fila.numeros);
      if (mismosNumeros(guardados, t.numeros)) {
        totalIguales++;
        continue;
      }

      console.log(`[distinto] ${cfg.juego} — ${t.fecha}: guardado [${guardados.join(',')}] vs fuente [${t.numeros.join(',')}]`);
      totalCorregidas++;
      if (APLICAR) {
        const { error: errUpd } = await supabase
          .from('sorteos')
          .update({ numeros: '[' + t.numeros.join(',') + ']' })
          .eq('id', fila.id);
        if (errUpd) console.error(`  -> No se pudo corregir: ${errUpd.message}`);
        else console.log('  -> Corregido.');
      }
    }
  }

  await browser.close();

  console.log(`\n[resync] Resumen: ${totalIguales} ya estaban bien, ${totalCorregidas} distintas, ${totalInsertadas} faltantes.`);
  if (!APLICAR && (totalCorregidas > 0 || totalInsertadas > 0)) {
    console.log('[resync] Nada fue modificado (modo lectura). Vuelve a correr con --aplicar si esto se ve bien.');
  }
}

main().catch((e) => {
  console.error('[resync] Error fatal:', e);
  process.exit(1);
});
