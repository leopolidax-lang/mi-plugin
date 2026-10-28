// ============================================================
//  Plugin LACartoons para Zynora  (v1.1.18)
//  /serie/NUMERO                  -> ficha de la serie con la lista de episodios
//  /serie/capitulo/NUMERO?t=TEMP  -> página del episodio (iframe ok.ru / cubeembed)
// ============================================================
const WEB = "https://lacartoons.com";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const UA_PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CANALES = "Nickelodeon|Cartoon Network|Fox Kids|Hanna Barbera|Disney|Warner Channel|Marvel|Otros";
const RE_TARJETA = new RegExp("^(.*?)\\s*(?:(" + CANALES + ")\\s+)?(\\d{4})\\s+(\\d{1,2})$");
const VACIAS = ["el", "la", "los", "las", "de", "del", "y", "en", "un", "una", "the", "of", "and", "a", "to", "serie", "animada"];

// Clave y vector del reproductor rpmvid/cubeembed (SIN VERIFICAR: si falla,
// el mensaje de error lo dirá en "dec ...").
// MODO DIAGNÓSTICO: en true NO reproduce, solo muestra qué enlace encontró. Pon false para reproducir.
const DEBUG = false;

const RPM_KEY = "kiemtienmua911ca";
const RPM_IV = "1234567890oiuytr";

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

// Fetch con cabeceras de navegador estándar
function pedir(url, referer) {
  const h = { "User-Agent": UA, "Accept-Language": "es-419,es;q=0.9", "Accept": "text/html,application/xhtml+xml,*/*" };
  if (referer) h.Referer = referer;
  return zynora.fetch(url, { headers: h });
}

function leerTarjetas(html) {
  const out = [], vistos = {};
  for (const a of zynora.html.select(html, 'a[href*="/serie/"]')) {
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
  try {
    const g = zynora.storage.get("cat");
    if (g) {
      const o = JSON.parse(g);
      if (o && Date.now() - o.t < 7 * 86400000 && o.l && o.l.length > 20) { CATALOGO = o.l; return CATALOGO; }
    }
  } catch (e) {}

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
  try { zynora.storage.set("cat", JSON.stringify({ t: Date.now(), l: lista.map(function (x) { return { n: x.n, title: x.title, year: x.year }; }) })); } catch (e) {}
  return CATALOGO;
}

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
  const motivo = ULTIMO_ERROR || (cat.length + " series revisadas, ninguna coincide con «" + q.q + "»");
  return [{ id: "lc-diag", ref: "diag:" + motivo.slice(0, 200), title: "[Diagnóstico] " + motivo, kind: "movie" }];
}

// ---------- Catálogo para la pestaña «Plugins» ----------
function atributo(tag, nombre) {
  const m = tag.match(new RegExp("\\s" + nombre + "\\s*=\\s*[\"']([^\"']+)[\"']", "i"));
  return m ? m[1].trim() : "";
}
function posterDe(html) {
  const tags = String(html || "").match(/<img\b[^>]*>/gi) || [];
  for (let i = 0; i < tags.length; i++) {
    const u = atributo(tags[i], "data-src") || atributo(tags[i], "data-lazy-src") || atributo(tags[i], "src");
    if (u && u.indexOf("data:") !== 0) return abs(u);
  }
  const bg = String(html || "").match(/url\(["']?([^"')]+)["']?\)/i);
  return bg ? abs(bg[1]) : "";
}
// Une el título y la imagen aunque estén en enlaces distintos de la misma tarjeta
function leerTarjetasConPoster(html) {
  const mapa = {}, orden = [];
  for (const a of seleccionarTarjetas(html)) {
    const m = String(a.attrs.href || "").match(/\/serie\/(\d+)\/?$/);
    if (!m) continue;
    let o = mapa[m[1]];
    if (!o) { o = mapa[m[1]] = { n: m[1], title: "", year: "", poster: "" }; orden.push(m[1]); }
    const t = String(a.text || "").trim();
    if (t && !o.title) {
      const mm = t.match(RE_TARJETA);
      o.title = ((mm ? mm[1] : t).trim() || t).slice(0, 150);
      o.year = mm ? mm[3] : "";
    }
    if (!o.poster) o.poster = posterDe(a.html);
  }
  return orden.map(function (k) { return mapa[k]; }).filter(function (x) { return x.title && x.poster; });
}
function seleccionarTarjetas(html) { return zynora.html.select(html, 'a[href*="/serie/"]'); }
function comoItem(x) {
  return { id: "lc-" + x.n, ref: abs("/serie/" + x.n), title: x.title, kind: "series", year: x.year, poster: x.poster };
}

export async function home() {
  const paginas = [1, 2, 3, 4, 5, 6];
  const lotes = await Promise.all(paginas.map(async function (p) {
    try { const r = await pedir(WEB + (p === 1 ? "/" : "/?page=" + p)); return r.ok ? leerTarjetasConPoster(r.text()) : []; } catch (e) { return []; }
  }));
  const visto = {};
  const todas = lotes.flat().filter(function (x) { if (visto[x.n]) return false; visto[x.n] = 1; return true; });
  if (!todas.length) return [];
  const filas = [{ id: "novedades", title: "Novedades", items: todas.slice(0, 20).map(comoItem) }];
  const anio = function (x) { return Number(x.year) || 0; };
  const grupos = [
    ["anos-2000", "De los 2000 en adelante", function (x) { return anio(x) >= 2000; }],
    ["anos-90", "Clásicas de los 90", function (x) { return anio(x) >= 1990 && anio(x) < 2000; }],
    ["anos-80", "De los 80 y antes", function (x) { return anio(x) > 0 && anio(x) < 1990; }]
  ];
  grupos.forEach(function (g) {
    const l = todas.filter(g[2]);
    if (l.length >= 6) filas.push({ id: g[0], title: g[1], items: l.slice(0, 30).map(comoItem) });
  });
  if (todas.length > 20) filas.push({ id: "mas-series", title: "Más series", items: todas.slice(20, 60).map(comoItem) });
  return filas;
}

export async function episodes(ref) {
  const r = await pedir(ref, WEB + "/");
  if (!r.ok) throw zynora.error("not_found", "HTTP " + r.status, { userMessage: "No se pudo abrir la serie en LACartoons (HTTP " + r.status + ")." });
  const eps = [], vistos = {};
  for (const a of zynora.html.select(r.text(), 'a[href*="/serie/capitulo/"]')) {
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

function limpiar(t) {
  return String(t).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/")
    .replace(/\\+u0026/gi, "&").replace(/\\+u003d/gi, "=").replace(/\\+\//g, "/").replace(/\\+"/g, '"');
}

// Extractor unificado
function buscarVideo(html) {
  const t = limpiar(html);

  // 1. Manifiestos HLS/Dash declarados en JSON (ok.ru y otros)
  let m = t.match(/"(?:hlsManifestUrl|ondemandHls|hlsMasterPlaylistUrl)":"(https:\/\/[^"]+)"/);
  if (m) return { url: m[1], mime: "application/x-mpegURL" };
  m = t.match(/"ondemandDash":"(https:\/\/[^"]+)"/);
  if (m) return { url: m[1], mime: "application/dash+xml" };

  // 2. URL .m3u8 en texto plano
  m = t.match(/(https?:\/\/[^\s"'\\<>]+?\.m3u8(?:\?[^\s"'\\<>]*)?)/i);
  if (m) return { url: m[0], mime: "application/x-mpegURL" };

  // 3. MP4 por calidades (ok.ru)
  const orden = ["full", "hd", "sd", "low", "lowest", "mobile"], hallados = {};
  let mm;
  const re = /"name":"([a-z0-9]+)"[^{}]*?"url":"(https:\/\/[^"]+)"/g;
  while ((mm = re.exec(t))) hallados[mm[1]] = mm[2];
  for (const n of orden) if (hallados[n]) return { url: hallados[n], mime: "video/mp4" };

  m = t.match(/https?:\/\/[^\s"'\\<>]+?\.mp4(?:\?[^\s"'\\<>]*)?/i);
  return m ? { url: m[0], mime: "video/mp4" } : null;
}

function embedDe(html) {
  // Primero, un iframe que sea un reproductor conocido (evita anuncios)
  const conocidos = /ok\.ru\/videoembed|rpmvid\.com/i;
  let primero = "";
  for (const f of zynora.html.select(html, "iframe")) {
    const u = abs(f.attrs["data-src"] || f.attrs.src);
    if (u.indexOf("https://") !== 0) continue;
    if (conocidos.test(u)) return u;
    if (!primero) primero = u;
  }
  const m = String(html).match(/https?:\/\/(?:www\.)?(?:ok\.ru\/videoembed|cubeembed\.rpmvid\.com)[^\s"'<>]+/i);
  if (m) return m[0];
  return primero;
}

function pistas(t) {
  const s = String(t);
  return "hls:" + (/hls|\.m3u8/.test(s) ? 1 : 0) + " vid:" + (/"videos"|&quot;videos/.test(s) ? 1 : 0);
}

// ---------- Descifrado del reproductor rpmvid / cubeembed ----------
function hexABytes(h) {
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
  return a;
}
async function descifrarRpm(hex) {
  const c = globalThis.crypto && globalThis.crypto.subtle;
  if (!c) throw new Error("este entorno no tiene crypto.subtle");
  const enc = new TextEncoder();
  const key = await c.importKey("raw", enc.encode(RPM_KEY), { name: "AES-CBC" }, false, ["decrypt"]);
  const buf = await c.decrypt({ name: "AES-CBC", iv: enc.encode(RPM_IV) }, key, hexABytes(hex));
  return new TextDecoder().decode(buf);
}

// Busca el video dentro de un texto (JSON descifrado o plano). Devuelve {url,mime} o null
function sacarDeTexto(txt, og, info, etiqueta) {
  let obj = null;
  try { obj = JSON.parse(txt); } catch (e) {}
  if (obj && typeof obj === "object") {
    delete obj.ads;
    const cands = [];
    const recorrer = function (o, ruta, prof) {
      if (prof > 4 || !o || typeof o !== "object") return;
      Object.keys(o).forEach(function (k) {
        const val = o[k];
        if (typeof val === "string") {
          const val2 = limpiar(val).trim();
          let pts = 0;
          if (/m3u8/i.test(val2)) pts += 5;
          if (/hlsmod/i.test(val2)) pts += 4;
          if (/^(https?:)?\/\//i.test(val2) || val2[0] === "/") pts += 1;
          if (/hls|source|file|^cf$|stream|video|src|url/i.test(k)) pts += 2;
          if (pts >= 3 && val2.length < 800 && /^(https?:)?\/|^[\w.-]+\//.test(val2)) cands.push({ k: ruta + k, v: val2, p: pts });
        } else if (val && typeof val === "object") recorrer(val, ruta + k + ".", prof + 1);
      });
    };
    recorrer(obj, "", 0);
    // Los enlaces con IP numérica no se pueden declarar en "hosts": se apartan y se anotan
    const conIp = cands.filter(function (c) { return /^(https?:)?\/\/\d{1,3}(\.\d{1,3}){3}/.test(c.v); });
    conIp.forEach(function (c) { info.t += "; ip " + c.k + "=" + c.v.replace(/^https?:\/\//, "").slice(0, 70); });
    for (let ci = cands.length - 1; ci >= 0; ci--) { if (conIp.indexOf(cands[ci]) >= 0) cands.splice(ci, 1); }
    cands.forEach(function (c) {
      let abs2 = c.v;
      if (abs2[0] === "/" && abs2.indexOf("//") !== 0) abs2 = og + abs2;
      if (/rpmvid\.com|ok\.ru/i.test(abs2)) c.p += 10;
    });
    cands.sort(function (x, y) { return y.p - x.p; });
    if (cands.length) {
      info.t += "; cand:" + cands.slice(0, 3).map(function (c) { return c.k + "@" + c.v.replace(/^https?:\/\//, "").slice(0, 30); }).join(",");
      let u = cands[0].v;
      if (u.indexOf("//") === 0) u = "https:" + u;
      else if (u[0] === "/") u = og + u;
      else if (!/^https?:/i.test(u)) u = og + "/" + u;
      info.t += "; " + etiqueta + " usé campo " + cands[0].k;
      return { url: u, mime: /\.mp4/i.test(u) ? "video/mp4" : "application/x-mpegURL" };
    }
    const resumen = Object.keys(obj).slice(0, 16).map(function (k) {
      const val = obj[k];
      const sv = typeof val === "string" ? val : JSON.stringify(val);
      return k + "=" + String(sv).replace(/[\r\n]+/g, " ").slice(0, 40);
    }).join(" | ");
    info.t += "; " + etiqueta + " campos: " + resumen;
    return null;
  }
  const v = buscarVideo(txt);
  if (!v) info.t += "; " + etiqueta + " sin video";
  return v;
}

// Pide una URL del reproductor rpmvid y descifra la respuesta si viene en hex
async function pedirRpm(url, og, info, etiqueta) {
  const r = await zynora.fetch(url, {
    headers: { "User-Agent": UA_PC, "Accept-Language": "es-419,es;q=0.9", "Referer": og + "/", "Origin": og }
  });
  const crudo = r.text().trim();
  info.t += "; " + etiqueta + " http" + r.status + " len" + crudo.length;
  if (!r.ok || !crudo) return "";
  if (/^[0-9a-f]+$/i.test(crudo) && crudo.length % 32 === 0) {
    try {
      const d = await descifrarRpm(crudo);
      info.t += " dec" + d.length;
      return d;
    } catch (e) {
      info.t += " decfallo:" + String((e && e.message) || e).slice(0, 60);
      return "";
    }
  }
  return crudo;
}

// El campo del JSON trae una ruta "/hls/..." pero el navegador usa "/hlsmod/<host>/...?v=...".
// Probamos las variantes y nos quedamos con la que devuelve una lista HLS real (#EXTM3U).
async function validarHls(v, og, texto, info) {
  if (!v || !/m3u8/i.test(v.url)) return v;
  const t = limpiar(texto);
  let ver = "1766826492";
  const mv = t.match(/"v"\s*:\s*"?(\d{8,})"?/);
  if (mv) ver = mv[1];
  const mh = t.match(/([a-z0-9-]+(?:\.[a-z0-9-]+)*tiktokcdn[a-z0-9.-]*\.com)/i);
  const host = mh ? mh[1] : "p16-ad-site-sign-sg.tiktokcdn.com";
  const sinQ = v.url.split("?")[0];
  const ruta = sinQ.indexOf(og) === 0 ? sinQ.slice(og.length) : "";
  const vars = [];
  if (/^\/hls\//.test(ruta)) vars.push(og + "/hlsmod/" + host + ruta.slice(4) + "?v=" + ver);
  vars.push(sinQ + "?v=" + ver);
  vars.push(v.url);
  for (let i = 0; i < vars.length; i++) {
    try {
      const r = await zynora.fetch(vars[i], { headers: { "User-Agent": UA_PC, "Accept-Language": "es-419,es;q=0.9", "Referer": og + "/", "Origin": og } });
      const tx = r.text();
      const ok = /^\s*#EXTM3U/.test(tx);
      info.t += "; H" + (i + 1) + " http" + r.status + (ok ? " HLS-OK" : " no-hls len" + tx.length) + " «" + tx.replace(/[\r\n]+/g, " ").slice(0, ok ? 150 : 60) + "»";
      if (ok) return { url: vars[i], mime: "application/x-mpegURL" };
    } catch (e) {
      info.t += "; H" + (i + 1) + " error:" + String((e && e.message) || e).slice(0, 40);
    }
  }
  return v;
}

async function resolverRpm(embed, info) {
  let id = "";
  if (embed.indexOf("#") >= 0) id = embed.split("#")[1];
  else {
    const mid = embed.match(/(?:[?&]id=|embed\/)([A-Za-z0-9_-]+)/);
    if (mid) id = mid[1];
  }
  id = String(id || "").trim();
  if (!id) { info.t += "; rpm sin id"; return null; }

  const og = new URL(embed).origin;
  const eid = encodeURIComponent(id);
  const referer = encodeURIComponent(og + "/");

  // 1) info: suele traer solo la configuración, pero por si trae el video
  const rutas = [
    og + "/api/v1/video?id=" + eid + "&w=1366&h=768&r=lacartoons.com",
    og + "/api/v1/video?id=" + eid + "&w=1920&h=1080&r=" + referer
  ];
  // la primera ruta de video se pide a la vez que "info" para no esperar dos veces
  const pre = pedirRpm(rutas[0], og, info, "V1").catch(function (e) { info.t += "; V1 error:" + String((e && e.message) || e).slice(0, 50); return ""; });
  let txt = "";
  try { txt = await pedirRpm(og + "/api/v1/info?id=" + eid, og, info, "info"); } catch (e) { info.t += "; info error:" + String((e && e.message) || e).slice(0, 50); }
  let v = txt ? sacarDeTexto(txt, og, info, "i") : null;
  if (v) return v;

  // 2) video: aquí debería venir la dirección del stream
  for (let i = 0; i < rutas.length && !v; i++) {
    try {
      const t2 = i === 0 ? await pre : await pedirRpm(rutas[i], og, info, "V" + (i + 1));
      if (t2) { v = sacarDeTexto(t2, og, info, "v" + (i + 1)); if (v) v = await validarHls(v, og, t2, info); }
    } catch (e) {
      info.t += "; V" + (i + 1) + " error:" + String((e && e.message) || e).slice(0, 50);
    }
  }
  return v;
}

// Solo para diagnóstico: mira dentro de la lista HLS (variantes, audio, segmentos)
async function diagHls(url, ori) {
  const h = { "User-Agent": UA_PC, "Accept-Language": "es-419,es;q=0.9", "Referer": ori, "Origin": ori.replace(/\/$/, "") };
  const corto = function (x, n) { return String(x).replace(/^https?:\/\//, "").slice(0, n); };
  const rel = function (r, base) { try { return new URL(r, base).href; } catch (e) { return r; } };
  let out = "";
  const r = await zynora.fetch(url, { headers: h });
  const tx = r.text();
  const uris = tx.split(/\r?\n/).filter(function (l) { return l && l[0] !== "#"; });
  const au = (tx.match(/URI="([^"]+)"/) || [])[1];
  out += "M len" + tx.length + " var=" + uris.length + " v1=" + corto(uris[0] || "-", 40) + " aud=" + corto(au || "-", 30);
  if (uris[0]) {
    const u2 = rel(uris[0], url);
    const r2 = await zynora.fetch(u2, { headers: h });
    const t2 = r2.text();
    const ls = t2.split(/\r?\n/);
    const segs = ls.filter(function (l) { return l && l[0] !== "#"; });
    const key = ls.filter(function (l) { return /EXT-X-KEY|EXT-X-MAP/.test(l); })[0];
    out += " | P http" + r2.status + " len" + t2.length + " segs=" + segs.length + " key=" + corto(key || "no", 50) + " s1=" + corto(segs[0] || "-", 70);
    if (segs[0]) {
      const u3 = rel(segs[0], u2);
      try {
        const r3 = await zynora.fetch(u3, { headers: h });
        const b = r3.text();
        let ct = "";
        try { ct = (r3.headers && (r3.headers["content-type"] || (r3.headers.get && r3.headers.get("content-type")))) || ""; } catch (e2) {}
        let cab = "";
        for (let q = 0; q < 24 && q < b.length; q++) cab += b.charCodeAt(q).toString(16) + " ";
        const iend = b.indexOf("IEND");
        let g = -1;
        for (let q = 0; q < Math.min(b.length - 400, 200000) && g < 0; q++) {
          if (b.charCodeAt(q) === 0x47 && b.charCodeAt(q + 188) === 0x47 && b.charCodeAt(q + 376) === 0x47) g = q;
        }
        out += " | S http" + r3.status + " len" + b.length + " ct=" + String(ct).slice(0, 30) + " head=" + cab + " IEND@" + iend + " ts@" + g;
      } catch (e) { out += " | S error:" + String((e && e.message) || e).slice(0, 50); }
    }
  }
  return out;
}

export async function resolve(ref) {
  if (String(ref).indexOf("diag:") === 0) throw zynora.error("not_found", "LACartoons: " + String(ref).slice(5));

  const pagina = await pedir(ref, WEB + "/");
  if (!pagina.ok) throw zynora.error("not_found", "Episodio no disponible", { userMessage: "Episodio no disponible" });

  const html = pagina.text();
  const info = { t: "pag " + html.length };
  let v = buscarVideo(html), embed = "";

  if (!v) {
    embed = embedDe(html);
    info.t += "; embed " + (embed ? embed.replace("https://", "").slice(0, 45) : "NO");

    if (embed && embed.indexOf("rpmvid.com") >= 0) {
      // --- cubeembed / rpmvid ---
      try {
        v = await resolverRpm(embed, info);
      } catch (e) {
        info.t += "; rpm error:" + String((e && e.message) || e).slice(0, 80);
      }
    }

    if (!v && embed) {
      // --- ok.ru y cualquier otro embed: probar la página tal cual ---
      const intentos = [embed];
      if (embed.indexOf("/videoembed/") >= 0) intentos.push(embed.replace("/videoembed/", "/video/"));
      let origen = "https://ok.ru/";
      try { origen = new URL(embed).origin + "/"; } catch (e) {}

      for (let i = 0; i < intentos.length && !v; i++) {
        const u = intentos[i], et = "ABCDE"[i] || "X";
        try {
          const r = await zynora.fetch(u, {
            headers: { "User-Agent": UA_PC, "Accept-Language": "es-419,es;q=0.9", "Referer": WEB + "/", "Origin": origen.replace(/\/$/, "") }
          });
          const tx = r.text();
          info.t += "; " + et + " http" + r.status + " len" + tx.length + " " + pistas(tx);
          v = buscarVideo(tx);
        } catch (e) {
          info.t += "; " + et + " error:" + String((e && e.message) || e).slice(0, 60);
        }
      }
    }
  }

  if (!v) {
    try { console.log("LACartoons sin video: " + info.t); } catch (e) {}
    throw zynora.error("not_found", "Episodio no disponible", { userMessage: "Episodio no disponible" });
  }

  let ori = "https://ok.ru/";
  try { if (embed) ori = new URL(embed).origin + "/"; } catch (e) {}

  if (DEBUG) {
    let extra = "";
    try { extra = await diagHls(v.url, ori); } catch (e) { extra = "diag error:" + String((e && e.message) || e).slice(0, 80); }
    throw zynora.error("not_found", "DEBUG " + extra);
  }

  const salida = { url: v.url, headers: { Referer: ori, Origin: ori.replace(/\/$/, ""), "User-Agent": UA_PC } };
  if (v.mime) salida.mime = v.mime;
  return salida;
}
