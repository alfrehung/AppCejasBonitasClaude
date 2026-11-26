"""Servidor de Visajismo de cejas.

- Sirve la app web (carpeta web/).
- POST /api/diseno: recibe las medidas del rostro, consulta a Claude con la skill como instrucciones
  y devuelve el diseño de ceja en JSON validado.

La clave de la API vive solo aquí (variable ANTHROPIC_API_KEY), nunca en el teléfono.
"""
import json
import os
import pathlib
import re
import time
from collections import defaultdict, deque

from flask import Flask, jsonify, request, send_from_directory

AQUI = pathlib.Path(__file__).resolve().parent
WEB = AQUI / "web"
MODELO = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5")
LIMITE_POR_MINUTO = int(os.environ.get("LIMITE_POR_MINUTO", "12"))

app = Flask(__name__, static_folder=None)


def cargar_skill() -> str:
    texto = (AQUI / "skill" / "SKILL.md").read_text(encoding="utf-8")
    return re.sub(r"\A---\n.*?\n---\n", "", texto, count=1, flags=re.S).strip()


INSTRUCCION_INTEGRACION = """

## Integración con la app
- Responde SOLO con el JSON que pide el esquema, sin texto adicional ni Markdown.
- Las 3 a 5 líneas para la alumna van en el campo `explicacion_alumna`.
- Si no hay segunda opción de forma de rostro, usa una cadena vacía en `segunda_opcion`.
- Si no pides recaptura, `recaptura.motivo` es una cadena vacía.
- El punto Final de la malla se mantiene a la altura calibrada; `cola` solo orienta el trazo de la alumna.
"""

SISTEMA = cargar_skill() + INSTRUCCION_INTEGRACION

FORMAS = ["ovalado", "redondo", "alargado", "cuadrado", "corazon", "diamante"]


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


ESQUEMA = _obj({
    "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
    "recaptura": _obj({"necesaria": {"type": "boolean"}, "motivo": {"type": "string"}}),
    "rostro": _obj({
        "forma": {"type": "string", "enum": FORMAS},
        "segunda_opcion": {"type": "string"},
        "razon": {"type": "string"},
    }),
    "ceja": _obj({
        "tipo": {"type": "string"},
        "arco_altura": {"type": "string", "enum": ["baja", "media", "alta"]},
        "arco_definicion": {"type": "string", "enum": ["suave", "definido"]},
        "cola": {"type": "string", "enum": ["descendente", "horizontal", "ascendente"]},
    }),
    "ajustes_por_proporcion": {"type": "array", "items": {"type": "string"}},
    "notas": {"type": "array", "items": {"type": "string"}},
    "explicacion_alumna": {"type": "string"},
})

CAMPOS_CALIDAD = {
    "giro_lateral_grados": (int, float), "inclinacion_grados": (int, float),
    "ojos_abiertos": (bool,), "frente_despejada": (bool,), "cejas_visibles": (bool,),
}
CAMPOS_MEDIDAS = {
    "largo_sobre_ancho_pomulos": (int, float), "ancho_frente_sobre_pomulos": (int, float),
    "ancho_mandibula_sobre_pomulos": (int, float), "forma_menton": (str,),
    "distancia_interocular_sobre_ancho_ojo": (int, float), "ancho_nariz_sobre_interocular": (int, float),
    "distancia_ceja_ojo_izq": (int, float), "distancia_ceja_ojo_der": (int, float),
}
MENTONES = {"redondeado", "puntiagudo", "cuadrado"}


def limpiar(datos):
    """Reconstruye la entrada con solo los campos conocidos y del tipo esperado (nada libre llega al modelo)."""
    if not isinstance(datos, dict):
        return None
    salida = {}
    for grupo, campos in (("calidad", CAMPOS_CALIDAD), ("medidas", CAMPOS_MEDIDAS)):
        bruto = datos.get(grupo)
        if not isinstance(bruto, dict):
            return None
        salida[grupo] = {}
        for k, tipos in campos.items():
            v = bruto.get(k)
            if v is None or not isinstance(v, tipos) or (bool not in tipos and isinstance(v, bool)):
                return None
            if isinstance(v, (int, float)) and not isinstance(v, bool) and not (-1000 < v < 1000):
                return None
            salida[grupo][k] = v
    if salida["medidas"]["forma_menton"] not in MENTONES:
        return None
    return salida


_visitas = defaultdict(deque)


def demasiadas_peticiones(ip: str) -> bool:
    ahora = time.time()
    cola = _visitas[ip]
    while cola and ahora - cola[0] > 60:
        cola.popleft()
    if len(cola) >= LIMITE_POR_MINUTO:
        return True
    cola.append(ahora)
    return False


def _cliente():
    import anthropic  # se importa aquí para poder arrancar la app aunque falte el paquete
    return anthropic.Anthropic()


@app.post("/api/diseno")
def diseno():
    codigo = os.environ.get("APP_CODIGO")
    if codigo and request.headers.get("X-Acceso", "") != codigo:
        return jsonify(error="acceso"), 401
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return jsonify(error="sin_clave"), 503
    if (request.content_length or 0) > 4000:
        return jsonify(error="demasiado_grande"), 413
    ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0]).strip()
    if demasiadas_peticiones(ip):
        return jsonify(error="limite"), 429
    datos = limpiar(request.get_json(silent=True))
    if datos is None:
        return jsonify(error="datos_invalidos"), 400
    try:
        resp = _cliente().messages.create(
            model=MODELO,
            max_tokens=1500,
            system=SISTEMA,
            messages=[{"role": "user", "content": json.dumps(datos, ensure_ascii=False)}],
            extra_body={"output_config": {"format": {"type": "json_schema", "schema": ESQUEMA}}},
        )
        if getattr(resp, "stop_reason", "") in ("refusal", "max_tokens"):
            return jsonify(error="respuesta_incompleta"), 502
        texto = next(b.text for b in resp.content if b.type == "text")
        salida = json.loads(texto)
        if salida.get("rostro", {}).get("forma") not in FORMAS:
            return jsonify(error="respuesta_invalida"), 502
        return jsonify(salida)
    except Exception as e:  # no se filtra el detalle al navegador
        app.logger.exception("Fallo al consultar a Claude: %s", type(e).__name__)
        return jsonify(error="claude"), 502


@app.get("/", defaults={"ruta": "index.html"})
@app.get("/<path:ruta>")
def estaticos(ruta):
    r = send_from_directory(WEB, ruta)
    r.headers["Permissions-Policy"] = "camera=(self)"
    r.headers["X-Content-Type-Options"] = "nosniff"
    return r


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
