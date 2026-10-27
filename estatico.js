/* Versión web (GitHub Pages): no hay servidor.
   Pide el PIN, descifra el paquete de datos/ y responde en el navegador las mismas rutas
   que en el Mac atiende servidor.py. Lo que necesita el Mac (escanear páginas nuevas,
   Calendario, agregar PDF, exportar) se oculta. El registro vive en este aparato. */
(() => {
  const CFG = window.LECTOR_ESTATICO;
  if (!CFG) return;
  document.documentElement.classList.add("estatico");
  const fetchReal = window.fetch.bind(window);
  const base = new URL(".", location.href).pathname;
  let clave = null, indice = null;
  const cache = new Map();

  const deB64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  const aB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const escribir = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  async function derivar(pin) {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: deB64(CFG.sal), iterations: CFG.iteraciones, hash: "SHA-256" },
      material, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }
  async function descifrar(nombre) {
    const datos = new Uint8Array(await (await fetchReal(`datos/${nombre}.bin?v=${CFG.version}`)).arrayBuffer());
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: datos.slice(0, 12) }, clave, datos.slice(12));
  }
  const texto = (buf) => new TextDecoder().decode(buf);
  async function archivo(id, tipo) {
    const opaco = indice.archivos[id]?.[tipo];
    if (!opaco) return null;
    if (!cache.has(opaco)) cache.set(opaco, descifrar(opaco));
    return cache.get(opaco);
  }

  /* ---------- PIN ---------- */
  window.esperarDesbloqueo = () => new Promise((listo) => {
    const capa = document.createElement("div");
    capa.id = "candado";
    capa.innerHTML = `<div class="candado-caja">
        <p class="sobretitulo">Doctorado en Educación, Cultura y Sociedad</p>
        <h1>Lecturas</h1><p class="candado-ayuda">Escribe tu PIN</p>
        <div class="puntos">${"<i></i>".repeat(4)}</div>
        <p class="candado-error" hidden></p>
        <div class="teclado">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((t) => `<button ${t === "" ? "disabled" : ""}>${t}</button>`).join("")}</div>
        <label class="recordar"><input type="checkbox" id="recordar"> No volver a pedirlo en este aparato</label>
      </div>`;
    document.body.appendChild(capa);
    let pin = "";
    const pintar = () => capa.querySelectorAll(".puntos i").forEach((p, i) => p.classList.toggle("lleno", i < pin.length));
    const probar = async (k) => {
      try {
        clave = k;
        indice = JSON.parse(texto(await descifrar("indice")));
        return true;
      } catch { clave = null; return false; }
    };
    const terminar = () => { capa.remove(); listo(); prepararSinInternet(); };
    // ¿Ya se había recordado en este aparato?
    const guardada = leer(`clave-${CFG.version}`);
    if (guardada) {
      crypto.subtle.importKey("raw", deB64(guardada), "AES-GCM", true, ["decrypt"]).then(probar).then((ok) => ok && terminar());
    }
    const intentar = async () => {
      capa.querySelector(".candado-ayuda").textContent = "Abriendo…";
      const k = await derivar(pin);
      if (await probar(k)) {
        if (capa.querySelector("#recordar").checked) escribir(`clave-${CFG.version}`, aB64(await crypto.subtle.exportKey("raw", k)));
        return terminar();
      }
      pin = ""; pintar();
      capa.querySelector(".candado-ayuda").textContent = "Escribe tu PIN";
      const e = capa.querySelector(".candado-error");
      e.textContent = "PIN incorrecto"; e.hidden = false;
      capa.querySelector(".puntos").animate([{ transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "none" }], { duration: 240, iterations: 2 });
    };
    const tecla = (t) => {
      if (t === "⌫") pin = pin.slice(0, -1);
      else if (/\d/.test(t) && pin.length < 4) pin += t;
      pintar();
      if (pin.length === 4) intentar();
    };
    capa.querySelectorAll(".teclado button").forEach((b) => b.addEventListener("click", () => tecla(b.textContent)));
    addEventListener("keydown", (e) => { if (document.body.contains(capa)) tecla(e.key === "Backspace" ? "⌫" : e.key); });
  });

  /* ---------- Sin internet: el service worker guarda el lector y el paquete cifrado ---------- */
  async function prepararSinInternet() {
    if (!("serviceWorker" in navigator)) return;
    const aviso = (t) => { const el = document.getElementById("sin-internet"); if (el) el.textContent = t; };
    try {
      await navigator.serviceWorker.register(`sw.js?v=${CFG.version}`);
      const reg = await navigator.serviceWorker.ready;
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (!e.data?.precarga) return;
        const { precarga, total } = e.data;
        aviso(precarga < total ? `· Descargando para usar sin internet: ${Math.round((precarga / total) * 100)}%` : "· Disponible sin internet ✓");
      });
      // Pide al navegador que no borre lo guardado si se queda sin espacio.
      navigator.storage?.persist?.();
      reg.active?.postMessage("precargar");
    } catch { aviso(""); }
  }

  /* ---------- Plan (copia de aplicar_plan de servidor.py) ---------- */
  const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const planActual = () => JSON.parse(leer("plan-web") || "null") || indice.plan;
  function aplicarPlan(libros) {
    const bloques = [...planActual().bloques].sort((a, b) => (a.fecha + a.inicio).localeCompare(b.fecha + b.inicio));
    const primero = {};
    bloques.forEach((bl) => { primero[bl.id] ||= bl; });
    const carpetas = [];
    indice.catalogo.forEach((b) => { if (!carpetas.includes(b.carpeta)) carpetas.push(b.carpeta); });
    const orden = ["Esta semana", "Mi documento", ...carpetas.filter((c) => c !== "Mi documento")];
    for (const b of libros) {
      const bl = primero[b.id];
      b.estante = bl ? "Esta semana" : b.carpeta;
      if (bl) { const f = new Date(bl.fecha + "T12:00"); b.dia = `${DIAS[f.getDay()]} ${f.getDate()} · ${bl.inicio}`; } else b.dia = "";
      b.plan = bl ? `${bl.fecha} ${bl.inicio}` : "9999";
    }
    libros.sort((a, b) => orden.indexOf(a.estante) - orden.indexOf(b.estante) || a.plan.localeCompare(b.plan) || a.autor.localeCompare(b.autor));
    return libros;
  }

  /* ---------- OCR: el del paquete, con las correcciones hechas en este aparato ---------- */
  async function ocrPaginas(id) {
    const buf = await archivo(id, "ocr");
    return buf ? JSON.parse(texto(buf)) : {};
  }
  async function ocrPagina(id, n) {
    const local = leer(`ocr:${id}:${n}`);
    if (local) return JSON.parse(local);
    return (await ocrPaginas(id))[n] || { p: n, palabras: [], aviso: "Esta página no se escaneó en el Mac." };
  }

  /* ---------- Capturas en IndexedDB ---------- */
  const db = new Promise((ok, mal) => {
    const r = indexedDB.open("lector", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("capturas", { keyPath: "clave" });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
  const tienda = async (modo) => (await db).transaction("capturas", modo).objectStore("capturas");
  const pedir = (req) => new Promise((ok, mal) => { req.onsuccess = () => ok(req.result); req.onerror = () => mal(req.error); });
  async function capturas(id) {
    const todas = await pedir((await tienda("readonly")).getAll());
    return todas.filter((c) => c.id === id).sort((a, b) => a.fecha.localeCompare(b.fecha)).map(({ blob, clave, ...c }) => c);
  }

  /* ---------- Rutas ---------- */
  const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
  const SOLO_MAC = { error: "Esto solo funciona con el lector del Mac." };

  window.fetch = async (entrada, opciones = {}) => {
    const url = new URL(typeof entrada === "string" ? entrada : entrada.url, location.href);
    if (!url.pathname.startsWith(base) || url.pathname.startsWith(base + "datos/") || url.pathname.startsWith(base + "vendor/")) return fetchReal(entrada, opciones);
    const ruta = decodeURIComponent(url.pathname.slice(base.length));
    const metodo = (opciones.method || "GET").toUpperCase();
    const cuerpo = async () => JSON.parse(opciones.body || "{}");
    let m;

    if (ruta === "api/estado") return json({ reinicio: `web-${CFG.version}` });
    if (ruta === "api/catalogo") return json(aplicarPlan(structuredClone(indice.catalogo)));
    if (ruta === "api/registro") return json({});
    if ((m = ruta.match(/^api\/registro\/(.+)$/))) return json({ ok: true });
    if ((m = ruta.match(/^pdf\/(.+)$/))) {
      const buf = await archivo(m[1], "pdf");
      return buf ? new Response(buf, { headers: { "Content-Type": "application/pdf" } }) : json({}, 404);
    }
    if ((m = ruta.match(/^(traduccion|md|citas)\/(.+)$/)) || (m = ruta.match(/^api\/(citas)\/(.+)$/))) {
      const tipo = m[1] === "traduccion" ? "traduccion" : m[1];
      const buf = await archivo(m[2], tipo);
      if (!buf) return json({}, 404);
      return tipo === "md" ? new Response(texto(buf), { headers: { "Content-Type": "text/html" } }) : new Response(texto(buf), { headers: { "Content-Type": "application/json" } });
    }
    if (ruta.startsWith("subrayado/")) return json({}, 404);
    if ((m = ruta.match(/^api\/ocr\/([^/]+)$/))) {
      const paginas = new Set(Object.keys(await ocrPaginas(m[1])).map(Number));
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(`ocr:${m[1]}:`)) paginas.add(+k.split(":")[2]); }
      return json({ paginas: [...paginas].sort((a, b) => a - b) });
    }
    if ((m = ruta.match(/^api\/ocr\/([^/]+)\/(\d+)$/))) {
      if (metodo === "POST") {
        const previo = await ocrPagina(m[1], +m[2]);
        escribir(`ocr:${m[1]}:${m[2]}`, JSON.stringify({ p: +m[2], palabras: (await cuerpo()).palabras, corregida: true, ...(previo.canal && { canal: previo.canal }) }));
        return json({ ok: true });
      }
      return json(await ocrPagina(m[1], +m[2]));
    }
    if (ruta === "api/ocr") {
      // Recorte de una página escaneada: se toma del OCR ya hecho en el Mac.
      const { id, p, caja: [x, y, w, h] } = await cuerpo();
      const palabras = (await ocrPagina(id, p)).palabras.filter((it) => {
        const cy = it.y + it.h / 2;
        return cy >= y && cy <= y + h && it.x + it.w > x && it.x < x + w;
      });
      const lineas = new Map();
      palabras.forEach((it) => { const k = `${it.y}|${it.h}`; if (!lineas.has(k)) lineas.set(k, []); lineas.get(k).push(it); });
      const orden = [...lineas.values()].map((ws) => ws.sort((a, b) => a.x - b.x)).sort((a, b) => a[0].y - b[0].y);
      return json({
        texto: orden.map((ws) => ws.map((x) => x.s).join(" ")).join(" ").replace(/(\w)- (\w)/g, "$1$2"),
        lineas: orden.map((ws) => { const x1 = ws[0].x, x2 = Math.max(...ws.map((x) => x.x + x.w)); return [x1, ws[0].y, x2 - x1, ws[0].h]; }),
      });
    }
    if (ruta === "api/traducir") return json({ aviso: "Sin traducción guardada para este párrafo: selecciona el texto y toca «Traducir» del iPad." });
    if (ruta === "api/plan") {
      if (metodo === "POST") {
        const { bloques } = await cuerpo();
        if (bloques.some((b) => !b.fecha || !(b.fin > b.inicio))) return json({ error: "Revisa las fechas y las horas: el fin debe ser después del inicio." }, 400);
        const plan = { ...planActual(), bloques: [...bloques].sort((a, b) => (a.fecha + a.inicio).localeCompare(b.fecha + b.inicio)) };
        escribir("plan-web", JSON.stringify(plan));
        return json(plan);
      }
      return json(planActual());
    }
    if ((m = ruta.match(/^api\/capturas\/([^/]+)(\/nota|\/borrar)?$/))) {
      const id = m[1];
      if (metodo === "POST") {
        const d = await cuerpo();
        // Cada transacción se abre justo antes de usarla: IndexedDB la cierra si en medio se espera otra cosa.
        if (m[2] === "/borrar") await pedir((await tienda("readwrite")).delete(`${id}/${d.archivo}`));
        else if (m[2] === "/nota") {
          const c = await pedir((await tienda("readonly")).get(`${id}/${d.archivo}`));
          if (c) { c.nota = d.nota; await pedir((await tienda("readwrite")).put(c)); }
        } else {
          const ahora = new Date();
          const archivo = `p${d.p}-${ahora.getTime()}.png`;
          const blob = await (await fetchReal(d.imagen)).blob();
          const registroCaptura = { clave: `${id}/${archivo}`, id, archivo, p: d.p, caja: d.caja, nota: "", fecha: ahora.toISOString().slice(0, 16).replace("T", " "), blob };
          await pedir((await tienda("readwrite")).put(registroCaptura));
        }
      }
      return json(await capturas(id));
    }
    if ((m = ruta.match(/^captura\/([^/]+)\/(.+)$/))) {
      const c = await pedir((await tienda("readonly")).get(`${m[1]}/${m[2]}`));
      return c ? new Response(c.blob, { headers: { "Content-Type": "image/png" } }) : json({}, 404);
    }
    if (ruta.startsWith("api/")) return json(SOLO_MAC, 501);
    return fetchReal(entrada, opciones);
  };

  /* Las imágenes de las capturas se piden con <img src>, que no pasa por fetch: se cambian por blobs. */
  new MutationObserver(async (cambios) => {
    for (const c of cambios) for (const n of c.addedNodes) {
      if (!(n instanceof Element)) continue;
      for (const img of n.querySelectorAll?.('img[src^="captura/"]') || []) {
        const r = await window.fetch(img.getAttribute("src"));
        if (r.ok) img.src = URL.createObjectURL(await r.blob());
      }
      for (const a of n.querySelectorAll?.('a[href^="captura/"]') || []) {
        const r = await window.fetch(a.getAttribute("href").split("?")[0]);
        if (r.ok) a.href = URL.createObjectURL(await r.blob());
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
