/**
 * ============================================================
 * BACKEND-TODO-EN-UNO.JS
 * ============================================================
 * Scraper de resultados de lotería dominicana (loteriasdominicanas.com)
 * que guarda los sorteos en una tabla `sorteos` de Supabase.
 *
 * INSTALACIÓN
 * ------------------------------------------------------------
 *   npm install axios cheerio dotenv @supabase/supabase-js
 *
 * ARCHIVO .env (créalo en la misma carpeta que este archivo)
 * ------------------------------------------------------------
 *   SUPABASE_URL=https://tu-proyecto.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
 *   FUENTE_BASE_URL=https://loteriasdominicanas.com
 *   MIN_NUMEROS=1
 *   MAX_NUMEROS=20
 *   MAX_REINTENTOS=3
 *
 * TABLA ESPERADA EN SUPABASE
 * ------------------------------------------------------------
 *   create table sorteos (
 *     id uuid primary key default gen_random_uuid(),
 *     loteria text not null,
 *     juego text not null,
 *     fecha date not null,
 *     numeros int[] not null,
 *     hora_publicacion timestamptz not null,
 *     unique (loteria, juego, fecha)
 *   );
 *
 * EJECUCIÓN
 * ------------------------------------------------------------
 *   node backend-todo-en-uno.js
 *
 * ⚠️ IMPORTANTE — SELECTORES CSS
 * ------------------------------------------------------------
 * Los selectores de abajo son "best guess" con varios fallbacks,
 * incluyendo `body` como último recurso. Si el sitio real no usa
 * ninguna de las clases listadas, el scraper buscaría números en
 * TODA la página, mezclando resultados de otros juegos o anuncios.
 * No fue posible verificar el HTML real del sitio (sin acceso a
 * internet en este entorno). Antes de usar esto en producción:
 *   1. Abre la URL de cada juego en el navegador.
 *   2. Clic derecho sobre el número ganador -> "Inspeccionar".
 *   3. Copia la clase/ID real y reemplázala en `selectores` abajo.
 *   4. Elimina `body` de la lista una vez tengas selectores reales.
 * Mientras tanto, el script se auto-protege: si termina usando el
 * selector `body`, o si la cantidad de números está fuera de rango
 * (MIN_NUMEROS / MAX_NUMEROS), descarta el resultado y solo avisa
 * por consola, sin guardar datos incorrectos en la base de datos.
 * ============================================================
 */

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

// ============================================================
// 1) CONFIGURACIÓN
// ============================================================
const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  fuenteBaseUrl: process.env.FUENTE_BASE_URL || 'https://loteriasdominicanas.com',
  minNumeros: parseInt(process.env.MIN_NUMEROS || '1', 10),
  maxNumeros: parseInt(process.env.MAX_NUMEROS || '20', 10),
  maxReintentos: parseInt(process.env.MAX_REINTENTOS || '3', 10),
};

if (!CONFIG.supabaseUrl || !CONFIG.supabaseServiceKey) {
  console.warn('[config] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en tu .env');
}

// ============================================================
// 2) FUENTES A SCRAPEAR
// ============================================================
const FUENTES = [
  {
    loteria: 'Lotería Nacional',
    juego: 'Gana Más',
    url: CONFIG.fuenteBaseUrl + '/loteria-nacional/gana-mas/',
    selectores: {
      contenedorUltimoResultado: '.game-block, .game-scores, .resultado-reciente, .card-resultado, body',
      numeros: '.score, .bola, .numero-ganador, .ball',
      fecha: '.game-date, .fecha-sorteo, time, .date',
    },
  },
  {
    loteria: 'Leidsa',
    juego: 'Súper Kino TV',
    url: CONFIG.fuenteBaseUrl + '/leidsa/super-kino-tv/',
    selectores: {
      contenedorUltimoResultado: '.game-block, .game-scores, .resultado-reciente, .card-resultado, body',
      numeros: '.score, .bola, .numero-ganador, .ball',
      fecha: '.game-date, .fecha-sorteo, time, .date',
    },
  },
];

// ============================================================
// 3) CLIENTE DE BASE DE DATOS (Supabase)
// ============================================================
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

// ============================================================
// 4) UTILIDADES DE FECHA
// ============================================================
const MESES_ABR = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11 };

function normalizarFecha(textoFecha) {
  if (!textoFecha) return new Date().toISOString().slice(0, 10);
  const limpio = textoFecha.trim().toLowerCase();

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

// ============================================================
// 5) UTILIDAD DE REINTENTOS PARA PETICIONES HTTP
// ============================================================
async function obtenerHtmlConReintentos(url, maxReintentos) {
  let ultimoError;
  for (let intento = 1; intento <= maxReintentos; intento++) {
    try {
      const { data: html } = await axios.get(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      return html;
    } catch (err) {
      ultimoError = err;
      console.warn('[http] Intento ' + intento + '/' + maxReintentos + ' falló para ' + url + ': ' + err.message);
      if (intento < maxReintentos) {
        await new Promise(function (r) { setTimeout(r, 1500 * intento); });
      }
    }
  }
  throw ultimoError;
}

// ============================================================
// 6) SCRAPER
// ============================================================
async function extraerUnaFuenteConAxios(fuente) {
  const html = await obtenerHtmlConReintentos(fuente.url, CONFIG.maxReintentos);
  const $ = cheerio.load(html);

  let numeros = [];
  let textoFecha = '';
  let usoSelectorGenerico = false;

  $(fuente.selectores.contenedorUltimoResultado).each(function (_, cont) {
    if (numeros.length > 0) return;

    const esBody = $(cont).is('body');
    const nums = $(cont).find(fuente.selectores.numeros)
      .map(function (_, el) { return parseInt($(el).text().trim(), 10); }).get()
      .filter(function (n) { return !Number.isNaN(n); });

    if (nums.length > 0) {
      numeros = nums;
      textoFecha = $(cont).find(fuente.selectores.fecha).first().text();
      usoSelectorGenerico = esBody;
    }
  });

  if (numeros.length === 0) {
    console.warn('[scraper] ' + fuente.loteria + ' — ' + fuente.juego + ': no se encontraron números.');
    return null;
  }

  if (numeros.length < CONFIG.minNumeros || numeros.length > CONFIG.maxNumeros) {
    console.warn(
      '[scraper] ' + fuente.loteria + ' — ' + fuente.juego +
      ': se descartó el resultado por cantidad de números sospechosa (' + numeros.length + '). ' +
      'Revisa los selectores CSS para esta fuente.'
    );
    return null;
  }

  if (usoSelectorGenerico) {
    console.warn(
      '[scraper] ' + fuente.loteria + ' — ' + fuente.juego +
      ': se usó el selector genérico "body" como respaldo. ' +
      'Verifica que los números extraídos correspondan realmente a este sorteo.'
    );
  }

  return {
    loteria: fuente.loteria,
    juego: fuente.juego,
    fecha: normalizarFecha(textoFecha),
    numeros: numeros,
    hora_publicacion: new Date().toISOString(),
  };
}

// ============================================================
// 7) ORQUESTADOR PRINCIPAL
// ============================================================
async function ejecutarScrapingYGuardar() {
  console.log('[robot] Iniciando recolección de sorteos...');
  const resultados = { guardados: [], errores: [] };

  for (const fuente of FUENTES) {
    try {
      const sorteo = await extraerUnaFuenteConAxios(fuente);
      if (sorteo) {
        const guardado = await guardarSorteo(sorteo);
        resultados.guardados.push(guardado);
        console.log(
          '[scraper] ¡ÉXITO! Guardado: ' + sorteo.loteria + ' — ' + sorteo.juego +
          ' (' + sorteo.fecha + ') -> [' + sorteo.numeros.join(', ') + ']'
        );
      }
    } catch (err) {
      resultados.errores.push({ fuente: fuente.loteria + ' — ' + fuente.juego, error: err.message });
      console.error('[scraper] Error en ' + fuente.loteria + ' — ' + fuente.juego + ':', err.message);
    }
    await new Promise(function (r) { setTimeout(r, 1000); });
  }

  console.log('[robot] Proceso finalizado. Guardados: ' + resultados.guardados.length + ', Errores: ' + resultados.errores.length);
  return resultados;
}

// ============================================================
// EJECUCIÓN DIRECTA
// ============================================================
if (require.main === module) {
  ejecutarScrapingYGuardar()
    .then(function () { process.exit(0); })
    .catch(function (err) {
      console.error('[robot] Error crítico:', err);
      process.exit(1);
    });
}

module.exports = { ejecutarScrapingYGuardar, extraerUnaFuenteConAxios, normalizarFecha };
