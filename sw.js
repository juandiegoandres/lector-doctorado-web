/* Service worker de la versión web: guarda el lector y el paquete cifrado en el aparato
   para leer sin internet. Lo descifrado nunca se guarda: solo los .bin tal como vienen.
   La versión llega en la URL (sw.js?v=…); cada publicación usa una caché nueva y borra la vieja. */
const VERSION = new URL(self.location).searchParams.get("v") || "0";
const CACHE = `lector-${VERSION}`;
// Lo que puede cambiar entre publicaciones se pide primero a la red.
const RED_PRIMERO = /(\/|index\.html|config\.js|precache\.json)$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "index.html", "config.js", "estatico.js", "app.js", "estilo.css",
    "vendor/pdf.min.js", "vendor/pdf.worker.min.js", "manifest.webmanifest", "icono-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("lector-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (RED_PRIMERO.test(url.pathname)) {
    e.respondWith(fetch(e.request).then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copia)); }
    return r;
  })));
});

/* Descarga en segundo plano todo el paquete para tenerlo sin internet, avisando el avance. */
self.addEventListener("message", (e) => {
  if (e.data !== "precargar") return;
  e.waitUntil((async () => {
    const lista = await (await fetch("precache.json", { cache: "no-store" })).json();
    const cache = await caches.open(CACHE);
    let hechos = 0;
    for (const ruta of lista) {
      if (!(await cache.match(ruta, { ignoreSearch: true }))) {
        try { const r = await fetch(ruta); if (r.ok) await cache.put(ruta, r); } catch { /* sin red: se reintenta la próxima vez */ }
      }
      hechos++;
      if (hechos % 5 === 0 || hechos === lista.length) e.source?.postMessage({ precarga: hechos, total: lista.length });
    }
  })());
});
