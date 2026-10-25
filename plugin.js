// ============================================================
//  PLANTILLA DE PLUGIN PARA ZYNORA (varias fuentes en un solo plugin)
//  Solo tienes que editar la lista de abajo. No hace falta tocar el resto.
// ============================================================

// 1) AQUÍ ELIGES TUS FUENTES. Agrega un bloque { ... } por cada página web.
//    - web:        la dirección de la página (sin / al final)
//    - buscar:     la ruta del buscador de esa página; {q} se cambia por lo que se busca
//    - resultado:  selector CSS de CADA resultado de la lista de búsqueda
//    - titulo:     selector CSS del título, dentro de cada resultado
//    - enlace:     selector CSS del enlace <a> que abre la película, dentro de cada resultado
//    - poster:     selector CSS de la imagen del póster, dentro de cada resultado (opcional)
//    - reproductor: selector CSS de donde está el video en la página de la película (opcional, por defecto "iframe")
const SOURCES = [
  {
    nombre: "Fuente 1",
    web: "https://ejemplo1.com",
    buscar: "/buscar?q={q}",
    resultado: ".resultado",
    titulo: "h3",
    enlace: "a",
    poster: "img"
  },
  {
    nombre: "Fuente 2",
    web: "https://ejemplo2.com",
    buscar: "/?s={q}",
    resultado: "article",
    titulo: "h2",
    enlace: "a",
    poster: "img"
  }
];

// ============================================================
//  2) DE AQUÍ PARA ABAJO NO HACE FALTA CAMBIAR NADA
// ============================================================
function abs(base, u) {
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (/^https?:\/\//i.test(u)) return u;
  return u[0] === "/" ? base + u : base + "/" + u;
}
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
function first(html, css) { const r = kino.html.select(html, css); return r.length ? r[0] : null; }
function findVideo(html) {
  const clean = String(html).replace(/\\\//g, "/");
  const m = clean.match(/https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'\\<>]*)?/i);
  return m ? m[0] : "";
}

export async function search(q) {
  const query = encodeURIComponent(q.q);
  const listas = await Promise.all(SOURCES.map(async (src, i) => {
    try {
      const res = await kino.fetch(src.web + src.buscar.replace("{q}", query));
      if (!res.ok) return [];
      const out = [];
      for (const el of kino.html.select(res.text(), src.resultado).slice(0, 15)) {
        const a = first(el.html, src.enlace), t = first(el.html, src.titulo);
        const href = a && a.attrs.href;
        const title = (t && t.text) || (a && a.text);
        if (!href || !title) continue;
        const im = src.poster ? first(el.html, src.poster) : null;
        const poster = im ? abs(src.web, im.attrs["data-src"] || im.attrs.src) : "";
        const url = abs(src.web, href);
        out.push({
          id: i + "-" + hash(url),
          ref: JSON.stringify({ i: i, url: url }),
          title: title.slice(0, 150),
          kind: "movie",
          poster: poster.indexOf("https://") === 0 ? poster : ""
        });
      }
      return out;
    } catch (e) { return []; }
  }));
  return listas.flat();
}

export async function resolve(ref) {
  const d = JSON.parse(ref), src = SOURCES[d.i];
  const page = await kino.fetch(d.url);
  let link = findVideo(page.text());
  if (!link) {
    const frames = kino.html.select(page.text(), src.reproductor || "iframe");
    for (const f of frames.slice(0, 5)) {
      const u = abs(src.web, f.attrs["data-src"] || f.attrs.src);
      if (u.indexOf("https://") !== 0) continue;
      try {
        const r = await kino.fetch(u, { headers: { Referer: d.url } });
        link = findVideo(r.text());
        if (link) break;
      } catch (e) {}
    }
  }
  if (!link) throw kino.error("not_found", "No se encontró el video", { userMessage: "No se encontró el video en esa página. Prueba otra fuente." });
  return { url: link, headers: { Referer: d.url } };
}
