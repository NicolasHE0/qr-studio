// Textos fijos: el parámetro ?s solo elige entre mensajes conocidos (nunca se inserta en la página).
var M = {
  paused: ['Este código está pausado', 'Su responsable lo desactivó por el momento. Probá de nuevo más tarde o consultale a quien te lo compartió.'],
  not_found: ['No encontramos este código', 'El enlace no existe o fue eliminado. Revisá que el código esté completo o consultale a quien te lo compartió.'],
  destination_invalid: ['No pudimos abrir el destino', 'El destino configurado para este código no es seguro o no es válido, así que no te redirigimos.'],
  rate_limited: ['Demasiados intentos', 'Hiciste muchas solicitudes seguidas. Esperá un minuto y probá de nuevo.'],
  error: ['El servicio no está disponible', 'Tuvimos un problema técnico y no pudimos completar la redirección. Probá de nuevo en unos minutos.']
};
var s = new URLSearchParams(location.search).get('s');
var m = Object.prototype.hasOwnProperty.call(M, s) ? M[s] : ['Aviso', 'Este enlace no se puede abrir en este momento.'];
document.getElementById('t').textContent = m[0];
document.getElementById('b').textContent = m[1];
document.title = m[0] + ' · QR Studio';
