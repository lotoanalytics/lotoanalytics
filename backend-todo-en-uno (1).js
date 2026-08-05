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

// horaSorteoRD: hora (0-23, horario dominicano) en la que ESTE juego en
// particular saca su sorteo real del día. Se usa en normalizarFecha() para
// decidir si una fecha "de hoy" que trae la fuente es creíble o si en
// realidad todavía es el sorteo de anoche que la fuente no ha refrescado
// (pasa mucho con juegos nocturnos si el robot corre en la mañana). Si un
// juego no tiene hora fija conocida (ej. Súper Kino TV, que sortea varias
// veces al día) se deja sin este campo — sigue protegido por el corte
// genérico de las 7am y por normalizarFechaConVerificacion (comparación de
// números contra el sorteo anterior guardado).
const FUENTES = [
  {
    loteria: 'Lotería Nacional',
    juego: 'Gana Más',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/loteria-nacional/gana-mas/',
    // CORRECCIÓN: tenía 21 (9pm) asumido como "sorteo nocturno", pero Gana Más
    // en realidad sale a las 2:30 PM — el sorteo de las 9pm es Quiniela
    // Nacional, un juego DISTINTO. Mismo error que en Lotería Real: bloqueaba
    // resultados reales ya salidos desde media tarde.
  },
  {
    loteria: 'Lotería Nacional',
    juego: 'Juega + Pega +',
    bolos: 5,
    // 5 números: 2 de tómbola azul, 2 de tómbola roja, 1 de tómbola blanca (1-26 c/u).
    url: CONFIG.fuenteBaseUrl + '/loteria-nacional/juega-mas-pega-mas/',
  },
  {
    loteria: 'Lotería Nacional',
    juego: 'Quiniela Nacional',
    bolos: 3,
    // Ojo: "Quiniela Nacional" (a veces llamada "Nacional Noche") es un sorteo
    // DISTINTO de "Gana Más" -números diferentes cada día- por eso se scrapea
    // aparte, de esta otra página de la misma fuente.
    url: CONFIG.fuenteBaseUrl + '/loteria-nacional/quiniela/',
    // Lunes a sábado sortea a las 9pm — ahí sí necesita la restricción (es el
    // juego donde se detectó el bug original). Domingo sortea más temprano,
    // a las 6pm (antes de las 8pm) — ese día no hace falta restricción, así
    // que se deja sin entrada para el día 0 (cae al genérico 7am, sin bloqueo).
    horaSorteoRD: { 1: 21, 2: 21, 3: 21, 4: 21, 5: 21, 6: 21 },
  },
  {
    loteria: 'Leidsa',
    juego: 'Súper Kino TV',
    bolos: 20,
    url: CONFIG.fuenteBaseUrl + '/leidsa/super-kino-tv/',
    // Un solo sorteo al día, pero la hora cambia según el día: entre semana
    // sale de noche (~9pm), sábado y domingo sale temprano en la tarde (~3pm).
    // Por eso horaSorteoRD es un objeto por día de la semana (0=domingo ...
    // 6=sábado) en vez de un número fijo — normalizarFecha() sabe resolverlo.
    // Entre semana sale de noche (~9pm) — eso sí necesita protección. Fin de
    // semana sale temprano (~3pm), y esos venían funcionando bien sin ningún
    // problema (salen antes de las 8pm), así que no se les pone restricción:
    // sin entrada en el mapa para 0(domingo)/6(sábado), cae al genérico 7am.
    horaSorteoRD: { 1: 21, 2: 21, 3: 21, 4: 21, 5: 21 },
  },
  {
    loteria: 'Loteka',
    juego: 'Quiniela Loteka',
    bolos: 3,
    // Confirmado en la fuente: el slug real es "quiniela-mega-decenas", no
    // "quiniela-loteka" como se podría suponer por el nombre del juego.
    url: CONFIG.fuenteBaseUrl + '/loteka/quiniela-mega-decenas/',
    horaSorteoRD: 20, // sorteo nocturno de Loteka (~7:55 PM, confirmado por fuente pública)
  },
  {
    loteria: 'Lotería Real',
    juego: 'Quiniela',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/loto-real/quiniela/',
    // Sorteo del mediodía (12:55 PM) — sale antes de las 8pm, así que no
    // necesita horaSorteoRD (esos juegos venían funcionando bien sin este
    // chequeo; solo se restringe hora en juegos que sortean 8pm o más tarde).
  },
  {
    loteria: 'Lotería Real',
    juego: 'Tu Fecha Real',
    bolos: 1,
    // Sorteo propio e independiente de la Quiniela: 1 número de una tómbola
    // del 0 al 31. Confirmado en la fuente bajo el slug "quinielita".
    url: CONFIG.fuenteBaseUrl + '/loto-real/quinielita/',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Nueva Yol Real',
    bolos: 3,
    // Sorteo propio: 3 números (00-99) más el color de la manzana.
    url: CONFIG.fuenteBaseUrl + '/loto-real/nueva-yol-real/',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Loto Pool',
    bolos: 4,
    // Sorteo propio: 4 números (00-99), sorteo del mediodía (1:00 PM).
    url: CONFIG.fuenteBaseUrl + '/loto-real/loto-pool/',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Loto Pool Noche',
    bolos: 4,
    // Edición nocturna (~8:30 PM) del Loto Pool Real.
    url: CONFIG.fuenteBaseUrl + '/loto-real/loto-pool-noche',
    horaSorteoRD: 20,
  },
  {
    loteria: 'Lotería Real',
    juego: 'Pega 4 Real',
    bolos: 4,
    // 4 dígitos, cada uno de una tómbola del 0 al 9.
    url: CONFIG.fuenteBaseUrl + '/loto-real/pega-4',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Repartidera Real',
    bolos: 1,
    // Juego diario de 3 cifras, transmitido en vivo a la 1:00 PM (confirmado
    // por fuente pública de horarios) — CORRECCIÓN: no depende de Chance Real
    // de las 8pm como decía antes, sale con el bloque del mediodía.
    url: CONFIG.fuenteBaseUrl + '/loto-real/repartidera-real',
  },
  {
    loteria: 'Lotería Real',
    juego: 'Chance Real',
    bolos: 5,
    // Sorteo propio: 5 números (00-99), sorteo nocturno (8:00 PM).
    url: CONFIG.fuenteBaseUrl + '/loto-real/chance-real',
    horaSorteoRD: 20,
  },
  {
    loteria: 'Lotería Real',
    juego: 'Súper Palé',
    bolos: 2,
    // CORRECCIÓN: había asumido que dependía de Quiniela Nacional (9pm), pero
    // la evidencia real (usuario confirmó el resultado ya publicado a las
    // 5:13pm) indica que depende de Gana Más (2:30pm), que ya no tiene
    // restricción de hora — por eso este tampoco la necesita.
    // Combina el 1er número de Quiniela Real (mediodía) + el 1er número de
    // Lotería Nacional (Gana Más, tarde).
    url: CONFIG.fuenteBaseUrl + '/loto-real/super-pale/',
  },
  {
    loteria: 'La Suerte Dominicana',
    juego: 'La Suerte 12:30',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/la-suerte-dominicana/quiniela/',
  },
  {
    loteria: 'La Suerte Dominicana',
    juego: 'La Suerte 18:00',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/la-suerte-dominicana/quiniela-tarde/',
  },
  {
    loteria: 'LoteDom',
    juego: 'Quiniela LoteDom',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/lotedom/quiniela/',
    // CORRECCIÓN: tenía 21 (9pm) asumido como nocturno, pero LoteDom en
    // realidad sale a media tarde (~1:55-2:55 PM), no de noche.
  },
  {
    loteria: 'King Lottery',
    juego: 'Quiniela Día',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/king-lottery/quiniela-dia/',
  },
  {
    loteria: 'King Lottery',
    juego: 'Quiniela Noche',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/king-lottery/quiniela-noche/',
    horaSorteoRD: 20, // sortea a las 7:30 PM (corregido — tenía 21 por error)
  },
  // Anguila tiene 9 sorteos independientes al día (no es un solo sorteo con
  // varias formas de apostar): cada franja horaria saca sus propios números.
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 8:00 AM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-8-am/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 9:00 AM',
    bolos: 3,
    // Patrón inferido a partir de anguila-8-am y anguila-11-am, confirmados; no
    // se pudo confirmar esta URL exacta de forma directa — revisar si falla.
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-9-am/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 10:00 AM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-manana/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 11:00 AM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-11-am/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 12:00 PM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-12-pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 1:00 PM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-medio-dia/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 2:00 PM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-2-pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 3:00 PM',
    bolos: 3,
    // Patrón inferido a partir de anguila-2-pm y anguila-4pm, confirmados; no se
    // pudo confirmar esta URL exacta de forma directa — revisar si falla.
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-3-pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 4:00 PM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-4pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 5:00 PM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-5pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 6:00 PM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-tarde/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 7:00 PM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-7pm/',
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 8:00 PM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-8pm/',
    horaSorteoRD: 20,
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 9:00 PM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-noche/',
    horaSorteoRD: 21,
  },
  {
    loteria: 'Anguilla Lottery',
    juego: 'Anguila 10:00 PM',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/anguila/anguila-10pm/',
    horaSorteoRD: 22,
  },
  {
    loteria: 'La Primera',
    juego: 'La Primera Día',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/la-primera/quiniela-medio-dia/',
  },
  {
    loteria: 'La Primera',
    juego: 'La Primera Noche',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/la-primera/quiniela-noche/',
    horaSorteoRD: 20, // sortea a las 8:00 PM (corregido — tenía 21 por error)
  },
  {
    loteria: 'La Primera',
    juego: 'Loto 5 (+ Loto5+)',
    bolos: 5,
    url: CONFIG.fuenteBaseUrl + '/la-primera/loto-5/',
    // CORRECCIÓN: confirmado por fuente pública que sale a las 8:00 PM, no
    // 9pm — se me quedó sin corregir cuando ajusté La Primera Noche.
    horaSorteoRD: 20,
  },
  {
    loteria: 'La Primera',
    juego: 'El Quinielón Día',
    bolos: 1,
    // Sorteo propio e independiente: 1 número (00-99), tómbola aparte, 12:00 PM.
    url: CONFIG.fuenteBaseUrl + '/la-primera/el-quinielon-dia',
  },
  {
    loteria: 'La Primera',
    juego: 'El Quinielón Noche',
    bolos: 1,
    // Sorteo propio e independiente: 1 número (00-99), tómbola aparte, 8:00 PM.
    url: CONFIG.fuenteBaseUrl + '/la-primera/el-quinielon-noche',
    horaSorteoRD: 20,
  },
  {
    loteria: 'Leidsa',
    juego: 'Loto Leidsa (+ Más/Súper Más)',
    bolos: 6,
    url: CONFIG.fuenteBaseUrl + '/leidsa/loto-mas/',
    horaSorteoRD: 21, // sorteo nocturno de Leidsa
    diasSorteoRD: [3, 6], // CONFIRMADO: solo miércoles y sábado (no lunes, como tenía antes por error)
  },
  {
    loteria: 'Leidsa',
    juego: 'Loto Pool',
    url: CONFIG.fuenteBaseUrl + '/leidsa/loto-pool/',
    // CONFIRMADO: sale junto con el resto del sorteo nocturno de Leidsa —
    // lunes a sábado 8:55pm, domingo 3:55pm (antes de las 8pm, sin restricción ese día).
    horaSorteoRD: { 1: 21, 2: 21, 3: 21, 4: 21, 5: 21, 6: 21 },
  },
  {
    loteria: 'Leidsa',
    juego: 'Pega 3 Más',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/leidsa/pega-3-mas/',
    // Lunes a sábado 8:55pm; domingo 3:55pm (antes de las 8pm, sin restricción ese día).
    horaSorteoRD: { 1: 21, 2: 21, 3: 21, 4: 21, 5: 21, 6: 21 },
  },
  {
    loteria: 'Leidsa',
    juego: 'Quiniela Leidsa / Palé',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/leidsa/quiniela-pale/',
    // Lunes a sábado 8:55pm; domingo 3:55pm (antes de las 8pm, sin restricción ese día).
    horaSorteoRD: { 1: 21, 2: 21, 3: 21, 4: 21, 5: 21, 6: 21 },
  },
  {
    loteria: 'Leidsa',
    juego: 'Súper Palé',
    bolos: 2,
    // Sorteo propio e independiente: 2 números (00-99) — combina el 1er
    // número de Quiniela Leidsa y el 1er número de Lotería Nacional Noche.
    url: CONFIG.fuenteBaseUrl + '/leidsa/super-pale/',
    horaSorteoRD: { 1: 21, 2: 21, 3: 21, 4: 21, 5: 21, 6: 21 },
  },
  {
    loteria: 'Loteka',
    juego: 'Mega Chances',
    bolos: 5,
    url: CONFIG.fuenteBaseUrl + '/loteka/mega-chances/',
    horaSorteoRD: 20, // sorteo nocturno de Loteka (~7:55 PM)
  },
  {
    loteria: 'Loteka',
    juego: 'Mega Chances Repartidera',
    bolos: 1,
    // Sorteo propio e independiente: 1 número (00-99), los últimos 2 dígitos
    // del quinto número de Mega Chances. Página propia confirmada en la fuente.
    url: CONFIG.fuenteBaseUrl + '/loteka/mega-chances-repartidera/',
    horaSorteoRD: 20, // depende de Mega Chances (~7:55 PM)
  },
  {
    loteria: 'Loteka',
    juego: 'Toca 3',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/loteka/toca-3/',
    horaSorteoRD: 20, // sorteo nocturno de Loteka (~7:55 PM)
  },
  {
    loteria: 'Loteka',
    juego: 'Mega Lotto',
    bolos: 6,
    url: CONFIG.fuenteBaseUrl + '/loteka/megalotto/',
    // CONFIRMADO: sortea lunes y jueves a las 7:55 PM (junto con el resto de
    // Loteka) — antes de las 8pm, así que no necesita horaSorteoRD, solo el
    // chequeo de días.
    diasSorteoRD: [1, 4],
  },
  {
    loteria: 'Lotería Real',
    juego: 'Loto Real',
    bolos: 6,
    url: CONFIG.fuenteBaseUrl + '/loto-real/loto/',
    // CONFIRMADO: sortea martes y viernes a las 12:55 PM — antes de las 8pm,
    // así que no necesita horaSorteoRD, solo el chequeo de días.
    diasSorteoRD: [2, 5],
  },
  {
    loteria: 'LoteDom',
    juego: 'El Quemaito Mayor',
    bolos: 1,
    url: CONFIG.fuenteBaseUrl + '/lotedom/el-quemaito-mayor/',
  },
  {
    loteria: 'LoteDom',
    juego: 'Agarra 4',
    bolos: 4,
    // Sorteo propio e independiente: 4 números (00-99) — los 3 de la Quiniela
    // LoteDom más el de El Quemaito Mayor.
    url: CONFIG.fuenteBaseUrl + '/lotedom/agarra-4',
  },
  {
    loteria: 'LoteDom',
    juego: 'Súper Palé',
    bolos: 2,
    // Combina el 1er número de Quiniela LoteDom + el número de El Quemaito
    // Mayor — ambos salen de media tarde (~2:55 PM), no de noche.
    // No confundir con "Leidsa|Súper Palé", "Lotería Real|Súper Palé" ni
    // "La Primera|Súper Palé".
    url: CONFIG.fuenteBaseUrl + '/lotedom/super-pale',
  },
  // Americanas: las horas de abajo asumen horario de verano de EE.UU. (EDT,
  // UTC-4), que coincide con RD (UTC-4 fijo) — válido aprox. marzo-noviembre.
  // En horario estándar (EST, UTC-5, noviembre-marzo) el sorteo real ocurre
  // UNA HORA MÁS TARDE en RD de lo que dice aquí abajo. Revisar/ajustar estas
  // horas cuando entre el cambio de horario en EE.UU. si se nota el mismo
  // patrón de fecha fantasma reapareciendo solo en esos juegos.
  {
    loteria: 'Lotería New York',
    juego: 'Quiniela New York Tarde',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/americanas/new-york-medio-dia/',
  },
  {
    loteria: 'Lotería New York',
    juego: 'Quiniela New York Noche',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/americanas/new-york-noche/',
    // CORRECCIÓN: el comentario ya decía 10:30 PM, pero el número puesto era
    // 23 (11pm) por error de dedo — no coincidía con su propio comentario.
    horaSorteoRD: 22, // NY Numbers Evening, ~10:30 PM hora del este
  },
  {
    loteria: 'Florida',
    juego: 'Quiniela Florida Día',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/americanas/florida-tarde/',
  },
  {
    loteria: 'Florida',
    juego: 'Quiniela Florida Noche',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/americanas/florida-noche/',
    horaSorteoRD: 22, // Florida Pick Evening, ~9:45/10:00 PM hora del este
  },
  {
    loteria: 'Mega Millions',
    juego: 'Mega Millions',
    bolos: 6,
    url: CONFIG.fuenteBaseUrl + '/americanas/mega-millions/',
    horaSorteoRD: 23, // ~11:00 PM hora del este
    diasSorteoRD: [2, 5], // martes y viernes — NO es diario
  },
  {
    loteria: 'PowerBall',
    juego: 'Powerball',
    bolos: 6,
    url: CONFIG.fuenteBaseUrl + '/americanas/powerball/',
    horaSorteoRD: 23, // ~10:59 PM hora del este
    diasSorteoRD: [1, 3, 6], // lunes, miércoles, sábado — NO es diario
  },
  // King Lottery: Pick 3, Pick 4 y Loto Pool (Día/Noche)
  {
    loteria: 'King Lottery',
    juego: 'Pick 3 Día',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/king-lottery/pick-3-dia/',
  },
  {
    loteria: 'King Lottery',
    juego: 'Pick 3 Noche',
    bolos: 3,
    url: CONFIG.fuenteBaseUrl + '/king-lottery/pick-3-noche/',
    horaSorteoRD: 20, // sortea a las 7:30 PM (corregido — tenía 21 por error)
  },
  {
    loteria: 'King Lottery',
    juego: 'Pick 4 Día',
    bolos: 4,
    url: CONFIG.fuenteBaseUrl + '/king-lottery/pick-4-dia/',
  },
  {
    loteria: 'King Lottery',
    juego: 'Pick 4 Noche',
    bolos: 4,
    url: CONFIG.fuenteBaseUrl + '/king-lottery/pick-4-noche/',
    horaSorteoRD: 20, // sortea a las 7:30 PM (corregido — tenía 21 por error)
  },
  {
    loteria: 'King Lottery',
    juego: 'Loto Pool Día',
    bolos: 4,
    // CORRECCIÓN: la URL real de la fuente es "loto-pool-medio-dia", no
    // "loto-pool-dia" — por eso nunca encontraba números, la página no existía.
    url: CONFIG.fuenteBaseUrl + '/king-lottery/loto-pool-medio-dia',
  },
  {
    loteria: 'King Lottery',
    juego: 'Loto Pool Noche',
    bolos: 4,
    url: CONFIG.fuenteBaseUrl + '/king-lottery/loto-pool-noche/',
    horaSorteoRD: 20, // sortea a las 7:30 PM, después de Pick 3/Pick 4 Noche (corregido — tenía 21 por error)
  },
];

// 2) CLIENTE DE BASE DE DATOS
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseServiceKey);

async function guardarSorteo(sorteo) {
  // Protección extra: si ya había algo guardado para este mismo (loteria,
  // juego, fecha) con MÁS números que lo que se acaba de scrapear ahora, no se
  // sobrescribe — significa que esta lectura agarró la página a medio cargar
  // (peor que lo que ya teníamos), y guardar esto encima sería un retroceso.
  const { data: anteriorCrudo } = await supabase
    .from('sorteos')
    .select('numeros')
    .eq('loteria', sorteo.loteria)
    .eq('juego', sorteo.juego)
    .eq('fecha', sorteo.fecha)
    .maybeSingle();
  const anterior = anteriorCrudo ? { numeros: parsearNumerosGuardados(anteriorCrudo.numeros) } : null;
  if (anterior && anterior.numeros.length > sorteo.numeros.length) {
    console.warn('[robot] Se descarta lectura de ' + sorteo.loteria + ' — ' + sorteo.juego + ' (' + sorteo.fecha + '): trajo ' + sorteo.numeros.length + ' números, pero ya había ' + anterior.numeros.length + ' guardados (no se sobrescribe con algo peor).');
    return { loteria: sorteo.loteria, juego: sorteo.juego, fecha: sorteo.fecha, numeros: anterior.numeros, descartado: true };
  }
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

// Hora actual (0-23) en horario dominicano, mismo cálculo que fechaHoyRD().
// Ningún sorteo dominicano real sale entre medianoche y las 7:00 AM — se usa
// para detectar etiquetas "Hoy" atrasadas de la fuente (ver normalizarFecha).
function horaActualRD() {
  const ahoraUTC = new Date();
  const ahoraRD = new Date(ahoraUTC.getTime() - 4 * 60 * 60 * 1000);
  return ahoraRD.getUTCHours();
}

// Minutos totales del día (0-1439) en horario dominicano — igual que
// horaActualRD() pero con precisión de minuto, para poder ordenar juegos por
// "qué tan reciente le tocó" en vez de solo por la hora entera.
function minutosDelDiaActualRD() {
  const ahoraUTC = new Date();
  const ahoraRD = new Date(ahoraUTC.getTime() - 4 * 60 * 60 * 1000);
  return ahoraRD.getUTCHours() * 60 + ahoraRD.getUTCMinutes();
}

// Día de la semana (0=domingo ... 6=sábado) de una fecha "YYYY-MM-DD", sin
// depender de zona horaria (se arma con año/mes/día locales, no con Date.parse).
function diaSemanaDeFecha(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

// horaSorteoRD en FUENTES puede ser:
//  - un número fijo (mismo horario todos los días, ej. 21 = 9pm), o
//  - un objeto {0: hora, 1: hora, ..., 6: hora} para juegos cuyo horario
//    cambia según el día (ej. Súper Kino TV: entre semana de noche, fin de
//    semana temprano en la tarde).
// Esta función resuelve cualquiera de los dos casos a un número de hora (o
// undefined si no hay dato, y entonces normalizarFecha cae al 7am genérico).
function resolverHoraSorteoRD(horaSorteoRD, fechaISO) {
  if (typeof horaSorteoRD === 'number') return horaSorteoRD;
  if (horaSorteoRD && typeof horaSorteoRD === 'object') {
    const dia = diaSemanaDeFecha(fechaISO);
    if (Object.prototype.hasOwnProperty.call(horaSorteoRD, dia)) return horaSorteoRD[dia];
    return horaSorteoRD.default;
  }
  return undefined;
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

// Para juegos que NO sortean todos los días (Mega Millions: mar/vie; Powerball
// y Loto Leidsa: lun/mié/sáb; etc.) — dado un día de referencia (normalmente
// "hoy"), busca hacia atrás el día más reciente ANTERIOR que sí sea día de
// sorteo válido según diasSorteoRD (array de 0=domingo..6=sábado). Se usa
// cuando "hoy" no le toca sortear a este juego en absoluto: no importa la
// hora, la fuente no puede tener un sorteo nuevo real hoy.
function fechaUltimoDiaSorteo(diasSorteoRD, fechaReferenciaISO) {
  const [y, m, d] = fechaReferenciaISO.split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  for (let i = 0; i < 8; i++) {
    fecha.setDate(fecha.getDate() - 1);
    if (diasSorteoRD.includes(fecha.getDay())) {
      const yy = fecha.getFullYear();
      const mm = String(fecha.getMonth() + 1).padStart(2, '0');
      const dd = String(fecha.getDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    }
  }
  return fechaAyerRD(); // no debería llegar aquí si diasSorteoRD no está vacío
}


// "hoy" ya es un sorteo real de HOY para este juego en particular. Si no se
// pasa (juegos sin horaSorteoRD conocida, ej. Súper Kino TV), se usa 7am como
// antes — un corte genérico que solo protege corridas de madrugada.
//
// El bug real: ese corte fijo de las 7am solo cubre juegos que sortean
// temprano. Juegos NOCTURNOS (Quiniela Nacional, Anguila 9PM/10PM, etc.)
// pueden seguir mostrando el resultado de ANOCHE toda la mañana siguiente —
// si el robot corre a las 8am, ya pasó el corte de las 7am, así que antes se
// aceptaba esa fecha como "hoy" sin más, aunque el sorteo real de hoy para
// ese juego específico ni siquiera había salido todavía (sale de noche). Con
// horaSorteoRD, cada juego usa SU PROPIA hora de corte en vez de una fija
// para todos.
function normalizarFecha(textoFecha, horaSorteoRD, diasSorteoRD) {
  const resultado = normalizarFechaBruta(textoFecha);
  // Se resuelve usando el día de HOY (no el de "resultado"): lo que nos importa
  // es "¿ya le tocó a este juego sortear hoy?", y eso depende del día de la
  // semana de hoy, no del día que trae (posiblemente mal) la fuente.
  const horaResuelta = resolverHoraSorteoRD(horaSorteoRD, fechaHoyRD());
  const horaMinimaRD = (typeof horaResuelta === 'number') ? horaResuelta : 7;
  // Ningún sorteo puede tener fecha futura respecto a "hoy" en RD — si la página
  // fuente calculó mal su fecha (les pasa de noche, cuando su servidor usa UTC
  // en vez de hora RD), se corrige aquí. Antes solo se comparaba contra "mañana"
  // exacto; ahora se corrige CUALQUIER fecha futura (formato YYYY-MM-DD, así que
  // la comparación de strings ya es cronológica), por si el desfase es mayor a 1 día.
  if (resultado > fechaHoyRD()) {
    console.warn(`[robot] Fecha "${textoFecha}" venía marcada en el futuro (${resultado}); corregida a hoy (${fechaHoyRD()}).`);
    return fechaHoyRD();
  }
  if (resultado === fechaHoyRD()) {
    // Juegos que NO sortean todos los días (diasSorteoRD): si hoy no es uno de
    // sus días de sorteo, "hoy" no puede ser un sorteo nuevo real sin importar
    // la hora — la fuente sigue mostrando el último sorteo real (de un día
    // anterior) sin refrescar. Se busca el día de sorteo válido más reciente.
    if (Array.isArray(diasSorteoRD) && diasSorteoRD.length > 0 && !diasSorteoRD.includes(diaSemanaDeFecha(fechaHoyRD()))) {
      const corregida = fechaUltimoDiaSorteo(diasSorteoRD, fechaHoyRD());
      console.warn(`[robot] Fecha "${textoFecha}" marcada como hoy (${resultado}) pero hoy no es día de sorteo para este juego (días válidos: ${diasSorteoRD.join(',')}); se interpreta como el último sorteo real y se guarda como ${corregida}.`);
      return corregida;
    }
    // Si la fuente marca el resultado como "hoy" pero todavía no ha llegado la
    // hora real en que ESTE juego sortea (horaMinimaRD), es casi seguro que la
    // fuente no ha refrescado su página y lo que se está leyendo sigue siendo
    // el sorteo de ANOCHE — el sorteo real de hoy para este juego ni ha
    // empezado. A diferencia de la protección de normalizarFechaConVerificacion
    // (que compara contra el historial ya guardado), esta funciona incluso para
    // un juego que se guarda por primera vez, porque no depende de tener una
    // fila de "ayer" contra la cual comparar.
    if (horaActualRD() < horaMinimaRD) {
      console.warn(`[robot] Fecha "${textoFecha}" marcada como hoy (${resultado}) pero son las ${horaActualRD()}:xx RD (este juego sortea a partir de las ${horaMinimaRD}:00, todavía no ha salido el sorteo real de hoy); se interpreta como el sorteo de anoche y se guarda como ${fechaAyerRD()}.`);
      return fechaAyerRD();
    }
  }
  return resultado;
}

// Si el robot corre después de medianoche RD (por reintentos o por demoras de
// GitHub Actions — ver aviso anterior sobre esto), o si la fuente simplemente
// tarda en actualizar su sorteo del día (pasa con juegos que salen tarde en la
// noche), la página a veces TODAVÍA muestra el resultado anterior pero con la
// etiqueta "Hoy" pegada (que ellos mismos no han refrescado). Nuestro código
// antes confiaba ciegamente en esa etiqueta y guardaba el sorteo viejo con la
// fecha de HOY — números correctos, fecha equivocada.
//
// La primera versión de esta función solo comparaba contra el sorteo de "ayer"
// (día calendario). Eso no alcanzaba para juegos donde el error viene pasando
// desde antes de esta protección: si la ÚNICA fila que existe para ese juego ya
// estaba mal fechada como "hoy" (nunca se guardó una fila correcta en "ayer"),
// borrarla a mano no servía de nada — en la siguiente corrida, al no encontrar
// nada guardado en "ayer" para comparar, el robot volvía a crear la misma fila
// fantasma fechada "hoy".
//
// Esta versión corrige eso: compara siempre contra el ÚLTIMO sorteo YA
// GUARDADO para este juego, sea cual sea su fecha (no solo "ayer"), a
// cualquier hora del día (no solo de madrugada). Si los números son idénticos
// y esa fila es más vieja que la fecha que se iba a usar, es casi seguro que
// es el mismo sorteo repetido con una fecha nueva pegada por error — se
// mantiene la fecha de esa fila existente, y si ya había quedado una fila
// fantasma duplicada de antes, se borra.
// Compara dos listas de números por CONTENIDO (mismos números, sin importar el
// orden), no por texto exacto. JSON.stringify(a)===JSON.stringify(b) fallaba
// en juegos con muchos números (ej. Súper Kino TV, 20 números): si el orden en
// que la fuente los muestra varía apenas un poco entre una corrida y otra, o si
// algún número quedó guardado como texto ("07") en vez de número (7), la
// comparación de texto fallaba aunque el sorteo fuera exactamente el mismo —
// por eso el duplicado seguía apareciendo justo en los juegos con más números.
// FALLO RAÍZ ENCONTRADO: la columna "numeros" en Supabase está guardada
// como TEXTO (no como array nativo de Postgres) — cuando el robot vuelve a
// leerla, en JavaScript llega como el string "[21,89,0,54]", NO como el
// array real [21,89,0,54]. Todas las comparaciones de este archivo que
// esperan Array.isArray(...) fallaban silenciosamente por esto — el robot
// pensaba que TODO lo guardado estaba "incompleto (0 números)" sin importar
// el juego, lo volvía a scrapear siempre, y eso es lo que producía el
// patrón de "se borra, y al correr de nuevo el robot lo vuelve a duplicar".
// Esta función convierte lo que venga (string, array ya bueno, o null) a un
// array real de números, sin importar en qué formato haya llegado.
function parsearNumerosGuardados(valor) {
  if (Array.isArray(valor)) return valor.map(Number);
  if (typeof valor === 'string') {
    try {
      const parseado = JSON.parse(valor);
      if (Array.isArray(parseado)) return parseado.map(Number);
    } catch (e) {
      // no era JSON válido, se intenta como lista separada por comas
      return valor.replace(/[\[\]]/g, '').split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n));
    }
  }
  return [];
}

function mismosNumeros(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const ordenadaA = [...a].map(Number).sort((x, y) => x - y);
  const ordenadaB = [...b].map(Number).sort((x, y) => x - y);
  return ordenadaA.every((valor, i) => valor === ordenadaB[i]);
}

async function normalizarFechaConVerificacion(textoFecha, loteria, juego, numeros, horaSorteoRD, diasSorteoRD) {
  const fechaCalculada = normalizarFecha(textoFecha, horaSorteoRD, diasSorteoRD);
  let fecha = fechaCalculada;

  // OJO — HISTORIAL IMPORTANTE: esta protección existió, se quitó por
  // completo, y ahora vuelve pero más selectiva. La versión vieja comparaba
  // CUALQUIER juego contra el sorteo del día anterior, y si los números
  // coincidían exactamente, lo trataba como fantasma y borraba la fila de
  // hoy. Eso causaba falsos positivos reales en juegos de pocos números (El
  // Quinielón: 1 número del 00-99, Súper Palé: 2 números) — ahí SÍ es
  // matemáticamente posible que el mismo número salga dos días seguidos por
  // pura casualidad, y la protección borraba un resultado real pensando que
  // era un error.
  //
  // La versión de ahora solo actúa en juegos de 4 números o más (Loto
  // Leidsa, Mega Millions, Powerball, Chance Real, Súper Kino, etc.) —
  // ahí repetir la combinación COMPLETA exacta de un día para otro es
  // virtualmente imposible por azar, así que si pasa, sí es casi seguro un
  // fantasma (la fuente sin refrescar), no una coincidencia real.
  const UMBRAL_MINIMO_PARA_SOSPECHAR = 4;
  if (numeros.length >= UMBRAL_MINIMO_PARA_SOSPECHAR) {
    try {
      const { data: anterior } = await supabase
        .from('sorteos')
        .select('fecha, numeros')
        .eq('loteria', loteria)
        .eq('juego', juego)
        .lt('fecha', fechaCalculada)
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (anterior && mismosNumeros(parsearNumerosGuardados(anterior.numeros), numeros)) {
        console.warn(`[robot] ${loteria} — ${juego}: números idénticos al sorteo anterior guardado (${anterior.fecha}), y son ${numeros.length} números (muy poco probable por azar) — se interpreta como fantasma, se mantiene ${anterior.fecha} en vez de ${fechaCalculada}.`);
        fecha = anterior.fecha;
        try {
          await supabase.from('sorteos').delete()
            .eq('loteria', loteria).eq('juego', juego).eq('fecha', fechaCalculada);
        } catch (eBorrado) {
          console.warn(`[robot] No se pudo borrar la fila fantasma (${fechaCalculada}) de ${loteria} — ${juego}: ${eBorrado.message}`);
        }
      }
    } catch (e) {
      console.warn(`[robot] No se pudo verificar el sorteo anterior guardado para ${loteria} — ${juego}: ${e.message}`);
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
    // Optimización de velocidad: no necesitamos que carguen imágenes, fuentes,
    // hojas de estilo ni videos para leer los números — solo el HTML y el
    // JavaScript que los pinta. Bloquear esto recorta bastante el tiempo de
    // carga de cada página sin afectar en nada la extracción de datos.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const tipo = req.resourceType();
      if (tipo === 'image' || tipo === 'stylesheet' || tipo === 'font' || tipo === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });
    // 'domcontentloaded' en vez de 'networkidle2': algunos sitios (por anuncios,
    // trackers, etc.) nunca se "quedan quietos" de tráfico de red, así que
    // esperar a que la red esté en silencio puede colgarse sin necesidad.
    // Con domcontentloaded solo esperamos a que el HTML base cargue, y luego
    // le damos un margen fijo para que el JavaScript del sitio termine de
    // pintar los números (se acortó de 4s a 2.5s: con imágenes/CSS bloqueados
    // el JS de la página también corre más rápido).
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(function (r) { setTimeout(r, 2500); });
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

// ---- OPTIMIZACIÓN: saltar juegos que ya tienen su resultado vigente ----
// Puppeteer (abrir la página, esperar que cargue, leer el HTML) es la parte
// LENTA de cada juego — la consulta a Supabase es casi instantánea en
// comparación. Antes, cada corrida completa scrapeaba los ~90 juegos sin
// importar si ya tenían guardado el resultado correcto de "ahora mismo"
// (ej. a las 8:05am, Anguila 9AM/10AM/etc. ni siquiera han salido todavía, y
// Anguila 8AM de hoy puede que ya se haya guardado en una corrida anterior de
// hace 2 minutos) — eso hacía cada corrida mucho más lenta de lo necesario.
//
// fechaEsperadaAhoraMismo() reutiliza EXACTAMENTE la misma lógica de
// normalizarFecha (horaSorteoRD/diasSorteoRD) que ya decide si "hoy" es
// creíble para cada juego — así que calculamos, sin necesidad de tocar la
// página fuente, cuál es la fecha que el robot aceptaría como válida en este
// preciso momento para ese juego. Si Supabase YA tiene guardada una fila con
// exactamente esa fecha, no hay ninguna razón para perder tiempo abriendo la
// página con Puppeteer — ya no puede haber nada nuevo hasta que cambie esa
// fecha esperada (o hasta que llegue la próxima hora de sorteo).
function fechaEsperadaAhoraMismo(fuente) {
  return normalizarFecha('hoy', fuente.horaSorteoRD, fuente.diasSorteoRD);
}

async function yaTieneResultadoVigente(fuente) {
  const fechaEsperada = fechaEsperadaAhoraMismo(fuente);
  try {
    const { data } = await supabase
      .from('sorteos')
      .select('fecha, numeros')
      .eq('loteria', fuente.loteria)
      .eq('juego', fuente.juego)
      .eq('fecha', fechaEsperada)
      .maybeSingle();
    if (!data) return false;
    // Si sabemos cuántos números debe traer este juego (fuente.bolos), no basta
    // con que exista la fila — tiene que estar COMPLETA. El robot puede agarrar
    // la página a mitad de actualizarse (ej. Puppeteer lee justo cuando solo 2
    // de 3 bolas ya aparecieron en pantalla) y guardar un resultado incompleto;
    // antes eso se autocorregía porque siempre se volvía a scrapear todo, pero
    // con este atajo de velocidad, si no se valida, se queda incompleto para
    // siempre. Si el juego no tiene "bolos" confirmado, no nos arriesgamos:
    // NUNCA se salta (misma seguridad que antes de este atajo).
    if (typeof fuente.bolos !== 'number') return false;
    const cantidadGuardada = parsearNumerosGuardados(data.numeros).length;
    if (cantidadGuardada < fuente.bolos) {
      console.warn('[robot] ' + fuente.loteria + ' — ' + fuente.juego + ' (' + fechaEsperada + ') está guardado incompleto (' + cantidadGuardada + '/' + fuente.bolos + ' números) — se vuelve a scrapear.');
      return false;
    }
    return true;
  } catch (e) {
    // Si falla la consulta (ej. problema de red puntual), NO nos arriesgamos
    // a saltarnos el juego a ciegas — mejor perder el tiempo de scrapearlo de
    // más que arriesgarnos a dejarlo sin actualizar.
    console.warn('[robot] No se pudo verificar si ' + fuente.loteria + ' — ' + fuente.juego + ' ya está al día (' + e.message + '); se scrapea igual por seguridad.');
    return false;
  }
}

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
    fecha: await normalizarFechaConVerificacion(textoFecha, fuente.loteria, fuente.juego, numeros, fuente.horaSorteoRD, fuente.diasSorteoRD),
    numeros: numeros,
    hora_publicacion: new Date().toISOString(),
  };
}

// ---- Reintento dentro de la MISMA corrida ----
// Caso real que motivó esto: La Suerte 12:30 sale a las 12:30, pero la
// fuente puede tardar unos minutos en publicarla en su página — si el robot
// pasa justo en ese hueco (12:31, digamos), antes se rendía ahí mismo y
// había que esperar a la PRÓXIMA corrida completa para agarrarla (a veces
// hasta la 1:00pm). Ahora, si un juego "recién le tocó" (le tocaba sortear
// hace poco) y no se encuentra nada, se espera un rato y se reintenta un par
// de veces DENTRO de esta misma corrida, antes de rendirse — así una sola
// corrida ya cubre el margen normal de demora de la fuente en publicar.
async function extraerConReintentos(browser, fuente) {
  const INTENTOS_MAXIMOS = 3;
  const ESPERA_ENTRE_INTENTOS_MS = 45 * 1000;
  for (let intento = 1; intento <= INTENTOS_MAXIMOS; intento++) {
    const resultado = await extraerUnaFuenteConPuppeteer(browser, fuente);
    if (resultado) return resultado;
    if (intento < INTENTOS_MAXIMOS) {
      console.warn('[scraper] ' + fuente.loteria + ' — ' + fuente.juego + ': todavía no está publicado (intento ' + intento + '/' + INTENTOS_MAXIMOS + '), esperando ' + (ESPERA_ENTRE_INTENTOS_MS / 1000) + 's antes de reintentar...');
      await new Promise((r) => setTimeout(r, ESPERA_ENTRE_INTENTOS_MS));
    }
  }
  console.warn('[scraper] ' + fuente.loteria + ' — ' + fuente.juego + ': se agotaron los ' + INTENTOS_MAXIMOS + ' intentos en esta corrida, se deja para la próxima.');
  return null;
}

// ---- Prioridad: revisar primero los juegos que "acaban de tocarle" ----
// Antes el robot recorría FUENTES siempre en el mismo orden fijo (Lotería
// Nacional, Leidsa, Loteka...). Si a las 7:31pm le tocaba a un juego que
// está más abajo en la lista, el robot podía tardar minutos en llegar a él
// mientras revisaba de primero otros juegos que ni siquiera tenían nada
// nuevo — y otra página podía publicar ese resultado primero. Ahora, antes
// de empezar, se ordenan los juegos por "hace cuántos minutos le tocó
// sortear" (el que le tocó hace menos tiempo va primero); los que todavía
// no les toca, o que no tienen hora conocida, se quedan al final porque no
// hay apuro con ellos en este momento.
function prioridadFuente(fuente) {
  const horaResuelta = resolverHoraSorteoRD(fuente.horaSorteoRD, fechaHoyRD());
  if (typeof horaResuelta !== 'number') return 999999; // sin hora conocida: sin apuro, al final
  const minutosDesdeQueLeTocó = minutosDelDiaActualRD() - (horaResuelta * 60);
  if (minutosDesdeQueLeTocó < 0) return 999999 + minutosDesdeQueLeTocó * -1; // todavía no le toca: al final también
  return minutosDesdeQueLeTocó; // ya le tocó: mientras más chico (más reciente), más urgente
}

function ordenarPorUrgencia(fuentes) {
  return [...fuentes].sort((a, b) => prioridadFuente(a) - prioridadFuente(b));
}

async function ejecutarScrapingYGuardar() {
  console.log('[robot] Iniciando recolección de sorteos...');
  const resultados = { guardados: [], errores: [] };
  const fuentesOrdenadas = ordenarPorUrgencia(FUENTES);

  // ---- Chequeo primero, navegador después ----
  // ANTES: se abría el navegador (Puppeteer/Chrome) SIEMPRE, al principio de
  // cada corrida, sin importar si al final había algo que scrapear o no. Abrir
  // el navegador es la parte más pesada y lenta de todo el proceso — hacerlo
  // aunque no haga falta era gastar minutos de GitHub Actions por nada.
  //
  // AHORA: primero se revisa contra Supabase (barato y rápido, sin
  // Puppeteer) cuáles de los ~90 juegos de verdad necesitan scrapearse en
  // este momento. Si no hay ninguno, la corrida termina en segundos SIN
  // haber abierto el navegador — casi gratis en minutos de Actions. Esto es
  // lo que permite correr el robot cada 5 minutos sin miedo: la enorme
  // mayoría de esas corridas van a estar vacías y van a costar casi nada;
  // solo las corridas donde de verdad salió algo nuevo van a tardar y a
  // gastar minutos de verdad.
  const porScrapear = [];
  for (const fuente of fuentesOrdenadas) {
    try {
      if (await yaTieneResultadoVigente(fuente)) {
        console.log('[robot] Ya al día, se salta: ' + fuente.loteria + ' — ' + fuente.juego + ' (fecha vigente: ' + fechaEsperadaAhoraMismo(fuente) + ')');
        continue;
      }
      porScrapear.push(fuente);
    } catch (err) {
      resultados.errores.push({ fuente: fuente.loteria + ' — ' + fuente.juego, error: err.message });
      console.error('[scraper] Error verificando ' + fuente.loteria + ' — ' + fuente.juego + ':', err.message);
    }
  }

  console.log('[robot] ' + porScrapear.length + ' juego(s) por scrapear de verdad.');

  if (porScrapear.length === 0) {
    console.log('[robot] Nada que scrapear ahora mismo — no hace falta abrir el navegador. Corrida casi gratis.');
    console.log('[robot] Proceso finalizado. Guardados: 0, Errores: ' + resultados.errores.length);
    return resultados;
  }

  // Se bajó de 4 a 2 en paralelo: con 4 al mismo tiempo, la fuente
  // (loteriasdominicanas.com) parece bloquear o atrasar algunas peticiones
  // cuando le llegan varias de golpe, y esos juegos se quedaban sin
  // números (ej. Anguila 9PM vacío). Con 2 a la vez, más un pequeño
  // desfase entre ellas, es más lento que 4 pero mucho más confiable — no
  // vale la pena ganar velocidad si el costo es perder resultados.
  const TAMANO_TANDA = 2;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (let i = 0; i < porScrapear.length; i += TAMANO_TANDA) {
      const tanda = porScrapear.slice(i, i + TAMANO_TANDA);
      await Promise.all(tanda.map(async (fuente, indiceEnTanda) => {
        // Pequeño desfase (0, 800ms, 1600ms...) entre cada una de la misma
        // tanda, para que no le lleguen las peticiones exactamente al mismo
        // milisegundo a la fuente — reduce el riesgo de que las bloqueen por
        // parecer una ráfaga automatizada.
        await new Promise((r) => setTimeout(r, indiceEnTanda * 800));
        try {
          const sorteo = await extraerConReintentos(browser, fuente);
          if (sorteo) {
            const guardado = await guardarSorteo(sorteo);
            resultados.guardados.push(guardado);
            console.log('[scraper] ¡ÉXITO! Guardado: ' + sorteo.loteria + ' — ' + sorteo.juego + ' (' + sorteo.fecha + ') -> [' + sorteo.numeros.join(', ') + ']');
          }
        } catch (err) {
          resultados.errores.push({ fuente: fuente.loteria + ' — ' + fuente.juego, error: err.message });
          console.error('[scraper] Error en ' + fuente.loteria + ' — ' + fuente.juego + ':', err.message);
        }
      }));
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
