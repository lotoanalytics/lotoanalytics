/* ============================================================
   SERVICE WORKER — SOLO PARA LOTOANALYTICS LITE
   (la app normal sigue usando su propio service-worker.js, sin cambios)

   Qué hace:
   - La "cáscara" de la app (lite.html, íconos, librerías) se guarda en el
     teléfono. Al abrir la app se intenta la versión nueva por internet, pero
     si el wifi no responde en 3 segundos se muestra la guardada al instante
     y la nueva se baja por detrás para la próxima vez.
     (Antes esperaba a internet sin límite: en un wifi malo, 1-2 minutos
     de pantalla en blanco.)
   - Los RESULTADOS (Supabase) NUNCA se guardan ni se sirven desde aquí:
     siempre van directo a internet, en tiempo real.
   - Anuncios y estadísticas de Google tampoco se tocan.
   ============================================================ */
const VERSION = 'lite-v1';
const CASCARA = ['/lite.html', '/manifest-lite.json', '/icon-192.png', '/icon-512.png'];
const ESPERA_MAX_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Uno por uno: si un archivo falla, los demás se guardan igual.
    await Promise.all(CASCARA.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter(n => n.startsWith('lite-') && n !== VERSION).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

function esResultadoOAnuncio(url){
  return url.hostname.endsWith('supabase.co') ||
         url.hostname.endsWith('supabase.in') ||
         url.hostname.includes('googlesyndication') ||
         url.hostname.includes('googletagmanager') ||
         url.hostname.includes('google-analytics') ||
         url.hostname.includes('doubleclick') ||
         url.hostname.includes('googleadservices') ||
         url.hostname.includes('adtrafficquality');
}

// Internet con límite de tiempo; si tarda, lo guardado. La respuesta de
// internet, cuando llega, se guarda para la próxima vez.
// Una respuesta que vino de una redirección no se puede entregar tal cual a
// una navegación; se copia a una respuesta "limpia".
async function limpiar(resp){
  if(!resp || !resp.redirected) return resp;
  const cuerpo = await resp.blob();
  return new Response(cuerpo, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
}

async function redConLimite(request, claveCache){
  const cache = await caches.open(VERSION);
  const deRed = fetch(request).then(limpiar).then(resp => {
    if(resp && resp.ok) cache.put(claveCache || request, resp.clone()).catch(() => {});
    return resp;
  });
  const guardada = await cache.match(claveCache || request, { ignoreSearch: true });
  if(!guardada) return deRed; // primera vez: no hay otra opción que esperar
  const tiempo = new Promise(res => setTimeout(() => res(null), ESPERA_MAX_MS));
  try{
    const ganador = await Promise.race([deRed.catch(() => null), tiempo]);
    return ganador || guardada;
  }catch(e){
    return guardada;
  }
}

// Librerías de CDN (supabase-js, sortable): lo guardado de una vez, y se
// actualiza por detrás.
async function guardadoPrimero(request){
  const cache = await caches.open(VERSION);
  const guardada = await cache.match(request);
  const deRed = fetch(request).then(resp => {
    if(resp && (resp.ok || resp.type === 'opaque')) cache.put(request, resp.clone()).catch(() => {});
    return resp;
  }).catch(() => null);
  return guardada || (await deRed) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(esResultadoOAnuncio(url)) return; // directo a internet, sin tocar

  if(req.mode === 'navigate'){
    // Abrir la app (/ o /lite.html) usa la cáscara guardada; cualquier otra
    // página (por ejemplo la política de privacidad) va normal por internet.
    if(url.pathname === '/' || url.pathname === '/lite.html' || url.pathname === '/lite'){
      event.respondWith(redConLimite(new Request('/lite.html', { cache: 'no-store' }), '/lite.html'));
    }
    return;
  }
  if(url.origin === self.location.origin){
    event.respondWith(redConLimite(req));
    return;
  }
  if(url.hostname === 'cdn.jsdelivr.net'){
    event.respondWith(guardadoPrimero(req));
  }
});
