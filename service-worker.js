// Service worker mínimo de LotoAnalytics.com
//
// Objetivo principal: cumplir el requisito técnico de Chrome/Android para
// que el sitio se pueda "Instalar" como app (necesita un service worker
// registrado con un evento 'fetch'). De paso, deja cacheado el "cascarón"
// de la página (el HTML/CSS/JS del index) para que abra más rápido y algo
// funcione aunque no haya internet en ese momento — pero los RESULTADOS de
// lotería siempre se piden frescos a Supabase por red, nunca desde caché,
// para no arriesgarse a mostrar un sorteo viejo como si fuera el de hoy.

const CACHE_NOMBRE = 'lotoanalytics-cascaron-v1';
const ARCHIVOS_CASCARON = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (evento) => {
  // IMPORTANTE: antes usaba cache.addAll(...), que es "todo o nada" — si UN
  // solo archivo de la lista fallaba en cargar (ej. una ruta con typo, un
  // 404 momentáneo), la instalación COMPLETA del service worker fallaba, y
  // eso le impedía a Chrome reconocer el sitio como una app instalable de
  // verdad (por eso el usuario solo conseguía un acceso directo normal, con
  // el ícono de Chrome pegado, en vez de una instalación real). Ahora cada
  // archivo se cachea por separado y con manejo de error individual, así que
  // un fallo aislado nunca bloquea que el service worker quede activo.
  evento.waitUntil(
    caches.open(CACHE_NOMBRE).then((cache) =>
      Promise.all(
        ARCHIVOS_CASCARON.map((archivo) =>
          cache.add(archivo).catch((err) => {
            console.warn('[SW] No se pudo pre-cachear', archivo, err);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres
          .filter((nombre) => nombre !== CACHE_NOMBRE)
          .map((nombre) => caches.delete(nombre))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);

  // Nunca cachear peticiones a Supabase (los datos de sorteos deben ser
  // siempre en vivo) ni peticiones que no sean GET.
  if (evento.request.method !== 'GET' || url.hostname.includes('supabase.co')) {
    return;
  }

  // Para el resto (el cascarón de la app): cache primero, con respaldo de
  // red, y actualiza el caché en segundo plano si la red trae algo nuevo.
  evento.respondWith(
    caches.match(evento.request).then((respuestaCache) => {
      const peticionRed = fetch(evento.request)
        .then((respuestaRed) => {
          if (respuestaRed && respuestaRed.status === 200) {
            const copia = respuestaRed.clone();
            caches.open(CACHE_NOMBRE).then((cache) => cache.put(evento.request, copia));
          }
          return respuestaRed;
        })
        .catch(() => respuestaCache);
      return respuestaCache || peticionRed;
    })
  );
});
