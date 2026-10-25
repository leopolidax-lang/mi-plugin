// ============================================================
//  Plugin LACartoons para Zynora  (v1.1.2)
//  /serie/NUMERO                  -> ficha de la serie con la lista de episodios
//  /serie/capitulo/NUMERO?t=TEMP  -> página del episodio (iframe de ok.ru)
// ============================================================
const WEB = "https://www.lacartoons.com";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const CANALES = "Nickelodeon|Cartoon Network|Fox Kids|Hanna Barbera|Disney|Warner Channel|Marvel|Otros";
const RE_TARJETA = new RegExp("^(.*?)\\s*(?:(" + CANALES + ")\\s+)?(\\d{4})\\s+(\\d{1,2})$");
const VACIAS = ["el", "la", "los", "las", "de", "del", "y", "en", "un", "una", "the", "of", "and", "a", "to", "serie", "animada"];

let CATALOGO = null;
let ULTIMO_ERROR = "";

function abs(u) {
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (/^https?:\/\//i.test(u)) return u;
  return u[0] === "/" ? WEB + u : WEB + "/" + u;
}
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function palabras(s) { return norm(s).split(" ").filter(function (w) { return w && VACIAS.indexOf(w) < 0; }); }
function primero(html, css) { const r = kino.html.select(html, css); return r.length ? r[0] : null; }

// fetch con User-Agent de navegador (algunos sitios bloquean el agente por defecto)
function pedir(url, referer) {
  const h = { "User-Agent": UA, "Accept-Language": "es-419,es;q=0.9", "Accept": "text/html,application/xhtml+xml,*/*" };
  if (referer) h.Referer = referer;
  return kino.fetch(url, { headers: h });
}

function leerTarjetas(html) {
  const out = [], vistos = {};
  for (const a of kino.html.select(html, 'a[href*="/serie/"]')) {
    const m = String(a.attrs.href || "").match(/\/serie\/(\d+)\/?$/);
    if (!m || vistos[m[1]]) continue;
    const t = String(a.text || "").trim();
    if (!t) continue;
    vistos[m[1]] = 1;
    const mm = t.match(RE_TARJETA);
    out.push({ n: m[1], title: ((mm ? mm[1] : t).trim() || t).slice(0, 150), year: mm ? mm[3] : "" });
  }
  return out;
}

async function cargarCatalogo() {
  if (CATALOGO) return CATALOGO;
  // 1) copia guardada (válida 7 días)
  try {
    const g = kino.storage.get("cat");
    if (g) {
      const o = JSON.parse(g);
      if (o && Date.now() - o.t < 7 * 86400000 && o.l && o.l.length > 20) { CATALOGO = o.l; return CATALOGO; }
    }
  } catch (e) {}
  // 2) descargar todas las páginas del inicio
  const r1 = await pedir(WEB + "/");
  if (!r1.ok) { ULTIMO_ERROR = "HTTP " + r1.status; return []; }
  const h1 = r1.text();
  let max = 1;
  (h1.match(/page=(\d+)/g) || []).forEach(function (x) { max = Math.max(max, Number(x.slice(5)) || 1); });
  max = Math.min(max, 55);
  const paginas = [];
  for (let p = 2; p <= max; p++) paginas.push(p);
  const resto = await Promise.all(paginas.map(async function (p) {
    try { const r = await pedir(WEB + "/?page=" + p); return r.ok ? leerTarjetas(r.text()) : []; } catch (e) { return []; }
  }));
  const visto = {};
  const lista = leerTarjetas(h1).concat(resto.flat()).filter(function (x) { if (visto[x.n]) return false; visto[x.n] = 1; return true; });
  if (!lista.length) { ULTIMO_ERROR = "sin tarjetas en la página"; return []; }
  CATALOGO = lista;
  try { kino.storage.set("cat", JSON.stringify({ t: Date.now(), l: lista.map(function (x) { return { n: x.n, title: x.title, year: x.year }; }) })); } catch (e) {}
  return CATALOGO;
}

// Puntaje de coincidencia entre una consulta y un título (0 a 1)
function puntaje(titulo, consulta) {
  const q = palabras(consulta), t = palabras(titulo);
  if (!q.length || !t.length) return 0;
  let ok = 0;
  q.forEach(function (w) { if (t.some(function (x) { return x === w || (w.length > 3 && (x.indexOf(w) === 0 || w.indexOf(x) === 0 && x.length > 3)); })) ok++; });
  return ok / q.length;
}

export async function search(q) {
  ULTIMO_ERROR = "";
  const consultas = [q.q, q.originalTitle].concat(q.altTitles || []).filter(function (x) { return x && String(x).trim(); });
  const cat = await cargarCatalogo();
  const res = [];
  cat.forEach(function (x) {
    let best = 0;
    consultas.forEach(function (c) { best = Math.max(best, puntaje(x.title, c)); });
    if (best >= 0.6) res.push({ x: x, s: best });
  });
  res.sort(function (a, b) { return b.s - a.s; });
  const items = res.slice(0, 15).map(function (r) {
    return { id: "lc-" + r.x.n, ref: abs("/serie/" + r.x.n), title: r.x.title, kind: "series", year: r.x.year, poster: "" };
  });
  if (items.length) return items;
  // Sin resultados: se muestra una línea de diagnóstico para saber qué pasó
  const motivo = ULTIMO_ERROR || (cat.length + " series revisadas, ninguna coincide con «" + q.q + "»");
  return [{ id: "lc-diag", ref: "diag:" + motivo.slice(0, 200), title: "[Diagnóstico] " + motivo, kind: "movie" }];
}

export async function episodes(ref) {
  const r = await pedir(ref, WEB + "/");
  if (!r.ok) throw kino.error("not_found", "HTTP " + r.status, { userMessage: "No se pudo abrir la serie en LACartoons (HTTP " + r.status + ")." });
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

// ---------- reproductor de ok.ru ----------
const UA_PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function limpiar(t) {
  return String(t).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/")
    .replace(/\\+u0026/gi, "&").replace(/\\+u003d/gi, "=").replace(/\\+\//g, "/").replace(/\\+"/g, '"');
}
function buscarVideo(html) {
  const t = limpiar(html);
  let m = t.match(/"(?:hlsManifestUrl|ondemandHls|hlsMasterPlaylistUrl)":"(https:\/\/[^"]+)"/);
  if (m) return { url: m[1], mime: "application/x-mpegURL" };
  m = t.match(/"ondemandDash":"(https:\/\/[^"]+)"/);
  if (m) return { url: m[1], mime: "application/dash+xml" };
  const orden = ["full", "hd", "sd", "low", "lowest", "mobile"], hallados = {};
  const re = /"name":"([a-z0-9]+)"[^{}]*?"url":"(https:\/\/[^"]+)"/g;
  while ((m = re.exec(t))) hallados[m[1]] = m[2];
  for (const n of orden) if (hallados[n]) return { url: hallados[n], mime: "video/mp4" };
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
function pistas(t) {
  const s = String(t);
  return "hls:" + (/hlsManifestUrl|ondemandHls|hlsMasterPlaylistUrl/.test(s) ? 1 : 0) + " vid:" + (/"videos"|&quot;videos/.test(s) ? 1 : 0) + " opt:" + (/data-options/.test(s) ? 1 : 0);
}

export async function resolve(ref) {
  if (String(ref).indexOf("diag:") === 0) throw kino.error("not_found", "LACartoons: " + String(ref).slice(5));
  const pagina = await pedir(ref, WEB + "/");
  if (!pagina.ok) throw kino.error("not_found", "LACartoons respondió HTTP " + pagina.status + " al abrir el episodio");
  const html = pagina.text();
  let v = buscarVideo(html), embed = "", info = "pag " + html.length;
  if (!v) {
    embed = embedDe(html);
    info += "; embed " + (embed ? embed.replace("https://", "").slice(0, 45) : "NO");
    if (embed) {
      // se prueban dos variantes del reproductor, con cabeceras de navegador de PC
      const intentos = [embed, embed.replace("/videoembed/", "/video/")];
      for (const u of intentos) {
        try {
          const r = await kino.fetch(u, { headers: { "User-Agent": UA_PC, "Accept-Language": "es-419,es;q=0.9", "Referer": WEB + "/" } });
          const tx = r.text();
          info += "; " + (u === embed ? "A" : "B") + " http" + r.status + " len" + tx.length + " " + pistas(tx);
          v = buscarVideo(tx);
          if (v) break;
        } catch (e) {
          info += "; " + (u === embed ? "A" : "B") + " error:" + String((e && e.message) || e).slice(0, 60);
        }
      }
    }
  }
  if (!v) throw kino.error("not_found", "No se encontró el video [" + info + "]");
  const salida = { url: v.url, headers: { Referer: "https://ok.ru/", "User-Agent": UA_PC } };
  if (v.mime) salida.mime = v.mime;
  return salida;
}
