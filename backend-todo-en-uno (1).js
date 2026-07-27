/**
 * ============================================================
 * BACKEND TODO-EN-UNO — LotoAnalytics (loterías dominicanas)
 * ============================================================
 */

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
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

// 2) CLIENTE DE BASE DE DATOS (Supabase)
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

  const conBarras = limpio.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (conBarras) {
    const [, d, m, y] = conBarras;
    return ${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')};
  }
  const conMesTexto = limpio.match(/(\d{1,2})\s+([a-záéíóú]+)\.?\s+(\d{4})/i);
  if (conMesTexto) {
    const [, d, mesTxt, y] = conMesTexto;
    const mes = MESES_ABR[mesTxt.slice(0, 3)];
    if (mes !== undefined) return ${y}-${String(mes + 1).padStart(2, '0')}-${d.padStart(2, '0')};
  }
  return new Date().toISOString().slice(0, 10);
}

// 3) SCRAPER
async function extraerUnaFuenteConAxios(fuente) {
  const { data: html } = await axios.get(fuente.url, {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  const $ = cheerio.load(html);
  
  let numeros = [];
  let textoFecha = '';

  $(fuente.selectores.contenedorUltimoResultado).each((_, cont) => {
    if (numeros.length > 0) return;
    const nums = $(cont).find(fuente.selectores.numeros)
      .map((_, el) => parseInt($(el).text().trim(), 10)).get()
      .filter((n) => !Number.isNaN(n));

    if (nums.length > 0) {
      numeros = nums;
      textoFecha = $(cont).find(fuente.selectores.fecha).first().text();
    }
  });

  if (numeros.length === 0) {
    console.warn('[scraper] ' + fuente.loteria + ' — ' + fuente.juego + ': no se encontraron números.');
    return null;
  }

  return {
    loteria: fuente.loteria,
    juego: fuente.juego,
    fecha: normalizarFecha(textoFecha),
    numeros,
    hora_publicacion: new Date().toISOString()
  };
}

async function ejecutarScrapingYGuardar() {
  console.log('[robot] Iniciando recolección de sorteos...');
  const resultados = { guardados: [], errores: [] };

  for (const fuente of FUENTES) {
    try {
      const sorteo = await extraerUnaFuenteConAxios(fuente);
      if (sorteo) {
        const guardado = await guardarSorteo(sorteo);
        resultados.guardados.push(guardado);
        console.log('[scraper] ¡ÉXITO! Guardado: ' + sorteo.loteria + ' — ' + sorteo.juego + ' (' + sorteo.fecha + ') -> [' + sorteo.numeros.join(', ') + ']');
      }
    } catch (err) {
      resultados.errores.push({ fuente: fuente.loteria + ' — ' + fuente.juego, error: err.message });
      console.error('[scraper] Error en ' + fuente.loteria + ' — ' + fuente.juego + ':', err.message);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('[robot] Proceso finalizado. Guardados: ' + resultados.guardados.length + ', Errores: ' + resultados.errores.length);
  return resultados;
}

// EJECUCIÓN DIRECTA
ejecutarScrapingYGuardar().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('[robot] Error crítico:', err);
  process.exit(1);
});
