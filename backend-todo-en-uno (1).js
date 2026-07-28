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

function normalizarFecha(textoFecha) {
  if (!textoFecha) return new Date().toISOString().slice(0, 10);
  const limpio = textoFecha.trim().toLowerCase();

  const soloDiaMes = limpio.match(/^(\d{1,2})-(\d{1,2})$/);
  if (soloDiaMes) {
    const d = soloDiaMes[1].padStart(2, '0');
    const m = soloDiaMes[2].padStart(2, '0');
    const y = new Date().getFullYear();
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
  return new Date().toISOString().slice(0, 10);
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
    fecha: normalizarFecha(textoFecha),
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
