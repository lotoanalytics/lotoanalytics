/**
 * ============================================================
 * BACKEND TODO-EN-UNO — Mis Recomendaciones (loterías dominicanas)
 * ============================================================
 * Este archivo junta TODO el backend en un solo lugar:
 *   1) Configuración (variables de entorno)
 *   2) Cliente de base de datos (Supabase)
 *   3) Scraper con axios + cheerio (Plan A: HTML estático)
 *   4) Scraper con Puppeteer (Plan B: páginas que renderizan con JS)
 *   5) Cron / loop de actualización automática
 *   6) El esquema SQL completo, como comentario al final, para pegarlo
 *      una sola vez en el SQL Editor de Supabase.
 *
 * IMPORTANTE: esto es Node.js, NO va dentro de portada-1.html. El HTML
 * corre en el navegador del usuario; esto necesita correr en un servidor
 * (tu compu, un VPS, Render, Railway, etc.) para poder:
 *   - guardar datos de forma segura (con una clave que nunca debe llegar
 *     al navegador — SUPABASE_SERVICE_ROLE_KEY dará acceso total a tu BD),
 *   - hacer scraping/cron en segundo plano, algo que un navegador no puede
 *     hacer por sí solo aunque el archivo esté "junto".
 *
 * INSTALAR:
 *   npm init -y
 *   npm install axios cheerio node-cron dotenv @supabase/supabase-js
 *   npm install puppeteer          (opcional, solo si usas el Plan B)
 *
 * CONFIGURAR:
 *   Crea un archivo ".env" junto a este archivo con:
 *     SUPABASE_URL=https://TU-PROYECTO.supabase.co
 *     SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
 *     FUENTE_BASE_URL=https://loteriasdominicanas.com
 *
 * CORRER:
 *   node backend-todo-en-uno.js            -> arranca el cron (modo continuo)
 *   node backend-todo-en-uno.js --once      -> corre el scraper una sola vez y termina
 *   node backend-todo-en-uno.js --puppeteer -> corre el scraper una vez con Puppeteer
 * ============================================================
 */

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

// ------------------------------------------------------------
// 1) CONFIGURACIÓN
// ------------------------------------------------------------
const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  fuenteBaseUrl: process.env.FUENTE_BASE_URL || 'https://loteriasdominicanas.com',
};

if (!CONFIG.supabaseUrl || !CONFIG.supabaseServiceKey) {
  console.warn('[config] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en tu .env — el guardado en base de datos fallará hasta que los pongas.');
}

// Mapea cada juego de tu prototipo a la URL donde se publica su resultado y a
// los selectores CSS para extraerlo. AJUSTA esto a la fuente real que uses:
// los selectores de abajo son un punto de partida, no una fuente ya probada
// (varios sitios de resultados de lotería renderizan los números con
// JavaScript; si cheerio no encuentra nada, usa el Plan B con Puppeteer,
// o mejor aún: revisa con las herramientas de red del navegador si el sitio
// tiene un endpoint JSON interno — eso siempre es más confiable que leer HTML).
const FUENTES = [
  {
    loteria: 'Lotería Nacional',
    juego: 'Gana Más',
    url: `${CONFIG.fuenteBaseUrl}/loteria-nacional/gana-mas/`,
    esperarSelector: '.resultado-reciente, .card-resultado', // solo lo usa el Plan B (Puppeteer)
    selectores: {
      contenedorUltimoResultado: '.resultado-reciente, .card-resultado',
      numeros: '.bola, .numero-ganador',
      fecha: '.fecha-sorteo, time',
    },
  },
  {
    loteria: 'Leidsa',
    juego: 'Súper Kino TV',
    url: `${CONFIG.fuenteBaseUrl}/leidsa/super-kino-tv/`,
    esperarSelector: '.resultado-reciente, .card-resultado',
    selectores: {
      contenedorUltimoResultado: '.resultado-reciente, .card-resultado',
      numeros: '.bola, .numero-ganador',
      fecha: '.fecha-sorteo, time',
    },
  },
  // ... agrega aquí el resto de loterías/juegos de tu prototipo (loterias[] en portada-1.html)
];

// ------------------------------------------------------------
// 2) CLIENTE DE BASE DE DATOS (Supabase)
// ------------------------------------------------------------
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseServiceKey);

/** Inserta o actualiza un sorteo (evita duplicar el mismo día/juego/lotería). */
async function guardarSorteo(sorteo) {
  const registro = {
    loteria: sorteo.loteria,
    juego: sorteo.juego,
    fecha: sorteo.fecha, // 'YYYY-MM-DD'
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

/** Trae el sorteo de una lotería/juego para una fecha exacta (calendario del frontend). */
async function obtenerSorteoPorFecha(loteria, juego, fecha) {
  const { data, error } = await supabase
    .from('sorteos').select('*')
    .eq('loteria', loteria).eq('juego', juego).eq('fecha', fecha)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Trae el historial completo de un juego, ordenado por fecha (para el motor Post-Inercia, frecuencias, etc). */
async function obtenerHistorial(loteria, juego, limite = 500) {
  const { data, error } = await supabase
    .from('sorteos').select('*')
    .eq('loteria', loteria).eq('juego', juego)
    .order('fecha', { ascending: true }).limit(limite);
  if (error) throw error;
  return data;
}

/** Trae todo lo publicado hoy (para el feed de "Resultados" y el efecto visual "hoy"). */
async function obtenerSorteosDeHoy() {
  const hoy = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('sorteos').select('*')
    .eq('fecha', hoy).order('hora_publicacion', { ascending: false });
  if (error) throw error;
  return data;
}

// ------------------------------------------------------------
// 3) SCRAPER — Plan A: axios + cheerio (HTML estático)
// ------------------------------------------------------------
const MESES_ABR = { ene:0, feb:1, mar:2, abr:3, may:4, jun:5, jul:6, ago:7, sep:8, oct:9, nov:10, dic:11 };

/** Convierte fechas tipo "26 jul 2026" o "26/07/2026" a 'YYYY-MM-DD'. */
function normalizarFecha(textoFecha) {
  const limpio = textoFecha.trim().toLowerCase();

  const conBarras = limpio.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (conBarras) {
    const [, d, m, y] = conBarras;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const conMesTexto = limpio.match(/(\d{1,2})\s+([a-záéíóú]+)\.?\s+(\d{4})/i);
  if (conMesTexto) {
    const [, d, mesTxt, y] = conMesTexto;
    const mes = MESES_ABR[mesTxt.slice(0, 3)];
    if (mes !== undefined) return `${y}-${String(mes + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  console.warn(`[normalizarFecha] No se pudo interpretar "${textoFecha}", usando la fecha de hoy.`);
  return new Date().toISOString().slice(0, 10);
}

async function extraerUnaFuenteConAxios(fuente) {
  const { data: html } = await axios.get(fuente.url, {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MisRecomendacionesBot/1.0)' },
  });
  const $ = cheerio.load(html);
  const contenedor = $(fuente.selectores.contenedorUltimoResultado).first();
  if (contenedor.length === 0) {
    console.warn(`[scraper] ${fuente.loteria} — ${fuente.juego}: no se encontró el contenedor. Revisa los selectores o usa el Plan B (Puppeteer).`);
    return null;
  }
  const numeros = contenedor.find(fuente.selectores.numeros)
    .map((_, el) => parseInt($(el).text().trim(), 10)).get()
    .filter((n) => !Number.isNaN(n));
  const textoFecha = contenedor.find(fuente.selectores.fecha).first().text();
  if (numeros.length === 0 || !textoFecha) {
    console.warn(`[scraper] ${fuente.loteria} — ${fuente.juego}: datos incompletos.`);
    return null;
  }
  return { loteria: fuente.loteria, juego: fuente.juego, fecha: normalizarFecha(textoFecha), numeros, hora_publicacion: new Date().toISOString() };
}

async function ejecutarScrapingConAxios() {
  const resultados = { guardados: [], errores: [] };
  for (const fuente of FUENTES) {
    try {
      const sorteo = await extraerUnaFuenteConAxios(fuente);
      if (sorteo) {
        const guardado = await guardarSorteo(sorteo);
        resultados.guardados.push(guardado);
        console.log(`[scraper] Guardado: ${sorteo.loteria} — ${sorteo.juego} (${sorteo.fecha})`);
      }
    } catch (err) {
      resultados.errores.push({ fuente: `${fuente.loteria} — ${fuente.juego}`, error: err.message });
      console.error(`[scraper] Error en ${fuente.loteria} — ${fuente.juego}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 800)); // pausa entre requests, por cortesía con la fuente
  }
  return resultados;
}

// ------------------------------------------------------------
// 4) SCRAPER — Plan B: Puppeteer (para páginas que renderizan con JS)
// ------------------------------------------------------------
async function ejecutarScrapingConPuppeteer() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    console.error('[scraper-puppeteer] Falta instalar puppeteer: npm install puppeteer');
    return { guardados: [], errores: [{ fuente: 'general', error: 'puppeteer no instalado' }] };
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  const resultados = { guardados: [], errores: [] };
  try {
    for (const fuente of FUENTES) {
      const page = await browser.newPage();
      try {
        await page.setUserAgent('Mozilla/5.0 (compatible; MisRecomendacionesBot/1.0)');
        await page.goto(fuente.url, { waitUntil: 'networkidle2', timeout: 20000 });
        await page.waitForSelector(fuente.esperarSelector, { timeout: 10000 });

        const html = await page.content();
        const $ = cheerio.load(html);
        const contenedor = $(fuente.selectores.contenedorUltimoResultado).first();
        const numeros = contenedor.find(fuente.selectores.numeros)
          .map((_, el) => parseInt($(el).text().trim(), 10)).get()
          .filter((n) => !Number.isNaN(n));
        const textoFecha = contenedor.find(fuente.selectores.fecha).first().text();

        if (numeros.length > 0 && textoFecha) {
          const sorteo = { loteria: fuente.loteria, juego: fuente.juego, fecha: normalizarFecha(textoFecha), numeros, hora_publicacion: new Date().toISOString() };
          const guardado = await guardarSorteo(sorteo);
          resultados.guardados.push(guardado);
          console.log(`[scraper-puppeteer] Guardado: ${sorteo.loteria} — ${sorteo.juego} (${sorteo.fecha})`);
        }
      } catch (err) {
        resultados.errores.push({ fuente: `${fuente.loteria} — ${fuente.juego}`, error: err.message });
        console.error(`[scraper-puppeteer] Error en ${fuente.loteria} — ${fuente.juego}:`, err.message);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return resultados;
}

// ------------------------------------------------------------
// 5) CRON / LOOP DE ACTUALIZACIÓN AUTOMÁTICA
// ------------------------------------------------------------
function arrancarCron() {
  // Corre cada 5 minutos durante horas típicas de sorteo en RD (ajusta a tu gusto).
  // Formato node-cron: minuto hora día mes díaSemana
  cron.schedule('*/5 12-22 * * *', async () => {
    console.log(`[cron] Revisando resultados… ${new Date().toISOString()}`);
    const r = await ejecutarScrapingConAxios();
    console.log(`[cron] Guardados: ${r.guardados.length}, errores: ${r.errores.length}`);
  }, { timezone: 'America/Santo_Domingo' });

  console.log('[cron] Backend en marcha. Revisando resultados cada 5 minutos entre 12:00 y 22:00 (hora RD).');
}

// ------------------------------------------------------------
// PUNTO DE ENTRADA
// ------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--once')) {
    ejecutarScrapingConAxios().then((r) => {
      console.log(`Listo. Guardados: ${r.guardados.length}, errores: ${r.errores.length}`);
      process.exit(r.errores.length > 0 && r.guardados.length === 0 ? 1 : 0);
    });
  } else if (args.includes('--puppeteer')) {
    ejecutarScrapingConPuppeteer().then((r) => {
      console.log(`Listo. Guardados: ${r.guardados.length}, errores: ${r.errores.length}`);
      process.exit(r.errores.length > 0 && r.guardados.length === 0 ? 1 : 0);
    });
  } else {
    arrancarCron();
  }
}

module.exports = {
  guardarSorteo, obtenerSorteoPorFecha, obtenerHistorial, obtenerSorteosDeHoy,
  ejecutarScrapingConAxios, ejecutarScrapingConPuppeteer, normalizarFecha,
};

/**
 * ============================================================
 * ESQUEMA SQL — pega esto UNA SOLA VEZ en Supabase: Dashboard -> SQL Editor
 * ============================================================
 *
 * create extension if not exists "pgcrypto";
 *
 * create table if not exists public.sorteos (
 *   id                uuid primary key default gen_random_uuid(),
 *   loteria           text not null,
 *   juego             text not null,
 *   fecha             date not null,
 *   numeros           integer[] not null,
 *   hora_publicacion  timestamptz not null default now(),
 *   creado_en         timestamptz not null default now(),
 *   constraint sorteos_unicos unique (loteria, juego, fecha)
 * );
 *
 * create index if not exists idx_sorteos_fecha on public.sorteos (fecha desc);
 * create index if not exists idx_sorteos_loteria_juego on public.sorteos (loteria, juego);
 * create index if not exists idx_sorteos_loteria_juego_fecha on public.sorteos (loteria, juego, fecha desc);
 *
 * alter table public.sorteos enable row level security;
 *
 * create policy "Lectura pública de sorteos"
 *   on public.sorteos for select
 *   using (true);
 *
 * -- Solo la service_role (este backend) puede escribir; no se crea policy
 * -- de INSERT/UPDATE para "anon" a propósito.
 *
 * -- Realtime (para que el frontend reciba el INSERT apenas ocurre):
 * -- Dashboard -> Database -> Replication -> agrega la tabla "sorteos"
 * -- (o, si tu plan lo permite): alter publication supabase_realtime add table public.sorteos;
 * ============================================================
 */
