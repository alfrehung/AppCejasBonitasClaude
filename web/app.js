/* Visajismo de cejas: cámara en vivo, malla Inicio/Arco/Final, análisis con Claude y pantalla "Dibujar". */
(function () {
  'use strict';
  const V = window.Visaj;
  const $ = function (id) { return document.getElementById(id); };

  const app = $('app'), lienzo = $('lienzo'), ctx = lienzo.getContext('2d');
  const video = document.createElement('video');
  video.muted = true; video.autoplay = true; video.playsInline = true;
  video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
  const trabajo = document.createElement('canvas');
  const tctx = trabajo.getContext('2d', { willReadFrequently: true });

  const est = {
    camara: 'environment', giro: 0, flujo: null,
    detector: null, detectorListo: false, ocupado: false, activo: false,
    ultimo: null, tUltimo: 0, malla: null, dim: [0, 0],
    midiendo: null, datos: null, diseno: null, luz: null, tLuz: 0, tono: null, bloqueoAnalisis: false
  };

  /* ---------- Almacenamiento (puede fallar en modo privado) ---------- */
  function leer(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : v; } catch (e) { return def; } }
  function guardar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
  est.camara = leer('visaj.camara', 'environment');
  est.giro = parseInt(leer('visaj.giro', '0'), 10) || 0;

  /* ---------- Estado visible ---------- */
  function ponerEstado(nivel, texto) {
    $('estado').dataset.nivel = nivel;
    $('estado-texto').textContent = texto;
  }

  /* ---------- Cámara ---------- */
  async function abrirCamara() {
    detenerCamara();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Este navegador no permite usar la cámara aquí. Abre la app con HTTPS (o desde localhost).');
    }
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
    let flujo;
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ video: Object.assign({ facingMode: { exact: est.camara } }, base), audio: false });
    } catch (e) {
      if (e && e.name === 'NotAllowedError') throw e;
      flujo = await navigator.mediaDevices.getUserMedia({ video: Object.assign({ facingMode: { ideal: est.camara } }, base), audio: false });
    }
    est.flujo = flujo;
    video.srcObject = flujo;
    await video.play();
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {}); } catch (e) { /* opcional */ }
  }
  function detenerCamara() {
    if (est.flujo) est.flujo.getTracks().forEach(function (t) { t.stop(); });
    est.flujo = null;
  }
  function mensajeError(e) {
    if (e && e.name === 'NotAllowedError') return 'No hay permiso para usar la cámara. Actívalo en los ajustes del navegador y vuelve a intentar.';
    if (e && e.name === 'NotFoundError') return 'No encuentro una cámara en este dispositivo.';
    if (e && e.name === 'NotReadableError') return 'La cámara está en uso por otra aplicación.';
    return (e && e.message) || 'No pude abrir la cámara.';
  }

  /* ---------- Detector ---------- */
  function iniciarDetector() {
    if (est.detector) return;
    const fm = new window.FaceMesh({ locateFile: function (f) { return 'vendor/face_mesh/' + f; } });
    fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5, selfieMode: false });
    fm.onResults(alResultado);
    est.detector = fm;
    fm.initialize().then(function () {
      est.detectorListo = true;
      ponerEstado('aviso', 'Busco el rostro…');
    }).catch(function () {
      ponerEstado('mal', 'No se pudo cargar el detector');
    });
  }

  /* Filtro One-Euro: quita temblor en reposo y casi no retrasa cuando el rostro se mueve. */
  function alfa(fc, dt) { const tau = 1 / (2 * Math.PI * fc); return 1 / (1 + tau / dt); }
  function suavizar(prev, nuevo, t) {
    if (!prev) return nuevo.map(function (p) { return { x: p.x, y: p.y, z: p.z, dx: 0, dy: 0, t: t }; });
    const dt = Math.max(0.001, (t - prev[0].t) / 1000);
    return nuevo.map(function (p, i) {
      const q = prev[i];
      const vx = (p.x - q.x) / dt, vy = (p.y - q.y) / dt;
      const ad = alfa(1.0, dt);
      const dx = q.dx + (vx - q.dx) * ad, dy = q.dy + (vy - q.dy) * ad;
      const v = Math.hypot(dx, dy);
      const a = alfa(3.0 + 60 * v, dt);
      return { x: q.x + (p.x - q.x) * a, y: q.y + (p.y - q.y) * a, z: q.z + (p.z - q.z) * a, dx: dx, dy: dy, t: t };
    });
  }

  function alResultado(r) {
    const lm = r.multiFaceLandmarks && r.multiFaceLandmarks[0];
    const W = est.dim[0], H = est.dim[1];
    if (!lm || lm.length < 478 || !W) {
      est.ultimo = null; est.malla = null; est.vista = null;
      if (!est.midiendo) ponerEstado('mal', 'No veo el rostro');
      $('btn-analizar').disabled = true;
      return;
    }
    est.tUltimo = performance.now();
    est.ultimo = suavizar(est.ultimo, lm, est.tUltimo);
    est.vista = est.snap;
    est.malla = V.calcularMalla(est.ultimo, W, H, est.diseno);
    const med = V.medir(est.ultimo, W, H, { frenteDespejada: $('chk-despejada').checked });
    est.medActual = med;
    actualizarEstado(med);
    if (est.midiendo) recogerMuestra(med);
  }

  function actualizarEstado(med) {
    const c = med.calidad;
    let nivel = 'ok', txt = 'Rostro listo';
    if (!c.ojos_abiertos) { nivel = 'mal'; txt = 'Ojos cerrados'; }
    else if (c.giro_lateral_grados > 10) { nivel = 'mal'; txt = 'Rostro girado ' + Math.round(c.giro_lateral_grados) + '°'; }
    else if (med.tamano_rostro < 0.3) { nivel = 'mal'; txt = 'Acerca el teléfono'; }
    else if (est.luz !== null && est.luz < 70) { nivel = 'aviso'; txt = 'Poca luz'; }
    if (!est.midiendo) ponerEstado(nivel, txt);
    $('btn-analizar').disabled = est.bloqueoAnalisis || !est.detectorListo;
  }

  /* ---------- Bucle de imagen ---------- */
  function prepararTrabajo() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return false;
    const k = Math.min(1, 960 / Math.max(vw, vh));
    const sw = Math.round(vw * k), sh = Math.round(vh * k);
    const impar = est.giro % 2 === 1;
    const W = impar ? sh : sw, H = impar ? sw : sh;
    if (trabajo.width !== W || trabajo.height !== H) { trabajo.width = W; trabajo.height = H; }
    tctx.save();
    tctx.translate(W / 2, H / 2);
    tctx.rotate(est.giro * Math.PI / 2);
    tctx.drawImage(video, -sw / 2, -sh / 2, sw, sh);
    tctx.restore();
    return true;
  }

  function bucle() {
    if (!est.activo) return;
    if (video.readyState >= 2 && prepararTrabajo()) {
      if (lienzo.width !== trabajo.width || lienzo.height !== trabajo.height) { lienzo.width = trabajo.width; lienzo.height = trabajo.height; }
      const conMalla = est.malla && est.vista && performance.now() - est.tUltimo < 700;
      /* Con malla se muestra el MISMO fotograma que se analizó, así los puntos quedan pegados al rostro. */
      if (conMalla) {
        if (lienzo.width !== est.vista.width || lienzo.height !== est.vista.height) { lienzo.width = est.vista.width; lienzo.height = est.vista.height; }
        ctx.drawImage(est.vista, 0, 0);
        V.dibujarMalla(ctx, est.malla);
      } else ctx.drawImage(trabajo, 0, 0);
      if (est.detectorListo && !est.ocupado) {
        est.ocupado = true;
        est.dim = [trabajo.width, trabajo.height];
        if (!est.snap || est.snap === est.vista) { est.snap = document.createElement('canvas'); }
        est.snap.width = trabajo.width; est.snap.height = trabajo.height;
        est.snap.getContext('2d').drawImage(trabajo, 0, 0);
        est.detector.send({ image: trabajo }).catch(function () {}).then(function () { est.ocupado = false; });
      }
      medirLuz();
    }
    requestAnimationFrame(bucle);
  }

  function medirLuz() {
    const t = performance.now();
    if (t - est.tLuz < 600 || !est.ultimo) return;
    est.tLuz = t;
    const tono = leerTono(est.ultimo, trabajo.width, trabajo.height);
    if (tono) est.luz = tono.lum;
  }

  /* ---------- Tono de piel ---------- */
  function leerTono(lm, W, H) {
    const F = V.marco(lm, W, H);
    const r = Math.max(4, Math.round(F.s * 0.045));
    const ids = [V.LM.frenteCentro].concat(V.LM.mejillaTonoDer, V.LM.mejillaTonoIzq);
    // Un color por parche (promedio sin los extremos de luz y sombra) y luego la mediana entre parches:
    // así un parche tapado por una mano o el cabello no arrastra el resultado.
    const parches = [];
    ids.forEach(function (i) {
      const x = Math.round(lm[i].x * W - r), y = Math.round(lm[i].y * H - r);
      if (x < 0 || y < 0 || x + 2 * r > W || y + 2 * r > H) return;
      const d = tctx.getImageData(x, y, 2 * r, 2 * r).data, px = [];
      for (let k = 0; k < d.length; k += 4) px.push([d[k], d[k + 1], d[k + 2], 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]]);
      if (px.length < 20) return;
      px.sort(function (a, b) { return a[3] - b[3]; });
      const ini = Math.floor(px.length * 0.2), fin = Math.ceil(px.length * 0.8);
      let R = 0, G = 0, B = 0, n = 0;
      for (let k = ini; k < fin; k++) { R += px[k][0]; G += px[k][1]; B += px[k][2]; n++; }
      parches.push([R / n, G / n, B / n]);
    });
    if (parches.length < 3) return null;
    const mediana = function (c) { const a = parches.map(function (p) { return p[c]; }).sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; };
    const rgb = [0, 1, 2].map(function (c) { return Math.round(mediana(c)); });
    const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    // Dispersión: cuánto se aleja el parche más distinto de la mediana (0-255).
    const disp = Math.max.apply(null, parches.map(function (p) { return Math.hypot(p[0] - rgb[0], p[1] - rgb[1], p[2] - rgb[2]); }));
    const hex = '#' + rgb.map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
    return { hex: hex, rgb: rgb, lum: lum, dispersion: disp, parches: parches.length };
  }

  function pintarPincelada(rgb) {
    const c = $('pincelada'), g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const tono = function (f, a) {
      return 'rgba(' + rgb.map(function (v) { return Math.max(0, Math.min(255, Math.round(v * f))); }).join(',') + ',' + a + ')';
    };
    g.lineCap = 'round'; g.lineJoin = 'round';
    // Cuerpo del trazo con el tono exacto, con los extremos redondeados.
    g.fillStyle = tono(1, 1);
    g.beginPath();
    g.moveTo(44, 18); g.bezierCurveTo(200, 10, 440, 24, 600, 16);
    g.quadraticCurveTo(628, 30, 612, 52); g.quadraticCurveTo(626, 72, 596, 80);
    g.bezierCurveTo(430, 90, 220, 72, 48, 82); g.quadraticCurveTo(14, 62, 30, 46); g.quadraticCurveTo(14, 28, 44, 18);
    g.fill();
    // Cerdas: líneas más claras y más oscuras que se compensan.
    let seed = 11; const rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 64; i++) {
      const t = i / 63, y = 16 + t * 66 + (rnd() - 0.5) * 3;
      const borde = Math.abs(t - 0.5) * 2;
      const x0 = 36 + borde * 22 + rnd() * 26, x1 = 604 - borde * 18 - rnd() * 50;
      const f = i % 2 ? 1 + 0.05 + rnd() * 0.05 : 1 - 0.05 - rnd() * 0.05;
      g.strokeStyle = tono(f, 0.38); g.lineWidth = 1.2 + rnd() * 3.2;
      g.beginPath(); g.moveTo(x0, y);
      g.bezierCurveTo(x0 + (x1 - x0) * 0.3, y + (rnd() - 0.5) * 6, x0 + (x1 - x0) * 0.7, y + (rnd() - 0.5) * 6, x1, y + (rnd() - 0.5) * 3);
      g.stroke();
    }
  }

  /* ---------- Análisis ---------- */
  function iniciarMedicion() {
    if (est.midiendo || !est.ultimo) return;
    est.midiendo = { muestras: [], n: 20, t0: performance.now(), ultimaT: 0, ultimoMotivo: null };
    est.bloqueoAnalisis = true;
    $('btn-analizar').disabled = true;
    $('medicion').hidden = false;
    $('barra-relleno').style.width = '0%';
    $('medicion-texto').textContent = 'Mantén el teléfono quieto…';
    ponerEstado('aviso', 'Midiendo…');
  }

  function recogerMuestra(med) {
    const m = est.midiendo, ahora = performance.now();
    const motivo = V.motivoRecaptura(med.calidad, med.tamano_rostro);
    m.ultimoMotivo = motivo;
    if (!motivo && ahora - m.ultimaT > 45) { m.muestras.push(med); m.ultimaT = ahora; }
    $('barra-relleno').style.width = Math.round(100 * m.muestras.length / m.n) + '%';
    $('medicion-texto').textContent = motivo ? motivo : 'Midiendo ' + m.muestras.length + ' de ' + m.n;
    if (m.muestras.length >= m.n) terminarMedicion();
    else if (ahora - m.t0 > 9000) terminarMedicion();
  }

  async function terminarMedicion() {
    const m = est.midiendo; est.midiendo = null;
    $('medicion').hidden = true;
    if (m.muestras.length < 8) {
      est.bloqueoAnalisis = false;
      mostrarRecaptura(m.ultimoMotivo || 'No logré una medida estable: mantén el teléfono quieto y el rostro de frente.');
      return;
    }
    const datos = V.combinar(m.muestras);
    est.datos = datos;
    ponerEstado('aviso', 'Consultando a Claude…');
    $('medicion').hidden = false;
    $('barra-relleno').style.width = '100%';
    $('medicion-texto').textContent = 'Claude está revisando las proporciones…';
    const d = await pedirDiseno(datos);
    $('medicion').hidden = true;
    est.bloqueoAnalisis = false;
    est.diseno = d;
    if (est.ultimo) est.malla = V.calcularMalla(est.ultimo, est.dim[0], est.dim[1], d);
    mostrarDiseno(d);
  }

  async function pedirDiseno(datos) {
    let nota = '';
    try {
      const ctrl = new AbortController();
      const t = setTimeout(function () { ctrl.abort(); }, 25000);
      const cab = { 'Content-Type': 'application/json' };
      const cod = leer('visaj.codigo', '');
      if (cod) cab['X-Acceso'] = cod;
      const r = await fetch('api/diseno', { method: 'POST', headers: cab, body: JSON.stringify(datos), signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        const j = await r.json();
        if (V.disenoValido(j)) { j.origen = 'claude'; return j; }
        nota = 'Claude respondió en un formato inesperado.';
      } else if (r.status === 401) {
        $('acceso').hidden = false; nota = 'Falta el código de acceso.';
      } else if (r.status === 503) {
        nota = 'El servidor no tiene la clave de Claude configurada.';
      } else { nota = 'No pude consultar a Claude (' + r.status + ').'; }
    } catch (e) { nota = 'No hay conexión con Claude.'; }
    const d = V.disenoLocal(datos);
    d.nota_origen = nota;
    return d;
  }

  const NOMBRE_FORMA = { ovalado: 'ovalado', redondo: 'redondo', alargado: 'alargado', cuadrado: 'cuadrado', corazon: 'en corazón', diamante: 'en diamante' };
  function el(tag, cls, texto) { const e = document.createElement(tag); if (cls) e.className = cls; if (texto !== undefined) e.textContent = texto; return e; }

  function mostrarDiseno(d) {
    const caja = $('diseno'); caja.textContent = '';
    if (d.recaptura && d.recaptura.necesaria) {
      mostrarRecaptura(d.recaptura.motivo || 'Claude pide repetir la captura.');
      return;
    }
    const cab = el('div', 'diseno-cab');
    cab.appendChild(el('h2', null, 'Rostro ' + (NOMBRE_FORMA[d.rostro.forma] || d.rostro.forma)));
    const ins = el('span', 'insignia', 'Confianza ' + d.confianza); ins.dataset.v = d.confianza;
    cab.appendChild(ins); caja.appendChild(cab);
    const fichas = el('div', 'fichas');
    [['Arco', d.ceja.arco_altura + ' · ' + d.ceja.arco_definicion], ['Cola', d.ceja.cola]].forEach(function (p) {
      const f = el('span', 'ficha'); f.appendChild(el('b', null, p[0] + ' ')); f.appendChild(document.createTextNode(p[1])); fichas.appendChild(f);
    });
    caja.appendChild(fichas);
    caja.appendChild(el('p', null, 'Ceja: ' + d.ceja.tipo + '.'));
    if (d.explicacion_alumna) caja.appendChild(el('p', null, d.explicacion_alumna));
    if (d.rostro.segunda_opcion) caja.appendChild(el('p', 'origen', 'Segunda opción: rostro ' + (NOMBRE_FORMA[d.rostro.segunda_opcion] || d.rostro.segunda_opcion) + '.'));
    if (d.ajustes_por_proporcion && d.ajustes_por_proporcion.length) {
      const ul = el('ul'); d.ajustes_por_proporcion.forEach(function (a) { ul.appendChild(el('li', null, a)); }); caja.appendChild(ul);
    }
    const origen = d.origen === 'claude' ? 'Diseño de Claude con la skill de visajismo.' : 'Diseño calculado en el teléfono. ' + (d.nota_origen || '');
    caja.appendChild(el('span', 'origen', origen));
    caja.hidden = false;
    $('btn-dibujar').hidden = false;
    $('btn-analizar').textContent = 'Reanalizar';
    $('btn-analizar').className = 'btn btn-secundario';
    ponerEstado('ok', 'Diseño listo');
  }

  function mostrarRecaptura(motivo) {
    const caja = $('diseno'); caja.textContent = '';
    caja.appendChild(el('div', 'aviso-recaptura', motivo));
    caja.hidden = false;
    $('btn-dibujar').hidden = true;
    ponerEstado('mal', 'Repite la captura');
  }

  /* ---------- Pantalla Dibujar ---------- */
  function dibujar() {
    if (!est.ultimo || !est.diseno) return;
    const W = trabajo.width, H = trabajo.height;
    const foto = $('foto'); foto.width = W; foto.height = H;
    const g = foto.getContext('2d');
    g.drawImage(trabajo, 0, 0);
    const tono = leerTono(est.ultimo, W, H);
    V.dibujarMalla(g, V.calcularMalla(est.ultimo, W, H, est.diseno));
    est.tono = tono;
    if (tono) {
      pintarPincelada(tono.rgb);
      $('tono-pie').textContent = tono.hex.toUpperCase() + ' · lectura aproximada con la luz actual' +
        (tono.dispersion > 45 ? '. Lectura poco uniforme: revisa que la luz sea pareja y que nada tape el rostro.' : '');
    } else {
      $('pincelada').getContext('2d').clearRect(0, 0, 640, 96);
      $('tono-pie').textContent = 'No se pudo leer el tono. Repite la captura con más luz.';
    }
    est.activo = false;
    app.dataset.vista = 'dibujo';
  }

  function volver() {
    app.dataset.vista = 'camara';
    est.activo = true; est.ocupado = false;
    requestAnimationFrame(bucle);
  }

  function guardarImagen() {
    const foto = $('foto'), W = foto.width, u = W / 100;
    const out = document.createElement('canvas');
    out.width = W; out.height = Math.round(foto.height + u * 66);
    const g = out.getContext('2d');
    g.fillStyle = '#120d14'; g.fillRect(0, 0, out.width, out.height);
    g.drawImage(foto, 0, 0);
    let y = foto.height + u * 5;
    const etiqueta = function (t) { g.fillStyle = '#b8a9b5'; g.font = '700 ' + u * 2.6 + 'px system-ui, sans-serif'; g.textBaseline = 'top'; g.fillText(t.toUpperCase(), u * 5, y); y += u * 4.4; };
    etiqueta('Tono de piel leído');
    g.drawImage($('pincelada'), u * 5, y, W - u * 10, (W - u * 10) * 96 / 640);
    y += (W - u * 10) * 96 / 640 + u * 1.5;
    if (est.tono) { g.fillStyle = '#b8a9b5'; g.font = u * 2.6 + 'px system-ui, sans-serif'; g.fillText(est.tono.hex.toUpperCase(), u * 5, y); }
    y += u * 5.5;
    [['Fórmula del pigmento', $('campo-formula').textContent], ['Duración de aplicación', $('campo-duracion').textContent]].forEach(function (c) {
      etiqueta(c[0]);
      g.fillStyle = '#1d1620'; g.fillRect(u * 5, y, W - u * 10, u * 7);
      g.fillStyle = '#f6eff4'; g.font = '600 ' + u * 3.2 + 'px system-ui, sans-serif'; g.fillText(c[1], u * 7, y + u * 1.9);
      y += u * 9.6;
    });
    out.toBlob(function (b) {
      if (!b) return;
      const url = URL.createObjectURL(b), a = document.createElement('a');
      const f = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
      a.href = url; a.download = 'visajismo-cejas-' + f.getFullYear() + p(f.getMonth() + 1) + p(f.getDate()) + '-' + p(f.getHours()) + p(f.getMinutes()) + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    }, 'image/png');
  }

  /* ---------- Eventos ---------- */
  $('btn-abrir').addEventListener('click', async function () {
    $('error-inicio').hidden = true;
    try {
      await abrirCamara();
    } catch (e) {
      const er = $('error-inicio'); er.textContent = mensajeError(e); er.hidden = false; return;
    }
    app.dataset.vista = 'camara';
    est.activo = true;
    ponerEstado('aviso', 'Cargando detector…');
    iniciarDetector();
    requestAnimationFrame(bucle);
  });
  $('btn-girar').addEventListener('click', function () {
    est.giro = (est.giro + 1) % 4; guardar('visaj.giro', String(est.giro));
    est.ultimo = null; est.malla = null; est.vista = null;
  });
  $('btn-camara').addEventListener('click', async function () {
    est.camara = est.camara === 'environment' ? 'user' : 'environment'; guardar('visaj.camara', est.camara);
    est.ultimo = null; est.malla = null; est.vista = null;
    try { await abrirCamara(); } catch (e) { ponerEstado('mal', mensajeError(e)); }
  });
  $('btn-analizar').addEventListener('click', iniciarMedicion);
  $('btn-dibujar').addEventListener('click', dibujar);
  $('btn-volver').addEventListener('click', volver);
  $('btn-guardar').addEventListener('click', guardarImagen);
  $('btn-codigo').addEventListener('click', function () {
    guardar('visaj.codigo', $('codigo').value.trim()); $('acceso').hidden = true; $('codigo').value = '';
    ponerEstado('aviso', 'Código guardado. Analiza de nuevo.');
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { est.activo = false; }
    else if (app.dataset.vista === 'camara' && est.flujo) { est.activo = true; requestAnimationFrame(bucle); }
  });

  // Para pruebas automáticas: solo se expone al abrir la app con ?depurar
  if (/[?&]depurar\b/.test(location.search)) window.__visaj = est;
})();
