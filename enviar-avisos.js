// Envía los avisos de "Mis Alertas" a los teléfonos, aunque la app esté cerrada.
//
// Corre como un paso APARTE del robot (ver robot.yml), después de que el robot
// termina. No toca el robot ni la tabla "sorteos": solo LEE los sorteos de hoy
// y la tabla "alertas_push", y manda las notificaciones.
// Si algo falla aquí, el robot no se entera: este archivo siempre termina sin error.

const ZONA = 'America/Santo_Domingo';
const POSICIONES = ['1ra', '2da', '3ra', '4ta', '5ta', '6ta', '7ma', '8va'];

function fechaHoyRD(ahora = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ahora);
  const v = t => p.find(x => x.type === t).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

function normalizarNumeros(valor) {
  if (Array.isArray(valor)) return valor.map(Number).filter(n => !isNaN(n));
  if (typeof valor === 'string') {
    try { const a = JSON.parse(valor); if (Array.isArray(a)) return a.map(Number).filter(n => !isNaN(n)); } catch (e) {}
    return valor.replace(/[[\]]/g, '').split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
  }
  return [];
}

function horaRD(iso) {
  return new Date(iso || Date.now()).toLocaleTimeString('es-DO', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' });
}

// Decide qué avisar para UNA alerta y UN sorteo. Devuelve null si no hay nada nuevo.
function calcularAviso(alerta, sorteo, hoy, ahora = Date.now()) {
  if (sorteo.fecha !== hoy) return null;
  if (alerta.loteria !== sorteo.loteria || alerta.juego !== sorteo.juego) return null;
  const numeros = normalizarNumeros(sorteo.numeros);
  if (numeros.length === 0) return null;
  const publicado = sorteo.hora_publicacion ? new Date(sorteo.hora_publicacion).getTime() : ahora;
  const completo = !alerta.esperados || numeros.length >= alerta.esperados || (ahora - publicado) > 20 * 60 * 1000;
  if (!completo) return null; // todavía están saliendo los números
  if (alerta.creado && sorteo.hora_publicacion && publicado < new Date(alerta.creado).getTime()) return null;

  const vigilados = normalizarNumeros(alerta.numeros);
  const posicion = alerta.posicion === 'cualquiera' ? 'cualquiera' : parseInt(alerta.posicion, 10);
  const aciertos = [];
  numeros.forEach((n, i) => {
    if (vigilados.includes(n) && (posicion === 'cualquiera' || posicion === i)) aciertos.push({ n, pos: i });
  });
  if (aciertos.length === 0) return null;

  const ya = ((alerta.avisados || {})[hoy]) || [];
  const nuevos = aciertos.filter(x => !ya.includes(x.n + '@' + x.pos));
  if (nuevos.length === 0) return null;

  const partes = nuevos.map(x => {
    const num = String(x.n).padStart(2, '0');
    return alerta.con_posicion ? `${num} en ${POSICIONES[x.pos] || (x.pos + 1) + 'a'}` : num;
  });
  const lista = partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1] : partes[0];
  const unicos = new Set(aciertos.map(x => x.n)).size;
  let titulo;
  if (vigilados.length > 1) {
    titulo = unicos >= vigilados.length ? '🔔 ¡Pegaste todos tus números!' : `🔔 ¡Pegaste ${unicos} de tus ${vigilados.length} números!`;
  } else {
    titulo = '🔔 ¡Tu número salió!';
  }
  return {
    payload: {
      title: titulo,
      body: `${lista} · ${sorteo.juego} (${sorteo.loteria}) · ${horaRD(sorteo.hora_publicacion)}`,
      tag: `alerta-${alerta.id}-${hoy}`,
    },
    avisadosHoy: ya.concat(nuevos.map(x => x.n + '@' + x.pos)),
  };
}

async function leerTodo(consulta) {
  const filas = [];
  for (let desde = 0; desde < 100000; desde += 1000) {
    const { data, error } = await consulta().range(desde, desde + 999);
    if (error) throw error;
    filas.push(...data);
    if (data.length < 1000) break;
  }
  return filas;
}

async function principal({ supabase, webpush, ahora = new Date() } = {}) {
  const url = process.env.SUPABASE_URL, clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublica = process.env.VAPID_PUBLIC_KEY, vapidPrivada = process.env.VAPID_PRIVATE_KEY;
  if (!supabase) {
    if (!url || !clave) { console.log('[avisos] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. No se envía nada.'); return; }
    supabase = require('@supabase/supabase-js').createClient(url, clave, { auth: { persistSession: false } });
  }
  if (!webpush) {
    if (!vapidPublica || !vapidPrivada) { console.log('[avisos] Faltan las llaves VAPID. No se envía nada.'); return; }
    webpush = require('web-push');
    webpush.setVapidDetails('mailto:avisos@lotoanalytics.app', vapidPublica, vapidPrivada);
  }

  const hoy = fechaHoyRD(ahora);
  const alertas = await leerTodo(() => supabase.from('alertas_push').select('*'));
  if (alertas.length === 0) { console.log('[avisos] No hay alertas registradas.'); return; }
  const sorteos = await leerTodo(() => supabase.from('sorteos').select('loteria,juego,fecha,numeros,hora_publicacion').eq('fecha', hoy));
  console.log(`[avisos] ${alertas.length} alertas, ${sorteos.length} sorteos de hoy (${hoy}).`);

  const vencidos = new Set();
  let enviados = 0;
  for (const alerta of alertas) {
    if (vencidos.has(alerta.endpoint)) continue;
    let avisadosHoy = null;
    for (const sorteo of sorteos) {
      const aviso = calcularAviso(alerta, sorteo, hoy, ahora.getTime());
      if (!aviso) continue;
      try {
        await webpush.sendNotification(
          { endpoint: alerta.endpoint, keys: { p256dh: alerta.p256dh, auth: alerta.auth } },
          JSON.stringify(aviso.payload),
          { TTL: 6 * 60 * 60, urgency: 'high' }
        );
        enviados++;
        avisadosHoy = aviso.avisadosHoy;
        alerta.avisados = { [hoy]: avisadosHoy };
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          vencidos.add(alerta.endpoint); // el teléfono ya no existe o desinstaló la app
          break;
        }
        console.log('[avisos] No se pudo enviar a una alerta:', e && (e.statusCode || e.message));
      }
    }
    if (avisadosHoy) {
      const { error } = await supabase.from('alertas_push').update({ avisados: { [hoy]: avisadosHoy } }).eq('id', alerta.id);
      if (error) console.log('[avisos] No se pudo marcar como avisada:', error.message);
    }
  }
  for (const endpoint of vencidos) {
    await supabase.from('alertas_push').delete().eq('endpoint', endpoint);
  }
  console.log(`[avisos] Enviados: ${enviados}. Suscripciones vencidas borradas: ${vencidos.size}.`);
}

module.exports = { calcularAviso, fechaHoyRD, normalizarNumeros, principal };

if (require.main === module) {
  principal()
    .catch(e => console.log('[avisos] Error (el robot no se ve afectado):', e && e.message))
    .finally(() => process.exit(0));
}
