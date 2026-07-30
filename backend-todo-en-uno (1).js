require('dotenv').config();
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

// 1) CONFIGURACIÓN
const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  fuenteBaseUrl: process.env.FUENTE_BASE_URL || 'https://loteriasdominicanas.com',
};

if (!CONFIG.supabaseUrl || !CONFIG.supabaseServiceKey) {
  console.warn('[config] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en tu .env');
}

const FUENTES = [
  {
    loteria: 'Lotería Nacional',
    juego: 'Gana Más',
    url: CONFIG.fuenteBaseUrl + '/loteria-nacional/gana-mas/',
  },
  {
    loteria: 'Lotería Nacional',
    juego: 'Juega + Pega +',
    // 5 números: 2 de tómbola azul, 2 de tómbola roja, 1 de tómbola blanca (1-26 c/u).
    url: CONFIG.fuenteBaseUrl + '/loteria-nacional/juega-mas-pega-mas/',
  },
  {
    loteria: 'Lotería Nacional',
    juego: 'Quiniela Nacional',
    // Ojo: "Quiniela Nacional" (a veces llamada "Nacional Noche") es un sorteo
    // DISTINTO de "Gana Más" -números diferentes cada día- por eso se scrapea
    // aparte, de esta otra página de la misma fuente.
    url: CONFIG.fuenteBaseUrl + '/loteria-nacional/quiniela/',
  },
  {
    loteria: 'Leidsa',
    juego: 'Súper Kino TV',
    url: CONFIG.fuenteBaseUrl + '/leidsa/super-kino-tv/',
  },
  {
    loteria: 'Loteka',
    juego: 'Quiniela Loteka',
    // Confirmado en la fuente: el slug real es "quiniela-mega-decenas", no
    // "quiniela-loteka" como se podría suponer por el nombre del juego.
    url: CONFIG.fuenteBaseUrl + '/loteka/quiniela-mega-decenas/',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Quiniela',
    url: CONFIG.fuenteBaseUrl + '/loto-real/quiniela/',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Tu Fecha Real',
    // Sorteo propio e independiente de la Quiniela: 1 número de una tómbola
    // del 0 al 31. Confirmado en la fuente bajo el slug "quinielita".
    url: CONFIG.fuenteBaseUrl + '/loto-real/quinielita/',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Nueva Yol Real',
    // Sorteo propio: 3 números (00-99) más el color de la manzana.
    url: CONFIG.fuenteBaseUrl + '/loto-real/nueva-yol-real/',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Loto Pool',
    // Sorteo propio: 4 números (00-99), sorteo del mediodía (1:00 PM).
    url: CONFIG.fuenteBaseUrl + '/loto-real/loto-pool/',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Loto Pool Noche',
    // Edición nocturna (8:00 PM) del Loto Pool Real.
    url: CONFIG.fuenteBaseUrl + '/loto-real/loto-pool-noche',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Pega 4 Real',
    // 4 dígitos, cada uno de una tómbola del 0 al 9.
    url: CONFIG.fuenteBaseUrl + '/loto-real/pega-4',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Repartidera Real',
    // Sorteo propio e independiente: 1 número (00-99), los últimos 2 dígitos
    // del ticket de Chance Real.
    url: CONFIG.fuenteBaseUrl + '/loto-real/repartidera-real',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Chance Real',
    // Sorteo propio: 5 números (00-99), sorteo nocturno (8:00 PM).
    url: CONFIG.fuenteBaseUrl + '/loto-real/chance-real',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Súper Palé',
    // Combina el 1er número de Quiniela Real + el 1er número de Lotería
    // Nacional. No confundir con "Leidsa|Súper Palé" (fuente distinta).
    url: CONFIG.fuenteBaseUrl + '/loto-real/super-pale/',
  },
  {
    loteria: 'La Suerte Dominicana',
    juego: 'La Suerte 12:30',
    url: CONFIG.fuenteBaseUrl + '/la-suerte-dominicana/quiniela/',
  },
  {
    loteria: 'La Suerte Dominicana',
    juego: 'La Suerte 18:00',
    url: CONFIG.fuenteBaseUrl + '/la-suerte-dominicana/quiniela-tarde/',
  },
  {
    loteria: 'LoteDom',
    juego: 'Quiniela LoteDom',
    url: CONFIG.fuenteBaseUrl + '/lotedom/quiniela/',
  },
  {
    loteria: 'King Lottery',
    juego: 'Quiniela Día',
    url: CONFIG.fuenteBaseUrl + '/king-lottery/quiniela-dia/',
  },
  {
    loteria: 'King Lottery',
    juego: 'Quiniela Noche',
    url: CONFIG.fuenteBaseUrl + '/king-lottery/quiniela-noche/',
  },
  // Anguila tiene 9 sorteos independientes al día (no es un solo sorteo con
  // varias formas de apostar): cada franja horaria saca sus propios números.
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 8:00 AM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-8-am/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 9:00 AM',
    // Patrón inferido a partir de anguila-8-am y anguila-11-am, confirmados; no
    // se pudo confirmar esta URL exacta de forma directa — revisar si falla.
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-9-am/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 10:00 AM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-manana/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 11:00 AM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-11-am/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 12:00 PM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-12-pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 1:00 PM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-medio-dia/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 2:00 PM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-2-pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 3:00 PM',
    // Patrón inferido a partir de anguila-2-pm y anguila-4pm, confirmados; no se
    // pudo confirmar esta URL exacta de forma directa — revisar si falla.
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-3-pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 4:00 PM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-4pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 5:00 PM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-5pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 6:00 PM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-tarde/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 7:00 PM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-7pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 8:00 PM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-8pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 9:00 PM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-noche/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 10:00 PM',
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-10pm/',
  },
  {
    loteria: 'La Primera',
    juego: 'La Primera Día',
    url: CONFIG.fuenteBaseUrl + '/la-primera/quiniela-medio-dia/',
  },
  {
    loteria: 'La Primera',
    juego: 'La Primera Noche',
    url: CONFIG.fuenteBaseUrl + '/la-primera/quiniela-noche/',
  },
  {
    loteria: 'La Primera',
    juego: 'Loto 5 (+ Loto5+)',
    url: CONFIG.fuenteBaseUrl + '/la-primera/loto-5/',
  },
  {
    loteria: 'La Primera',
    juego: 'El Quinielón Día',
    // Sorteo propio e independiente: 1 número (00-99), tómbola aparte, 12:00 PM.
    url: CONFIG.fuenteBaseUrl + '/la-primera/el-quinielon-dia',
  },
  {
    loteria: 'La Primera',
    juego: 'El Quinielón Noche',
    // Sorteo propio e independiente: 1 número (00-99), tómbola aparte, 8:00 PM.
    url: CONFIG.fuenteBaseUrl + '/la-primera/el-quinielon-noche',
  },
  {
    loteria: 'La Primera',
    juego: 'Súper Palé',
    // Combina el 1er número de La Primera Día + el 1er número de Lotería
    // Nacional Noche. No confundir con "Leidsa|Súper Palé" ni "Lotería Real|Súper Palé".
    url: CONFIG.fuenteBaseUrl + '/la-primera/super-pale/',
  },
  {
    loteria: 'Leidsa',
    juego: 'Loto Leidsa (+ Más/Súper Más)',
    url: CONFIG.fuenteBaseUrl + '/leidsa/loto-mas/',
  },
  {
    loteria: 'Leidsa',
    juego: 'Loto Pool',
    url: CONFIG.fuenteBaseUrl + '/leidsa/loto-pool/',
  },
  {
    loteria: 'Leidsa',
    juego: 'Pega 3 Más',
    url: CONFIG.fuenteBaseUrl + '/leidsa/pega-3-mas/',
  },
  {
    loteria: 'Leidsa',
    juego: 'Quiniela Leidsa / Palé',
    url: CONFIG.fuenteBaseUrl + '/leidsa/quiniela-pale/',
  },
  {
    loteria: 'Leidsa',
    juego: 'Súper Palé',
    // Sorteo propio e independiente: 2 números (00-99) — combina el 1er
    // número de Quiniela Leidsa y el 1er número de Lotería Nacional Noche.
    url: CONFIG.fuenteBaseUrl + '/leidsa/super-pale/',
  },
  {
    loteria: 'Loteka',
    juego: 'Mega Chances',
    url: CONFIG.fuenteBaseUrl + '/loteka/mega-chances/',
  },
  {
    loteria: 'Loteka',
    juego: 'Mega Chances Repartidera',
    // Sorteo propio e independiente: 1 número (00-99), los últimos 2 dígitos
    // del quinto número de Mega Chances. Página propia confirmada en la fuente.
    url: CONFIG.fuenteBaseUrl + '/loteka/mega-chances-repartidera/',
  },
  {
    loteria: 'Loteka',
    juego: 'Toca 3',
    url: CONFIG.fuenteBaseUrl + '/loteka/toca-3/',
  },
  {
    loteria: 'Loteka',
    juego: 'Mega Lotto',
    url: CONFIG.fuenteBaseUrl + '/loteka/megalotto/',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Loto Real',
    url: CONFIG.fuenteBaseUrl + '/loto-real/loto/',
  },
  {
    loteria: 'LoteDom',
    juego: 'El Quemaito Mayor',
    url: CONFIG.fuenteBaseUrl + '/lotedom/el-quemaito-mayor/',
  },
  {
    loteria: 'LoteDom',
    juego: 'Agarra 4',
    // Sorteo propio e independiente: 4 números (00-99) — los 3 de la Quiniela
    // LoteDom más el de El Quemaito Mayor.
    url: CONFIG.fuenteBaseUrl + '/lotedom/agarra-4',
  },
  {
    loteria: 'LoteDom',
    juego: 'Súper Palé',
    // Combina el 1er número de Quiniela LoteDom + el número de El Quemaito
    // Mayor. No confundir con "Leidsa|Súper Palé", "Lotería Real|Súper Palé"
    // ni "La Primera|Súper Palé".
    url: CONFIG.fuenteBaseUrl + '/lotedom/super-pale',
  },
  // Americanas
  {
    loteria: 'Lotería New York',
    juego: 'Quiniela New York Tarde',
    url: CONFIG.fuenteBaseUrl + '/americanas/new-york-medio-dia/',
  },
  {
    loteria: 'Lotería New York',
    juego: 'Quiniela New York Noche',
    url: CONFIG.fuenteBaseUrl + '/americanas/new-york-noche/',
  },
  {
    loteria: 'Florida',
    juego: 'Quiniela Florida Día',
    url: CONFIG.fuenteBaseUrl + '/americanas/florida-tarde/',
  },
  {
    loteria: 'Florida',
    juego: 'Quiniela Florida Noche',
    url: CONFIG.fuenteBaseUrl + '/americanas/florida-noche/',
  },
  {
    loteria: 'Mega Millions',
    juego: 'Mega Millions',
    url: CONFIG.fuenteBaseUrl + '/americanas/mega-millions/',
  },
  {
    loteria: 'PowerBall',
    juego: 'Powerball',
    url: CONFIG.fuenteBaseUrl + '/americanas/powerball/',
  },
  // King Lottery: Pick 3, Pick 4 y Loto Pool (Día/Noche)
  {
    loteria: 'King Lottery',
    juego: 'Pick 3 Día',
    url: CONFIG.fuenteBaseUrl + '/king-lottery/pick-3-dia/',
  },
  {
    loteria: 'King Lottery',
    juego: 'Pick 3 Noche',
    url: CONFIG.fuenteBaseUrl + '/king-lottery/pick-3-noche/',
  },
  {
    loteria: 'King Lottery',
    juego: 'Pick 4 Día',
    url: CONFIG.fuenteBaseUrl + '/king-lottery/pick-4-dia/',
  },
  {
    loteria: 'King Lottery',
    juego: 'Pick 4 Noche',
    url: CONFIG.fuenteBaseUrl + '/king-lottery/pick-4-noche/',
  },
  {
    loteria: 'King Lottery',
    juego: 'Loto Pool Día',
    url: CONFIG.fuenteBaseUrl + '/king-lottery/loto-pool-dia/',
  },
  {
    loteria: 'King Lottery',
    juego: 'Loto Pool Noche',
    url: CONFIG.fuenteBaseUrl + '/king-lottery/loto-pool-noche/',
  },
];

// 2) CLIENTE DE BASE DE DATOS
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseServiceKey);

async function guardarSorteo(sorteo) {
  const registro = {
    loteria: sorteo.loteria,
    juego: sorteo.juego,
    fecha: sorteo.fecha,
    numeros: sorteo.numeros,
    hora_publicacion: sorteo.hora_publicacion || new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('sorteos')
    .upsert(registro, { onConflict: 'loteria,juego,fecha' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

const MESES_ABR = { ene:0, feb:1, mar:2, abr:3, may:4, jun:5, jul:6, ago:7, sep:8, oct:9, nov:10, dic:11 };

// La República Dominicana es UTC-4 todo el año (no tiene horario de verano), pero
// GitHub Actions corre el robot en UTC. Entre las 8:00 PM y la medianoche hora RD,
// en UTC YA es el día siguiente — así que usar new Date() "a secas" como fecha de
// hoy podía adelantar un sorteo de anoche (ej. Súper Kino TV, sale 8:55 PM) al día
// siguiente. Esta función calcula la fecha real de HOY en horario dominicano, sin
// importar en qué huso horario esté corriendo el servidor.
function fechaHoyRD() {
  const ahoraUTC = new Date();
  const ahoraRD = new Date(ahoraUTC.getTime() - 4 * 60 * 60 * 1000);
  return ahoraRD.toISOString().slice(0, 10);
}

// "Hoy"/"Ayer" - RD, a partir de fechaHoyRD() (no de new Date() directo, mismo motivo).
function fechaAyerRD() {
  const [y, m, d] = fechaHoyRD().split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  fecha.setDate(fecha.getDate() - 1);
  const yy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function fechaMananaRD() {
  const [y, m, d] = fechaHoyRD().split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  fecha.setDate(fecha.getDate() + 1);
  const yy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function normalizarFecha(textoFecha) {
  const resultado = normalizarFechaBruta(textoFecha);
  // Ningún sorteo puede tener fecha futura respecto a "hoy" en RD — si la página
  // fuente calculó mal su fecha (les pasa de noche, cuando su servidor usa UTC
  // en vez de hora RD), se corrige aquí. Antes solo se comparaba contra "mañana"
  // exacto; ahora se corrige CUALQUIER fecha futura (formato YYYY-MM-DD, así que
  // la comparación de strings ya es cronológica), por si el desfase es mayor a 1 día.
  if (resultado > fechaHoyRD()) {
    console.warn(`[robot] Fecha "${textoFecha}" venía marcada en el futuro (${resultado}); corregida a hoy (${fechaHoyRD()}).`);
    return fechaHoyRD();
  }
  return resultado;
}

// Si el robot corre después de medianoche RD (por reintentos o por demoras de
// GitHub Actions — ver aviso anterior sobre esto), la página fuente a veces
// TODAVÍA no actualizó su sorteo del nuevo día: sigue mostrando el resultado de
// anoche pero con la etiqueta "Hoy" pegada (que ellos mismos no han refrescado).
// Nuestro código antes confiaba ciegamente en esa etiqueta y guardaba el sorteo
// de anoche con la fecha de HOY — números correctos, fecha equivocada.
// Esta función detecta ese caso: si el resultado quedó fechado "hoy" pero los
// números son IDÉNTICOS a los que ya tenemos guardados para "ayer" en este mismo
// juego, es casi seguro que es el mismo sorteo repetido con etiqueta vieja —
// en ese caso se mantiene la fecha de ayer en vez de crear una fila falsa de hoy.
async function normalizarFechaConVerificacion(textoFecha, loteria, juego, numeros) {
  let fecha = normalizarFecha(textoFecha);
  if (fecha === fechaHoyRD()) {
    try {
      const { data } = await supabase
        .from('sorteos')
        .select('numeros')
        .eq('loteria', loteria)
        .eq('juego', juego)
        .eq('fecha', fechaAyerRD())
        .maybeSingle();
      if (data && Array.isArray(data.numeros) && JSON.stringify(data.numeros) === JSON.stringify(numeros)) {
        console.warn(`[robot] ${loteria} — ${juego}: números idénticos a los de ayer (${fechaAyerRD()}); la fuente aún no actualizó su sorteo de hoy. Se mantiene fecha de ayer en vez de duplicar como hoy.`);
        fecha = fechaAyerRD();

        // La corrección de arriba evita crear una fila NUEVA mal fechada, pero si
        // ya existe una fila fantasma fechada "hoy" con estos mismos números —
        // guardada en una corrida anterior antes de esta protección, o en un ciclo
        // previo de hoy mismo — hay que borrarla, si no se queda duplicada para
        // siempre (el upsert no la toca porque hoy estamos escribiendo en "ayer").
        try {
          const { data: filaHoy } = await supabase
            .from('sorteos')
            .select('numeros')
            .eq('loteria', loteria)
            .eq('juego', juego)
            .eq('fecha', fechaHoyRD())
            .maybeSingle();
          if (filaHoy && JSON.stringify(filaHoy.numeros) === JSON.stringify(numeros)) {
            await supabase.from('sorteos').delete()
              .eq('loteria', loteria).eq('juego', juego).eq('fecha', fechaHoyRD());
            console.warn(`[robot] ${loteria} — ${juego}: se eliminó la fila fantasma fechada hoy (${fechaHoyRD()}) que había quedado duplicada.`);
          }
        } catch (eBorrado) {
          console.warn(`[robot] No se pudo verificar/borrar la fila fantasma de hoy para ${loteria} — ${juego}: ${eBorrado.message}`);
        }
      }
    } catch (e) {
      console.warn(`[robot] No se pudo verificar contra el sorteo de ayer para ${loteria} — ${juego}: ${e.message}`);
    }
  }
  return fecha;
}

function normalizarFechaBruta(textoFecha) {
  if (!textoFecha) return fechaHoyRD();
  const limpio = textoFecha.trim().toLowerCase();

  // Algunas fuentes muestran "Hoy" / "Ayer" en vez de la fecha numérica para los
  // resultados más recientes.
  if (limpio === 'hoy') return fechaHoyRD();
  if (limpio === 'ayer') return fechaAyerRD();

  const soloDiaMes = limpio.match(/^(\d{1,2})-(\d{1,2})$/);
  if (soloDiaMes) {
    const d = soloDiaMes[1].padStart(2, '0');
    const m = soloDiaMes[2].padStart(2, '0');
    const y = fechaHoyRD().slice(0, 4); // año de "hoy" en RD, no del servidor
    return y + '-' + m + '-' + d;
  }
  const conBarras = limpio.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (conBarras) {
    const d = conBarras[1].padStart(2, '0');
    const m = conBarras[2].padStart(2, '0');
    const y = conBarras[3];
    return y + '-' + m + '-' + d;
  }
  const conMesTexto = limpio.match(/(\d{1,2})\s+([a-záéíóú]+)\.?\s+(\d{4})/i);
  if (conMesTexto) {
    const d = conMesTexto[1].padStart(2, '0');
    const mesTxt = conMesTexto[2];
    const y = conMesTexto[3];
    const mes = MESES_ABR[mesTxt.slice(0, 3)];
    if (mes !== undefined) {
      const m = String(mes + 1).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
  }
  return fechaHoyRD();
}

// 3) OBTENER HTML YA RENDERIZADO (ejecutando el JavaScript de la página)
// Esto es lo que faltaba: el sitio pinta los números con JS en el navegador,
// así que un simple axios.get() solo trae el HTML "vacío" antes de que corra ese JS.
// Puppeteer abre un navegador real (sin interfaz), espera a que cargue, y nos
// devuelve el HTML final, ya con los números adentro.
async function obtenerHtmlRenderizado(browser, url) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    // 'domcontentloaded' en vez de 'networkidle2': algunos sitios (por anuncios,
    // trackers, etc.) nunca se "quedan quietos" de tráfico de red, así que
    // esperar a que la red esté en silencio puede colgarse sin necesidad.
    // Con domcontentloaded solo esperamos a que el HTML base cargue, y luego
    // le damos un margen fijo para que el JavaScript del sitio termine de
    // pintar los números.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(function (r) { setTimeout(r, 4000); });
    const html = await page.content();
    return html;
  } finally {
    await page.close();
  }
}

// 4) EXTRACCIÓN DE NÚMEROS (misma lógica de siempre, pero ahora sobre HTML ya renderizado)
function extraerNumerosDeHtml(html) {
  const $ = cheerio.load(html);

  let numeros = [];
  let textoFecha = '';

  // Estructura real del sitio (loteriasdominicanas.com, verificada en julio 2026):
  // cada resultado es una "tarjeta" .p-card; la primera tarjeta de la página
  // es siempre el resultado más reciente. La fecha está en .bg-slate-500
  // (formato "DD-MM", sin año) y los números en .score-shape-circle span.
  const primeraTarjeta = $('.p-card').first();
  if (primeraTarjeta.length > 0) {
    textoFecha = primeraTarjeta.find('.bg-slate-500').first().text().trim();
    primeraTarjeta.find('.score-shape-circle span').each(function (_, el) {
      const txt = $(el).text().trim();
      if (/^\d{1,2}$/.test(txt)) {
        numeros.push(parseInt(txt, 10));
      }
    });
  }

  // Respaldo por si el sitio vuelve a cambiar de estructura: búsqueda genérica
  // por bloques de juego con clases de nombre parecido.
  if (numeros.length === 0) {
    $('.game-block, .game-scores, div[class*="game"]').each(function (_, cont) {
      if (numeros.length > 0) return;

      const nums = [];
      $(cont).find('span, div, p').each(function (_, el) {
        const txt = $(el).children().length === 0 ? $(el).text().trim() : '';
        if (/^\d{1,2}$/.test(txt)) {
          nums.push(parseInt(txt, 10));
        }
      });

      if (nums.length > 0) {
        numeros = nums;
        textoFecha = $(cont).find('.game-date, time, .date, [class*="date"]').first().text();
      }
    });
  }

  // Segundo respaldo: cualquier elemento con clase que contenga "score", "bola" o "ball"
  if (numeros.length === 0) {
    $('[class*="score"], [class*="bola"], [class*="ball"]').each(function (_, el) {
      const txt = $(el).text().trim();
      if (/^\d{1,2}$/.test(txt)) {
        numeros.push(parseInt(txt, 10));
      }
    });
  }

  return { numeros: numeros, textoFecha: textoFecha };
}

const fs = require('fs');
const path = require('path');

async function extraerUnaFuenteConPuppeteer(browser, fuente) {
  const html = await obtenerHtmlRenderizado(browser, fuente.url);
  const { numeros, textoFecha } = extraerNumerosDeHtml(html);

  if (numeros.length === 0) {
    console.warn('[scraper] ' + fuente.loteria + ' — ' + fuente.juego + ': no se encontraron números.');
    // Guardamos el HTML tal como lo vio Puppeteer para poder revisar
    // las clases/selectores reales del sitio y ajustar la extracción.
    try {
      const nombreArchivo = 'debug-' + fuente.loteria.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + fuente.juego.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.html';
      const rutaDebug = path.join(process.cwd(), 'debug-html', nombreArchivo);
      fs.mkdirSync(path.dirname(rutaDebug), { recursive: true });
      fs.writeFileSync(rutaDebug, html, 'utf8');
      console.warn('[scraper] HTML de depuración guardado en: ' + rutaDebug);
    } catch (errGuardado) {
      console.warn('[scraper] No se pudo guardar el HTML de depuración: ' + errGuardado.message);
    }
    return null;
  }

  return {
    loteria: fuente.loteria,
    juego: fuente.juego,
    fecha: await normalizarFechaConVerificacion(textoFecha, fuente.loteria, fuente.juego, numeros),
    numeros: numeros,
    hora_publicacion: new Date().toISOString(),
  };
}

async function ejecutarScrapingYGuardar() {
  console.log('[robot] Iniciando recolección de sorteos...');
  const resultados = { guardados: [], errores: [] };

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (const fuente of FUENTES) {
      try {
        const sorteo = await extraerUnaFuenteConPuppeteer(browser, fuente);
        if (sorteo) {
          const guardado = await guardarSorteo(sorteo);
          resultados.guardados.push(guardado);
          console.log('[scraper] ¡ÉXITO! Guardado: ' + sorteo.loteria + ' — ' + sorteo.juego + ' (' + sorteo.fecha + ') -> [' + sorteo.numeros.join(', ') + ']');
        }
      } catch (err) {
        resultados.errores.push({ fuente: fuente.loteria + ' — ' + fuente.juego, error: err.message });
        console.error('[scraper] Error en ' + fuente.loteria + ' — ' + fuente.juego + ':', err.message);
      }
      await new Promise(function (r) { setTimeout(r, 1000); });
    }
  } finally {
    await browser.close();
  }

  console.log('[robot] Proceso finalizado. Guardados: ' + resultados.guardados.length + ', Errores: ' + resultados.errores.length);
  return resultados;
}

// EJECUCIÓN DIRECTA
ejecutarScrapingYGuardar().then(function () {
  process.exit(0);
}).catch(function (err) {
  console.error('[robot] Error crítico:', err);
  process.exit(1);
});
