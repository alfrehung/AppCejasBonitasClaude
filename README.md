# Visajismo de cejas

App web que abre la cámara, pega al rostro la malla de **Inicio, Arco y Final**, mide las proporciones y le pide a Claude (con la skill `visajismo-cejas`) la forma de ceja. Al pulsar **Dibujar** deja la foto con la malla, la muestra del tono de piel y los campos de fórmula y duración.

```
web/            la app (HTML, CSS, JS) + detector facial MediaPipe incluido (funciona sin internet)
server.py       sirve la app y habla con Claude (guarda la clave de la API)
skill/SKILL.md  la skill de visajismo que usa el servidor como instrucciones
```

## 1. Probar en tu computador

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=tu_clave        # sin clave la app funciona con un diseño local
python server.py
```

Abre http://localhost:5000. La cámara funciona en `localhost` sin configurar nada más.

## 2. Usarla en el teléfono

Los navegadores solo dejan usar la cámara con **HTTPS**. Tres caminos:

- **GitHub Pages (la forma más rápida de verla, gratis).** En el repositorio: Settings → Pages → Source: *Deploy from a branch* → Branch `main`, carpeta `/ (root)` → Save. En uno o dos minutos queda en `https://TU_USUARIO.github.io/NOMBRE_DEL_REPO/`. Aquí no hay servidor, así que la app usa el **diseño local** (sin Claude) y lo avisa en pantalla. Sirve para probar la cámara, la malla y la pantalla Dibujar.
- **Publicarla con servidor** (Render, Railway, Fly.io…) para usar Claude. Ya incluye `Procfile` y `requirements.txt`. Agrega las variables de abajo en el panel del servicio.
- **Túnel temporal** desde tu computador (por ejemplo `cloudflared tunnel --url http://localhost:5000`) y abres la dirección https que te entrega.

Variables de entorno:

| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de la API de Claude (consola de Anthropic; se factura aparte de claude.ai). |
| `APP_CODIGO` | Opcional. Código que la app pide una vez; evita que cualquiera gaste tu API. **Recomendado si la publicas.** |
| `CLAUDE_MODEL` | Opcional. Por defecto `claude-sonnet-5-5`. |
| `LIMITE_POR_MINUTO` | Opcional. Consultas por minuto y por dispositivo (12 por defecto). |

## 3. Cómo se usa (clienta en camilla, teléfono en trípode)

1. **Abrir cámara.** Usa la trasera. Si la imagen sale de lado, toca **Girar** hasta que el rostro se vea derecho.
2. Espera el aviso verde **Rostro listo** (ojos abiertos, rostro de frente, suficientemente cerca, luz suficiente).
3. **Analizar rostro.** Toma unas 20 medidas en un segundo y consulta a Claude. Muestra la forma del rostro, el tipo de ceja y por qué.
4. La alumna marca en la piel los seis puntos celestes (Inicio, Arco, Final de cada lado) y traza el contorno uniéndolos.
5. **Dibujar.** Foto con la malla, tono de piel leído y los campos. **Guardar imagen** descarga todo en un PNG.

## 4. Cómo se calculó la malla

Se midieron 36 fotogramas del video del filtro y se dedujeron sus reglas. Unidad: distancia entre las comisuras externas de los ojos.

- **Arco:** recta que sale del ala de la nariz y pasa por el **centro del iris** (no por el borde), hasta una altura fija.
- **Final:** recta desde el ala de la nariz por la comisura externa del ojo. Queda unas 0.05 unidades **más alto** que el Inicio (el filtro no los deja exactamente a la misma altura).
- **Inicio:** vertical a 0.57 del semiancho de la nariz, más cerca del puente que el ala.
- Las alturas son fracciones de la distancia ojos-base de la nariz, así que se adaptan a cada rostro.
- Contra los puntos reales del filtro, el error medio fue 2.6 % de esa unidad (unos 6 px en el fotograma medido; máximo 4.9 %).

Todos estos valores están en `web/geometry.js`, en el objeto `G`, para que la visajista los ajuste.

`arco_altura` (baja, media, alta) que devuelve Claude multiplica la altura del Arco por 0.85, 1.0 o 1.15. La `cola` solo orienta el trazo: el punto Final se mantiene en la altura calibrada con el filtro.

## 5. Medidas que se envían a Claude (nunca la foto)

| Medida | Cómo se calcula |
|---|---|
| `largo_sobre_ancho_pomulos` | Frente superior a mentón ×1.15, entre ancho de pómulos. El factor compensa que el punto de la frente no es el nacimiento del cabello. |
| `ancho_frente_sobre_pomulos`, `ancho_mandibula_sobre_pomulos` | Ancho de frente y de mandíbula entre ancho de pómulos. |
| `forma_menton` | Ancho del mentón entre ancho de mandíbula: menor a 0.34 puntiagudo, mayor a 0.50 cuadrado, el resto redondeado. |
| `distancia_interocular_sobre_ancho_ojo` | Entre ojos (esquinas internas) entre ancho promedio de un ojo. |
| `ancho_nariz_sobre_interocular` | Ancho de las alas de la nariz entre la distancia entre ojos. |
| `distancia_ceja_ojo_izq/der` | Del borde inferior de la ceja natural al párpado, en anchos de ojo. |
| `giro_lateral_grados` | Giro del rostro; más de 10° pide repetir la captura. |

## 6. Cómo se conecta la skill

El servidor lee `skill/SKILL.md` al arrancar y la usa como instrucciones del sistema; además exige la respuesta en JSON con un esquema fijo (`server.py`). **Si cambias la skill en claude.ai, copia el texto nuevo en `skill/SKILL.md`** y reinicia el servidor. Los criterios de la skill (umbrales, tabla de cejas) son los que decide Claude; el diseño local del teléfono usa los mismos como respaldo cuando no hay conexión.

## 7. Pendiente: tono, fórmula y duración

Los dos campos están como **Pendiente** a propósito. Cuando tengas las tablas, se conectan en `dibujar()` de `web/app.js`: ahí ya está el color leído (`tono.rgb`, `tono.hex`) y el resultado del diseño (`est.diseno`). Hay que decidir si el servidor o la app hace la consulta, y de dónde sale el tipo de piel (lo captura la alumna o se estima).

El tono se lee de cinco parches (frente y mejillas) y se toma la mediana, pero depende de la luz de la cabina. Para que sea comparable entre sesiones haría falta una referencia de color en el cuadro, como una tarjeta gris neutra.

## 8. Qué se probó y qué no

Probado (navegador automatizado con el video del filtro como cámara):
- Detección del rostro y malla pegada al filtro original, en el video completo.
- Imagen girada 90° con el botón Girar; sin girar, la app rechaza la captura en vez de dar un diseño malo.
- Análisis, pantalla Dibujar, lectura de tono, descarga del PNG, diseño local de respaldo.
- Servidor: acceso con código, limpieza de datos de entrada, límite de uso, errores y archivos estáticos (18 pruebas con un Claude simulado).

**No probado:** la llamada real a la API de Claude (aquí no hay clave), ni la app en un teléfono real con la cámara trasera, ni con otros rostros distintos al del video. Con el primer rostro nuevo conviene revisar que la malla caiga bien y que la forma del rostro tenga sentido.

## 9. Limitaciones conocidas

- Los umbrales para clasificar la forma del rostro son valores comunes, no los de la visajista. Todas las pruebas con el rostro del video dieron "ovalado".
- La lectura de la guía de Peraldi para corazón y diamante es aproximada.
- Un solo rostro a la vez. Con barbijo, flequillo sobre las cejas o maquillaje fuerte de cejas, la detección empeora.
- El detector es MediaPipe Face Mesh (versión estable, ya no recibe actualizaciones). Funciona en navegadores actuales de teléfono y computador.
