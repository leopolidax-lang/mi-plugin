// ============================================================
//  Plugin LACartoons para Zynora
//  Estructura del sitio:
//    /serie/NUMERO                  -> ficha de la serie con la lista de episodios
//    /serie/capitulo/NUMERO?t=TEMP  -> página del episodio (trae un iframe de ok.ru)
// ============================================================
const WEB = "https://www.lacartoons.com";
const CANALES = "Nickelodeon|Cartoon Network|Fox Kids|Hanna Barbera|Disney|Warner Channel|Marvel|Otros";
// Texto de cada tarjeta: "Título Canal Año Valoración"
const RE_TARJETA = new RegExp("^(.*?)\\s*(?:(" + CANALES + ")\\s+)?(\\d{4})\\s+(\\d{1,2})$");

let CATALOGO = null; // se llena solo si el buscador del sitio no responde

function abs(u) {
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (/^https?:\/\//i.test(u)) return u;
  return u[0] === "/" ? WEB + u : WEB + "/" + u;
}
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function primero(html, css) { const r = kino.html.select(html, css); return r.length ? r[0] : null; }

// Lee las tarjetas de series de una página (inicio, búsqueda o paginación)
function leerTarjetas(html) {
  const out = [], vistos = {};
  for (const a of kino.html.select(html, 'a[href*="/serie/"]')) {
    const m = String(a.attrs.href || "").match(/\/serie\/(\d+)\/?$/);
    if (!m || vistos[m[1]]) continue;
    const t = String(a.text || "").trim();
    if (!t) continue;
    vistos[m[1]] = 1;
    const mm = t.match(RE_TARJETA);
    const im = primero(a.html, "img");
    const poster = im ? abs(im.attrs["data-src"] || im.attrs.src) : "";
    out.push({
      id: "lc-" + m[1],
      ref: abs("/serie/" + m[1]),
      title: ((mm ? mm[1] : t).trim() || t).slice(0, 150),
      kind: "series",
      year: mm ? mm[3] : "",
      poster: poster.indexOf("https://") === 0 ? poster : ""
    });
  }
  return out;
}

function coincide(titulo, consulta) {
  const t = norm(titulo), palabras = norm(consulta).split(" ").filter(Boolean);
  return palabras.length > 0 && palabras.every(function (p) { return t.indexOf(p) >= 0; });
}

async function cargarCatalogo() {
  if (CATALOGO) return CATALOGO;
  const r1 = await kino.fetch(WEB + "/");
  if (!r1.ok) return [];
  const h1 = r1.text();
  let max = 1;
  (h1.match(/page=(\d+)/g) || []).forEach(function (x) { max = Math.max(max, Number(x.slice(5)) || 1); });
  max = Math.min(max, 60);
  const todas = [leerTarjetas(h1)];
  const paginas = [];
  for (let p = 2; p <= max; p++) paginas.push(p);
  const resto = await Promise.all(paginas.map(async function (p) {
    try {
      const r = await kino.fetch(WEB + "/?page=" + p);
      return r.ok ? leerTarjetas(r.text()) : [];
    } catch (e) { return []; }
  }));
  const visto = {};
  CATALOGO = todas.concat(resto).flat().filter(function (x) { if (visto[x.id]) return false; visto[x.id] = 1; return true; });
  return CATALOGO;
}

export async function search(q) {
  const consulta = q.q;
  let items = [];
  try {
    const r = await kino.fetch(WEB + "/?Titulo=" + encodeURIComponent(consulta));
    if (r.ok) items = leerTarjetas(r.text()).filter(function (x) { return coincide(x.title, consulta); });
  } catch (e) {}
  if (!items.length) {
    try {
      items = (await cargarCatalogo()).filter(function (x) { return coincide(x.title, consulta); });
    } catch (e) {}
  }
  return items.slice(0, 20);
}

export async function episodes(ref) {
  const r = await kino.fetch(ref);
  if (!r.ok) throw kino.error("not_found", "No se pudo abrir la serie", { userMessage: "No se pudo abrir la serie en LACartoons." });
  const eps = [], vistos = {};
  for (const a of kino.html.select(r.text(), 'a[href*="/serie/capitulo/"]')) {
    const url = abs(a.attrs.href);
    if (vistos[url]) continue;
    const num = String(a.text || "").match(/Cap[ií]tulo\s+(\d+)\s*-?\s*(.*)$/i);
    if (!num) continue;
    const t = url.match(/[?&]t=(\d+)/);
    vistos[url] = 1;
    eps.push({ ref: url, season: t ? Number(t[1]) : 1, number: Number(num[1]), title: (num[2] || "").slice(0, 150) });
  }
  return { episodes: eps };
}

// ---------- lectura del reproductor de ok.ru ----------
function limpiar(t) {
  return String(t)
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/\\+u0026/gi, "&").replace(/\\+\//g, "/").replace(/\\+"/g, '"');
}
function buscarVideo(html) {
  const t = limpiar(html);
  let m = t.match(/"(?:hlsManifestUrl|ondemandHls|hlsMasterPlaylistUrl)":"(https:\/\/[^"]+)"/);
  if (m) return { url: m[1], mime: "application/x-mpegURL" };
  const orden = ["full", "hd", "sd", "low", "lowest", "mobile"], hallados = {};
  const re = /"name":"([a-z]+)","url":"(https:\/\/[^"]+)"/g;
  while ((m = re.exec(t))) hallados[m[1]] = m[2];
  for (const n of orden) if (hallados[n]) return { url: hallados[n], mime: "" };
  m = t.match(/https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'\\<>]*)?/i);
  return m ? { url: m[0], mime: /\.m3u8/i.test(m[0]) ? "application/x-mpegURL" : "" } : null;
}
function embedDe(html) {
  for (const f of kino.html.select(html, "iframe")) {
    const u = abs(f.attrs["data-src"] || f.attrs.src);
    if (u.indexOf("https://") === 0) return u;
  }
  const m = String(html).match(/https?:\/\/(?:www\.)?ok\.ru\/videoembed\/\d+/i);
  return m ? m[0] : "";
}

export async function resolve(ref) {
  const pagina = await kino.fetch(ref);
  const html = pagina.text();
  let v = buscarVideo(html);
  if (!v) {
    const embed = embedDe(html);
    if (embed) {
      try {
        const r = await kino.fetch(embed, { headers: { Referer: WEB + "/" } });
        v = buscarVideo(r.text());
      } catch (e) {}
    }
  }
  if (!v) throw kino.error("not_found", "No se encontró el video", { userMessage: "No se encontró el video de este episodio. Prueba otra fuente." });
  const salida = { url: v.url, headers: { Referer: "https://ok.ru/" } };
  if (v.mime) salida.mime = v.mime;
  return salida;
}
