// Service worker mínimo de LotoAnalytics.com
//
// Objetivo principal: cumplir el requisito técnico de Chrome/Android para
// que el sitio se pueda "Instalar" como app (necesita un service worker
// registrado con un evento 'fetch'). De paso, deja cacheado el "cascarón"
// de la página (el HTML/CSS/JS del index) para que algo funcione aunque no
// haya internet en ese momento — pero los RESULTADOS de lotería siempre se
// piden frescos a Supabase por red, nunca desde caché, para no arriesgarse
// a mostrar un sorteo viejo como si fuera el de hoy.

// CORRECCIÓN: se sube la versión del caché (v1 -> v2) para que a todos los
// que ya tenían el service worker viejo instalado se les borre el caché
// anterior en cuanto este nuevo se active (ver 'activate' más abajo, que ya
// borra cualquier caché con nombre distinto al actual).
//
// CORRECCIÓN 2 (pedido: "borro caché y borro caché en el celular y sigue
// igual, pegado con lo de ayer — en incógnito sí se ve bien"): el 'fetch'
// de aquí abajo YA pedía la página fresca por red antes de usar el caché
// propio de este service worker — pero le faltaba decirle al NAVEGADOR que
// ignorara SU PROPIO caché HTTP normal (el de Chrome, que es un caché
// totalmente aparte del "caché del service worker" que se borra desde
// Ajustes). Sin eso, es posible que Chrome le devolviera a este mismo
// 'fetch()' una copia vieja que tenía guardada por su cuenta, sin llegar a
// tocar la red — y como eso pasa DENTRO del propio 'fetch', ni borrar el
// caché del service worker ni el del sitio lo arreglaba. En incógnito nunca
// hay nada guardado ahí, por eso se veía bien. Se sube también a v3 para que
// el navegador note que este archivo cambió y reemplace cualquier caché
// viejo que haya quedado con contenido de antes de esta corrección.
const CACHE_NOMBRE = 'lotoanalytics-cascaron-v3';
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

  // CORRECCIÓN: antes esto era "caché primero, red de respaldo" — mostraba
  // SIEMPRE la versión guardada al instante (aunque fuera vieja) y solo
  // actualizaba el caché por detrás para la SIGUIENTE visita. Resultado: cada
  // vez que se subía un cambio nuevo al sitio, la primera carga después de
  // eso mostraba igual la versión anterior, y hacía falta recargar una
  // segunda vez (o borrar caché a mano) para verlo. Ahora es al revés: "red
  // primero, caché de respaldo" — con internet, siempre se pide la versión
  // más nueva; el caché solo entra en juego si la red falla (sin señal/sin
  // datos), para que la app abra algo en vez de pantalla en blanco.
  // 'cache: no-store' aquí es lo que faltaba: obliga a que ESTE pedido en
  // particular vaya siempre a la red de verdad, sin que el navegador se
  // conforme con una copia que tuviera guardada por su cuenta. El caché
  // propio del service worker (líneas de arriba/abajo, CACHE_NOMBRE) sigue
  // guardando una copia aparte SOLO para cuando de verdad no haya internet.
  evento.respondWith(
    fetch(evento.request, { cache: 'no-store' })
      .then((respuestaRed) => {
        if (respuestaRed && respuestaRed.status === 200) {
          const copia = respuestaRed.clone();
          caches.open(CACHE_NOMBRE).then((cache) => cache.put(evento.request, copia));
        }
        return respuestaRed;
      })
      .catch(() => caches.match(evento.request))
  );
});
