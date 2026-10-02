// Service worker de LotoAnalytics.com
//
// - La página (diseño y código) se guarda en el teléfono. Al abrir la app se
//   pide la versión nueva por internet, pero si no responde en 3 segundos se
//   muestra la guardada de una vez y la nueva se baja por detrás.
// - Los RESULTADOS (Supabase) nunca pasan por aquí: siempre van directo a
//   internet, en tiempo real. Anuncios y estadísticas de Google tampoco.

const CACHE_NOMBRE = 'lotoanalytics-cascaron-v5';
const ARCHIVOS_CASCARON = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon-32.png',
  './apple-touch-icon.png',
  './fondo-loterias.jpg',
];
const ESPERA_MAX_MS = 3000;

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_NOMBRE).then((cache) =>
      Promise.all(ARCHIVOS_CASCARON.map((archivo) =>
        cache.add(new Request(archivo, { cache: 'no-store' })).catch(() => {})
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== CACHE_NOMBRE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function vaDirectoAInternet(url) {
  const host = url.hostname;
  return host.endsWith('supabase.co') ||
         host.endsWith('supabase.in') ||
         host.includes('googlesyndication') ||
         host.includes('googletagmanager') ||
         host.includes('google-analytics') ||
         host.includes('doubleclick') ||
         host.includes('googleadservices') ||
         host.includes('adtrafficquality');
}

// Una respuesta que llegó por redirección no se puede entregar tal cual al
// abrir una página; se copia a una respuesta nueva.
async function limpiar(respuesta) {
  if (!respuesta || !respuesta.redirected) return respuesta;
  const cuerpo = await respuesta.blob();
  return new Response(cuerpo, { status: respuesta.status, statusText: respuesta.statusText, headers: respuesta.headers });
}

// Internet con límite de tiempo: si tarda más de 3 s, se usa lo guardado.
// Lo que llega de internet se guarda para la próxima vez.
async function redConLimite(pedido, clave) {
  const cache = await caches.open(CACHE_NOMBRE);
  const deRed = fetch(pedido).then(limpiar).then((respuesta) => {
    if (respuesta && respuesta.status === 200) cache.put(clave || pedido, respuesta.clone()).catch(() => {});
    return respuesta;
  });
  const guardada = await cache.match(clave || pedido, { ignoreSearch: true });
  if (!guardada) return deRed;
  const tiempo = new Promise((resolver) => setTimeout(() => resolver(null), ESPERA_MAX_MS));
  const ganador = await Promise.race([deRed.catch(() => null), tiempo]);
  return ganador || guardada;
}

// Librerías y fuentes de otros sitios: lo guardado de una vez y se actualiza por detrás.
async function guardadoPrimero(pedido) {
  const cache = await caches.open(CACHE_NOMBRE);
  const guardada = await cache.match(pedido);
  const deRed = fetch(pedido).then((respuesta) => {
    if (respuesta && (respuesta.ok || respuesta.type === 'opaque')) cache.put(pedido, respuesta.clone()).catch(() => {});
    return respuesta;
  }).catch(() => null);
  return guardada || (await deRed) || Response.error();
}

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (vaDirectoAInternet(url)) return;

  if (pedido.mode === 'navigate') {
    if (url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html')) {
      evento.respondWith(redConLimite(new Request('./index.html', { cache: 'no-store' }), './index.html'));
    } else {
      evento.respondWith(
        fetch(pedido).catch(() => caches.match(pedido, { ignoreSearch: true }).then((r) => r || Response.error()))
      );
    }
    return;
  }

  if (url.origin === self.location.origin) {
    evento.respondWith(redConLimite(new Request(pedido, { cache: 'no-store' })));
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    evento.respondWith(guardadoPrimero(pedido));
  }
});

// ---- Avisos de "Mis Alertas" que llegan aunque la app esté cerrada ----
self.addEventListener('push', (evento) => {
  let datos = {};
  try { datos = evento.data ? evento.data.json() : {}; } catch (e) { datos = { title: 'LotoAnalytics', body: evento.data ? evento.data.text() : '' }; }
  evento.waitUntil(self.registration.showNotification(datos.title || '🔔 LotoAnalytics', {
    body: datos.body || '',
    icon: 'apple-touch-icon.png',
    badge: 'favicon-32.png',
    tag: datos.tag || undefined,
    data: { url: './' },
  }));
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  evento.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const v of ventanas) { if ('focus' in v) return v.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow((evento.notification.data && evento.notification.data.url) || './');
  })());
});
