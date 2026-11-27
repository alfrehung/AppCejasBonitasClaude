/*
 * Geometría del mapeo de cejas: Inicio, Arco y Final.
 * Sin dependencias del navegador, para poder probarla en Node.
 *
 * Sistema de coordenadas del rostro (se corrige solo la inclinación de la cabeza):
 *   origen = punto medio entre las comisuras externas de los ojos
 *   unidad = distancia entre esas comisuras (s)
 *   a = a lo largo de la línea de los ojos (negativo = lado derecho de la persona)
 *   b = perpendicular, positivo hacia el mentón
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Visaj = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Puntos de MediaPipe Face Mesh (478 con iris). "der" e "izq" son de la persona, no de la pantalla.
  const LM = {
    ojoDerExt: 33, ojoDerInt: 133, ojoIzqInt: 362, ojoIzqExt: 263,
    irisDer: 468, irisIzq: 473,
    alaDer: 129, alaIzq: 358,
    baseNariz: 94, nasion: 168, frenteSup: 10, menton: 152,
    labioSup: 0, labioInt: 13,
    mejillaDer: 234, mejillaIzq: 454,
    frenteDer: 54, frenteIzq: 284,
    mandDer: 58, mandIzq: 288,
    mentonDer: 176, mentonIzq: 400,
    parpadoSupDer: 159, parpadoInfDer: 145, parpadoSupIzq: 386, parpadoInfIzq: 374,
    cejaInfDer: [46, 53, 52, 65, 55], cejaInfIzq: [276, 283, 282, 295, 285],
    frenteCentro: 151, mejillaTonoDer: [50, 205], mejillaTonoIzq: [280, 425]
  };

  // Proporciones calibradas midiendo el filtro de referencia (36 fotogramas del video).
  // Las alturas se expresan como fracción de D = distancia de la línea de ojos a la base de la nariz,
  // así que se adaptan al largo del tercio medio de cada rostro. Ajustables por la visajista.
  const G = {
    alaDesplazamiento: 0.025, // el ala de la nariz se toma 0.025 s más hacia afuera
    inicioSobreNariz: 0.571,  // a del Inicio = 0.571 × semiancho de la nariz
    alturaInicio: 0.413,
    alturaFinal: 0.533,       // el Final queda más alto que el Inicio, igual que en el filtro
    alturaArco: 0.780,
    subidaArco: { baja: 0.04, media: 0.07, alta: 0.10 },   // cuánto sube el Arco sobre la línea Inicio-Final (unidades de s, ~1 cm = 0.1)
    colaExtra: 0.035,                                      // la recta del Final pasa un poco más allá de la comisura externa
    factorArco: { baja: 0.85, media: 1.0, alta: 1.15 },
    correccionLargo: 1.15     // el punto 10 está en la frente, no en el nacimiento del cabello
  };

  const hyp = Math.hypot;

  function marco(lm, W, H) {
    const p33 = { x: lm[LM.ojoDerExt].x * W, y: lm[LM.ojoDerExt].y * H };
    const p263 = { x: lm[LM.ojoIzqExt].x * W, y: lm[LM.ojoIzqExt].y * H };
    const s = hyp(p263.x - p33.x, p263.y - p33.y);
    const ux = (p263.x - p33.x) / s, uy = (p263.y - p33.y) / s;
    const vx = -uy, vy = ux;
    const mx = (p33.x + p263.x) / 2, my = (p33.y + p263.y) / 2;
    return {
      s: s,
      rolDeg: Math.atan2(uy, ux) * 180 / Math.PI,
      aB: function (i) {
        const dx = lm[i].x * W - mx, dy = lm[i].y * H - my;
        return { a: (dx * ux + dy * uy) / s, b: (dx * vx + dy * vy) / s };
      },
      px: function (a, b) {
        return { x: mx + s * (a * ux + b * vx), y: my + s * (a * uy + b * vy) };
      }
    };
  }

  function puntoEnRecta(p0, p1, b) {
    const t = (b - p0.b) / (p1.b - p0.b);
    return { a: p0.a + t * (p1.a - p0.a), b: b };
  }

  /** Calcula puntos, líneas y etiquetas de la malla, en píxeles de la imagen. */
  const CEJA = {
    der: { baja: [46, 53, 52, 65, 55], alta: [70, 63, 105, 66, 107] },   // de la cola al inicio
    izq: { baja: [276, 283, 282, 295, 285], alta: [300, 293, 334, 296, 336] }
  };
  /** Eje central de la ceja natural: puntos (a,b) de la cola al inicio, ordenados por a. */
  function ejeCeja(F, lado) {
    const c = CEJA[lado];
    const pts = c.baja.map(function (i, k) {
      const p = F.aB(i), q = F.aB(c.alta[k]);
      return { a: (p.a + q.a) / 2, b: (p.b + q.b) / 2 };
    });
    pts.sort(function (x, y) { return x.a - y.a; });
    return pts;
  }
  /** Contorno superior de la ceja natural (puntos a,b de la cola al inicio, ordenados por a). */
  function bordeSuperior(F, lado) {
    const pts = CEJA[lado].alta.map(function (i) { return F.aB(i); });
    pts.sort(function (x, y) { return x.a - y.a; });
    return pts;
  }
  /** Altura b de la ceja natural en la posición a (se prolonga con la pendiente del tramo extremo). */
  function bEnCeja(pts, a) {
    const n = pts.length;
    let i = 0;
    if (a <= pts[0].a) i = 0; else if (a >= pts[n - 1].a) i = n - 2;
    else while (a > pts[i + 1].a) i++;
    const p = pts[i], q = pts[i + 1];
    const dA = q.a - p.a;
    if (Math.abs(dA) < 1e-6) return p.b;
    return p.b + (a - p.a) * (q.b - p.b) / dA;
  }
  /** Cruce de una recta (p0→p1) con el eje de la ceja natural. null si no cruza en rango razonable. */
  function cruceCeja(pts, p0, p1, bMin, bMax) {
    let prev = null;
    for (let b = bMax; b >= bMin; b -= 0.004) {
      const a = puntoEnRecta(p0, p1, b).a;
      const f = bEnCeja(pts, a) - b;
      if (prev !== null && (prev.f > 0) !== (f > 0)) return { a: a, b: b };
      prev = { f: f };
    }
    return null;
  }
  function limitar(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function calcularMalla(lm, W, H, diseno) {
    const F = marco(lm, W, H);
    const altura = (diseno && diseno.ceja && diseno.ceja.arco_altura) || 'media';
    const fArco = G.factorArco[altura] || 1;
    const D = F.aB(LM.baseNariz).b;
    const alaD = F.aB(LM.alaDer), alaI = F.aB(LM.alaIzq);
    const centroNariz = (alaD.a + alaI.a) / 2;
    const semiNariz = Math.abs(alaI.a - alaD.a) / 2;
    const lipB = (F.aB(LM.labioSup).b + F.aB(LM.labioInt).b) / 2;
    const ejeA = (F.aB(LM.frenteSup).a + F.aB(LM.nasion).a + F.aB(LM.baseNariz).a) / 3;
    const L = { a: ejeA, b: lipB };

    const bIni = -G.alturaInicio * D;
    const bFin = -G.alturaFinal * D;
    const bArc = -G.alturaArco * D;
    const cola = diseno && diseno.ceja && diseno.ceja.cola;
    const dCola = cola === 'descendente' ? 0.02 : cola === 'ascendente' ? -0.02 : 0;
    const dArco = altura === 'alta' ? -0.05 : altura === 'baja' ? 0.05 : 0;

    const lados = {};
    const lineas = [];
    const etiquetas = [];
    [['der', -1], ['izq', 1]].forEach(function (par) {
      const lado = par[0], sg = par[1];
      const ala0 = lado === 'der' ? alaD : alaI;
      const ala = { a: ala0.a + sg * G.alaDesplazamiento, b: ala0.b };
      const iris = F.aB(lado === 'der' ? LM.irisDer : LM.irisIzq);
      const esquina = F.aB(lado === 'der' ? LM.ojoDerExt : LM.ojoIzqExt);
      const aIni = centroNariz + sg * G.inicioSobreNariz * semiNariz;
      /* Cada punto se ancla a la ceja NATURAL: cruce de su recta guía con el eje de la ceja. */
      const eje = ejeCeja(F, lado);
      const margen = 0.10 * D;
      /* Línea de Inicio y Final: MISMA altura (regla profesional). Se toma de la ceja natural
         (promedio de cabeza y cola) y se limita a la altura típica del rostro por si la ceja es tenue. */
      const esqFin = { a: esquina.a + sg * G.colaExtra, b: esquina.b };   // la cola llega un poco más allá de la comisura
      const bCabeza = bEnCeja(eje, aIni);
      const cF = cruceCeja(eje, L, esqFin, bIni - 0.2 * D, bIni + 0.2 * D);
      const bCola = cF ? cF.b : bIni;
      const bBase = limitar((bCabeza + bCola) / 2, bIni - margen, bIni + margen);
      const ini = { a: aIni, b: bBase };
      const bF = bBase + dCola;
      const fin = puntoEnRecta(L, esqFin, bF);
      /* Arco = punto alto de la curva natural: donde la recta punto de los labios→CENTRO DE LA PUPILA (iris) cruza el borde
         superior de la ceja. Se limita a una subida razonable sobre la línea Inicio-Final; si la ceja es tenue
         y el cruce sale fuera de rango, se usa la subida típica de la categoría. */
      const sup = bordeSuperior(F, lado);
      const cA = cruceCeja(sup, L, iris, bBase - 0.20, bBase + 0.02);
      const tipica = G.subidaArco[altura] || G.subidaArco.media;
      let subida = cA ? bBase - cA.b : tipica;
      subida = limitar(subida, 0.03, 0.13);
      /* la categoría de Claude mueve el arco como máximo ±0.02 respecto a la lectura natural */
      subida = limitar(subida + (tipica - G.subidaArco.media) * 0.5, 0.03, 0.13);
      const arc = puntoEnRecta(L, iris, bBase - subida);
      lados[lado] = { inicio: F.px(ini.a, ini.b), arco: F.px(arc.a, arc.b), final: F.px(fin.a, fin.b), ab: { inicio: ini, arco: arc, final: fin } };

      /* Rectas rectas desde el punto de los labios (L) hasta pasar el punto: sin quiebre en el ala. */
      const ext = function (p, dist) {
        const dx = p.a - L.a, dy = p.b - L.b, n = Math.hypot(dx, dy);
        return { a: p.a + dx / n * dist, b: p.b + dy / n * dist };
      };
      const arcTop = ext(arc, 0.09), finTop = ext(fin, 0.09), iniTop = { a: ini.a, b: ini.b - 0.09 };
      lineas.push({ pts: [F.px(iniTop.a, iniTop.b), F.px(ini.a, D), F.px(L.a, L.b)] });
      lineas.push({ pts: [F.px(arcTop.a, arcTop.b), F.px(L.a, L.b)] });
      lineas.push({ pts: [F.px(finTop.a, finTop.b), F.px(L.a, L.b)] });

      const p1 = F.px(ini.a, ini.b - 0.14), p2 = F.px(arc.a, arc.b - 0.12), p3 = F.px(fin.a + sg * 0.02, fin.b - 0.12);
      etiquetas.push({ texto: 'Inicio', x: p1.x, y: p1.y }, { texto: 'Arco', x: p2.x, y: p2.y }, { texto: 'Final', x: p3.x, y: p3.y });
    });
    lineas.push({ pts: [lados.der.final, lados.der.inicio, lados.izq.inicio, lados.izq.final] });
    lineas.push({ pts: [F.px(ejeA, -0.52), F.px(L.a, L.b)] });

    return { s: F.s, rolDeg: F.rolDeg, puntos: { der: pick(lados.der), izq: pick(lados.izq) }, lineas: lineas, etiquetas: etiquetas };
  }
  function pick(l) { return { inicio: l.inicio, arco: l.arco, final: l.final }; }

  /** Dibuja la malla (líneas punteadas magenta, puntos celestes) sobre un contexto 2D. */
  function dibujarMalla(ctx, malla, op) {
    const s = malla.s;
    const magenta = (op && op.magenta) || '#f23fc4';
    const celeste = (op && op.celeste) || '#2fe9d3';
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const grosor = Math.max(1.6, s * 0.0065);
    [[grosor + 2.4, 'rgba(10,4,12,.45)'], [grosor, magenta]].forEach(function (c) {
      ctx.lineWidth = c[0]; ctx.strokeStyle = c[1];
      ctx.setLineDash([s * 0.04, s * 0.026]);
      malla.lineas.forEach(function (ln) {
        ctx.beginPath();
        ln.pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
      });
    });
    ctx.setLineDash([]);
    ['der', 'izq'].forEach(function (lado) {
      const P = malla.puntos[lado];
      [['inicio', 0.021], ['arco', 0.016], ['final', 0.016]].forEach(function (k) {
        const p = P[k[0]];
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, s * k[1]), 0, Math.PI * 2);
        ctx.fillStyle = celeste; ctx.fill();
        ctx.lineWidth = Math.max(1, s * 0.004); ctx.strokeStyle = 'rgba(10,4,12,.7)'; ctx.stroke();
      });
    });
    ctx.font = '700 ' + Math.max(11, s * 0.052) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2.5, s * 0.011); ctx.strokeStyle = 'rgba(10,4,12,.8)'; ctx.fillStyle = celeste;
    malla.etiquetas.forEach(function (e) { ctx.strokeText(e.texto, e.x, e.y); ctx.fillText(e.texto, e.x, e.y); });
    ctx.restore();
  }

  const r2 = function (x) { return Math.round(x * 100) / 100; };

  /** Medidas del rostro con el formato que espera la skill visajismo-cejas. */
  function medir(lm, W, H, opciones) {
    const op = opciones || {};
    const P = function (i) { return { x: lm[i].x * W, y: lm[i].y * H }; };
    const d = function (i, j) { const a = P(i), b = P(j); return hyp(a.x - b.x, a.y - b.y); };
    const F = marco(lm, W, H);
    const mej = d(LM.mejillaDer, LM.mejillaIzq);
    const largo = d(LM.frenteSup, LM.menton) * G.correccionLargo;
    const jaw = d(LM.mandDer, LM.mandIzq);
    const mentonR = d(LM.mentonDer, LM.mentonIzq) / jaw;
    const forma_menton = mentonR < 0.34 ? 'puntiagudo' : mentonR > 0.5 ? 'cuadrado' : 'redondeado';
    const anchoOjoDer = d(LM.ojoDerExt, LM.ojoDerInt), anchoOjoIzq = d(LM.ojoIzqExt, LM.ojoIzqInt);
    const anchoOjo = (anchoOjoDer + anchoOjoIzq) / 2;
    const inter = d(LM.ojoDerInt, LM.ojoIzqInt);
    const nariz = d(LM.alaDer, LM.alaIzq);
    const ceja = function (idsCeja, parpado) {
      const bc = idsCeja.reduce(function (t, i) { return t + F.aB(i).b; }, 0) / idsCeja.length;
      return Math.max(0, (F.aB(parpado).b - bc) / (anchoOjo / F.s));
    };
    const earDer = d(LM.parpadoSupDer, LM.parpadoInfDer) / anchoOjoDer;
    const earIzq = d(LM.parpadoSupIzq, LM.parpadoInfIzq) / anchoOjoIzq;
    const dz = (lm[LM.mejillaIzq].z - lm[LM.mejillaDer].z) * W;
    const dx = (lm[LM.mejillaIzq].x - lm[LM.mejillaDer].x) * W;
    const giro = Math.abs(Math.atan2(dz, dx) * 180 / Math.PI);
    return {
      calidad: {
        giro_lateral_grados: Math.round(giro * 10) / 10,
        inclinacion_grados: Math.round(F.rolDeg * 10) / 10,
        ojos_abiertos: Math.min(earDer, earIzq) > 0.15,
        frente_despejada: op.frenteDespejada !== false,
        cejas_visibles: op.frenteDespejada !== false
      },
      medidas: {
        largo_sobre_ancho_pomulos: r2(largo / mej),
        ancho_frente_sobre_pomulos: r2(d(LM.frenteDer, LM.frenteIzq) / mej),
        ancho_mandibula_sobre_pomulos: r2(jaw / mej),
        forma_menton: forma_menton,
        distancia_interocular_sobre_ancho_ojo: r2(inter / anchoOjo),
        ancho_nariz_sobre_interocular: r2(nariz / inter),
        distancia_ceja_ojo_izq: r2(ceja(LM.cejaInfIzq, LM.parpadoSupIzq)),
        distancia_ceja_ojo_der: r2(ceja(LM.cejaInfDer, LM.parpadoSupDer))
      },
      tamano_rostro: mej / Math.min(W, H)
    };
  }

  /** Mediana por campo de varias muestras (la forma del mentón por mayoría). */
  function combinar(muestras) {
    const med = function (arr) { const a = arr.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; };
    const out = { calidad: {}, medidas: {} };
    Object.keys(muestras[0].medidas).forEach(function (k) {
      const v = muestras.map(function (m) { return m.medidas[k]; });
      if (typeof v[0] === 'number') out.medidas[k] = r2(med(v));
      else {
        const cuenta = {}; v.forEach(function (x) { cuenta[x] = (cuenta[x] || 0) + 1; });
        out.medidas[k] = Object.keys(cuenta).sort(function (a, b) { return cuenta[b] - cuenta[a]; })[0];
      }
    });
    out.calidad.giro_lateral_grados = Math.round(med(muestras.map(function (m) { return m.calidad.giro_lateral_grados; })) * 10) / 10;
    out.calidad.inclinacion_grados = Math.round(med(muestras.map(function (m) { return m.calidad.inclinacion_grados; })) * 10) / 10;
    out.calidad.ojos_abiertos = muestras.every(function (m) { return m.calidad.ojos_abiertos; });
    out.calidad.frente_despejada = muestras[0].calidad.frente_despejada;
    out.calidad.cejas_visibles = muestras[0].calidad.cejas_visibles;
    return out;
  }

  /** Motivo por el que conviene repetir la captura, o null si está bien. */
  function motivoRecaptura(c, tamano) {
    if (!c.ojos_abiertos) return 'La clienta tiene los ojos cerrados: pídele que los abra y mire al frente.';
    if (c.giro_lateral_grados > 10) return 'El rostro está girado (' + Math.round(c.giro_lateral_grados) + '°): coloca el teléfono de frente al rostro.';
    if (!c.frente_despejada || !c.cejas_visibles) return 'La frente o las cejas están cubiertas: recoge el cabello y retira el maquillaje de cejas.';
    if (tamano != null && tamano < 0.3) return 'El rostro se ve pequeño: acerca el teléfono.';
    return null;
  }

  const TIPOS = {
    ovalado: { tipo: 'Arco suave, cola que baja gradualmente', arco_altura: 'media', arco_definicion: 'suave', cola: 'descendente' },
    redondo: { tipo: 'Arco alto y definido, cola en diagonal', arco_altura: 'alta', arco_definicion: 'definido', cola: 'descendente' },
    alargado: { tipo: 'Casi recta, arco mínimo', arco_altura: 'baja', arco_definicion: 'suave', cola: 'horizontal' },
    cuadrado: { tipo: 'Arco curvo y redondeado', arco_altura: 'media', arco_definicion: 'suave', cola: 'descendente' },
    corazon: { tipo: 'Arco suave y redondeado, poco marcado', arco_altura: 'media', arco_definicion: 'suave', cola: 'descendente' },
    diamante: { tipo: 'Arco suave con cola larga y fina', arco_altura: 'media', arco_definicion: 'suave', cola: 'descendente' }
  };

  /** Diseño de respaldo cuando no hay conexión con Claude. Misma tabla que la skill. */
  function disenoLocal(datos) {
    const m = datos.medidas, c = datos.calidad;
    const L = m.largo_sobre_ancho_pomulos, Fr = m.ancho_frente_sobre_pomulos, J = m.ancho_mandibula_sobre_pomulos, ch = m.forma_menton;
    let forma, segunda = '', razon;
    if (L >= 1.5) { forma = 'alargado'; razon = 'El largo supera 1.5 veces el ancho de los pómulos.'; }
    else if (Fr <= 0.84 && J <= 0.84) { forma = 'diamante'; razon = 'Los pómulos son claramente más anchos que la frente y la mandíbula.'; }
    else if (Fr - J >= 0.08 && ch !== 'cuadrado') { forma = 'corazon'; razon = 'La frente es más ancha que la mandíbula.'; }
    else if (L < 1.3) {
      if (ch === 'cuadrado' || (Math.abs(Fr - J) < 0.04 && J >= 0.9)) { forma = 'cuadrado'; razon = 'Largo y ancho parecidos, con mandíbula marcada.'; }
      else { forma = 'redondo'; razon = 'Largo y ancho parecidos, con contorno suave.'; }
    } else { forma = 'ovalado'; razon = 'El largo es entre 1.3 y 1.5 veces el ancho, con contorno equilibrado.'; }
    if (forma === 'ovalado' && L < 1.35) segunda = 'redondo';
    else if (forma === 'ovalado' && L > 1.45) segunda = 'alargado';
    const t = TIPOS[forma];
    const ajustes = [];
    if (m.distancia_interocular_sobre_ancho_ojo > 1.2) ajustes.push('Ojos algo separados (' + m.distancia_interocular_sobre_ancho_ojo + ' anchos de ojo): acerca visualmente el Inicio al eje central.');
    else if (m.distancia_interocular_sobre_ancho_ojo < 0.95) ajustes.push('Ojos algo juntos (' + m.distancia_interocular_sobre_ancho_ojo + ' anchos de ojo): separa un poco el Inicio del eje central.');
    if (Math.abs(m.distancia_ceja_ojo_izq - m.distancia_ceja_ojo_der) > 0.08) ajustes.push('Las cejas naturales están a distinta altura (izq ' + m.distancia_ceja_ojo_izq + ', der ' + m.distancia_ceja_ojo_der + '): diseña cada lado por separado.');
    const grave = !c.ojos_abiertos || !c.frente_despejada || !c.cejas_visibles;
    const confianza = grave ? 'baja' : (segunda || c.giro_lateral_grados > 6) ? 'media' : 'alta';
    const nombre = { ovalado: 'ovalado', redondo: 'redondo', alargado: 'alargado', cuadrado: 'cuadrado', corazon: 'en corazón', diamante: 'en diamante' }[forma];
    return {
      confianza: confianza,
      recaptura: { necesaria: false, motivo: '' },
      rostro: { forma: forma, segunda_opcion: segunda, razon: razon },
      ceja: { tipo: t.tipo, arco_altura: t.arco_altura, arco_definicion: t.arco_definicion, cola: t.cola },
      ajustes_por_proporcion: ajustes,
      notas: ['Diseño calculado en el dispositivo, sin Claude.'],
      explicacion_alumna: 'Rostro ' + nombre + '. ' + razon + ' Ceja sugerida: ' + t.tipo.toLowerCase() + '. Marca los tres puntos de cada lado y une Inicio, Arco y Final para trazar el contorno.',
      origen: 'local'
    };
  }

  const FORMAS = ['ovalado', 'redondo', 'alargado', 'cuadrado', 'corazon', 'diamante'];
  function disenoValido(o) {
    try {
      return o && FORMAS.indexOf(o.rostro.forma) >= 0 && ['baja', 'media', 'alta'].indexOf(o.ceja.arco_altura) >= 0 &&
        typeof o.ceja.tipo === 'string' && ['alta', 'media', 'baja'].indexOf(o.confianza) >= 0;
    } catch (e) { return false; }
  }

  return { LM: LM, G: G, marco: marco, calcularMalla: calcularMalla, dibujarMalla: dibujarMalla, medir: medir, combinar: combinar, motivoRecaptura: motivoRecaptura, disenoLocal: disenoLocal, disenoValido: disenoValido, TIPOS: TIPOS };
});
