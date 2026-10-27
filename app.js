/* Lector de lecturas del doctorado.
   El catálogo y los PDF vienen de servidor.py; el avance se guarda en registro.json
   (y, si el Mac no responde, en el iPad hasta que vuelva la conexión). */
pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NOTAS_ESTANTE = {
  "Esta semana": "El núcleo para el jueves. Lee y subraya limpio; compara después.",
  "Mi documento": "Lo que entregaste y cómo se construyó.",
};

let catalogo = [];
let registro = {};
let filtro = "todos";
const pendientes = new Set(JSON.parse(leerLocal("pendientes") || "[]"));

function leerLocal(k) { try { return localStorage.getItem(k); } catch { return null; } }
function escribirLocal(k, v) { try { localStorage.setItem(k, v); } catch {} }
const DONDE = window.LECTOR_ESTATICO ? "en este aparato" : "en el Mac";
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ahoraCorto = () => new Date().toISOString().slice(0, 16).replace("T", " ");

/* ---------------- Registro ---------------- */
function item(id) {
  if (!registro[id]) registro[id] = { estado: "pendiente", pagina: 1, paginas: 0, minutos: 0, sesiones: [],
    ficha: { afirma: "", sostiene: "", uso: "", dudas: "" }, apuntes: [], subrayados: [], actualizado: "" };
  registro[id].subrayados ||= [];
  return registro[id];
}

const temporizadores = {};
function guardar(id, inmediato = false) {
  const it = item(id);
  it.actualizado = new Date().toISOString();
  escribirLocal("registro", JSON.stringify(registro));
  pendientes.add(id);
  escribirLocal("pendientes", JSON.stringify([...pendientes]));
  clearTimeout(temporizadores[id]);
  temporizadores[id] = setTimeout(() => enviar(id), inmediato ? 0 : 1200);
}

async function enviar(id) {
  try {
    const r = await fetch(`api/registro/${encodeURIComponent(id)}`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(registro[id]), keepalive: true });
    if (r.status === 409) registro[id] = (await r.json()).vigente; // otro aparato guardó después
    else if (!r.ok) throw new Error(r.status);
    pendientes.delete(id);
    escribirLocal("pendientes", JSON.stringify([...pendientes]));
    avisoGuardado(pendientes.size ? "Guardando…" : `Guardado ${DONDE}`);
  } catch {
    avisoGuardado("Sin conexión con el Mac: guardado en el iPad, se sube al volver");
  }
}
function reintentar() { [...pendientes].forEach(enviar); }
setInterval(reintentar, 20000);
addEventListener("online", reintentar);
function avisoGuardado(t) { $("#estado-guardado").textContent = t; }

/* ---------------- Biblioteca ---------------- */
async function iniciar() {
  // Si el registro del Mac se vació a propósito, este aparato suelta su copia local.
  try {
    const { reinicio } = await (await fetch("api/estado")).json();
    if (leerLocal("reinicio") !== reinicio) {
      ["registro", "pendientes"].forEach((k) => { try { localStorage.removeItem(k); } catch {} });
      pendientes.clear();
      escribirLocal("reinicio", reinicio);
    }
  } catch {}
  catalogo = await (await fetch("api/catalogo")).json();
  const local = JSON.parse(leerLocal("registro") || "{}");
  let remoto = {};
  try { remoto = await (await fetch("api/registro")).json(); } catch {}
  // Por documento, gana el que se guardó más tarde.
  for (const id of new Set([...Object.keys(local), ...Object.keys(remoto)])) {
    const a = local[id], b = remoto[id];
    registro[id] = !a ? b : !b ? a : (a.actualizado > b.actualizado ? a : b);
    if (a && (!b || a.actualizado > b.actualizado)) pendientes.add(id);
  }
  reintentar();
  avisoGuardado(pendientes.size ? "Subiendo cambios del iPad…" : `Todo guardado ${DONDE}`);
  pintarBiblioteca();
}

$$(".estados .segmento").forEach((b) => b.addEventListener("click", () => {
  filtro = b.dataset.filtro;
  $$(".estados .segmento").forEach((x) => x.classList.toggle("activo", x === b));
  pintarBiblioteca();
}));
let vista = leerLocal("vista") || "estantes";
$$(".vistas .segmento").forEach((b) => b.addEventListener("click", () => { vista = b.dataset.vista; escribirLocal("vista", vista); pintarBiblioteca(); }));

function pintarBiblioteca() {
  $$(".vistas .segmento").forEach((x) => x.classList.toggle("activo", x.dataset.vista === vista));
  $("#estantes").hidden = vista !== "estantes";
  $("#vista-lista").hidden = vista !== "lista";
  $("#vista-plan").hidden = vista !== "plan";
  $(".estados").hidden = vista === "plan";
  if (vista === "lista") pintarLista();
  if (vista === "plan") pintarPlan();
  const estantes = {};
  catalogo
    .filter((b) => filtro === "todos" || (registro[b.id]?.estado || "pendiente") === filtro)
    .forEach((b) => (estantes[b.estante] ||= []).push(b));
  $("#estantes").innerHTML = Object.entries(estantes).map(([nombre, libros]) => `
    <section class="estante">
      <div class="estante-cabeza"><h2>${esc(nombre)}</h2><p>${NOTAS_ESTANTE[nombre] || `${libros.length} documentos`}</p></div>
      <div class="fila">${libros.map(tomo).join("")}</div>
    </section>`).join("") || `<p class="vacio" style="margin-top:30px">Nada en esta vista todavía.</p>`;
  $$(".tomo").forEach((t) => t.addEventListener("click", () => abrir(t.dataset.id)));

  const hoy = new Date().toISOString().slice(0, 10);
  let total = 0, deHoy = 0, leidos = 0, marcas = 0;
  Object.values(registro).forEach((r) => {
    total += r.minutos || 0;
    (r.sesiones || []).forEach((s) => { if (s.fecha === hoy) deHoy += s.min; });
    if (r.estado === "leido") leidos++;
    marcas += (r.subrayados || []).length;
  });
  const nucleo = catalogo.filter((b) => b.estante === "Esta semana");
  const nucleoLeido = nucleo.filter((b) => registro[b.id]?.estado === "leido").length;
  const cifra = (t, v) => `<div class="cifra"><span>${t}</span><strong>${v}</strong></div>`;
  $("#cifras").innerHTML = cifra("Hoy", `${Math.round(deHoy)} min`) + cifra("Total", `${(total / 60).toFixed(1)} h`)
    + cifra("Núcleo leído", `${nucleoLeido}/${nucleo.length}`) + cifra("Subrayados", marcas);
}

function tomo(b) {
  const r = registro[b.id];
  const estado = r?.estado || "pendiente";
  const pct = b.paginas && r ? Math.min(100, Math.round((r.pagina / b.paginas) * 100)) : 0;
  const etiqueta = { pendiente: "Pendiente", leyendo: "Leyendo", leido: "Leído" }[estado];
  return `<button class="tomo" data-id="${esc(b.id)}">
    ${b.dia ? `<span class="dia">${esc(b.dia)}</span>` : ""}
    <span class="autor">${esc(b.autor)} ${esc(b.anio)}</span>
    <span class="tema">${esc(b.titulo || b.tema)}</span>
    <span class="meta"><span class="estado-chip ${estado}">${etiqueta}</span>
      <span>${b.paginas ? `p. ${r?.pagina || 1}/${b.paginas}` : ""}${r?.minutos ? ` · ${Math.round(r.minutos)} min` : ""}</span></span>
    ${b.paginas ? `<span class="barra-avance"><i style="width:${pct}%"></i></span>` : ""}
  </button>`;
}

/* ---------------- Vista Lista ---------------- */
let ordenLista = leerLocal("orden") || "plan";
function filaDatos(b) {
  const r = registro[b.id] || {};
  const ses = (r.sesiones || []).filter((x) => x.min > 0);
  return { b, estado: r.estado || "pendiente", pct: b.paginas && r.pagina ? Math.min(100, Math.round((r.pagina / b.paginas) * 100)) : 0,
    min: Math.round(r.minutos || 0), subs: (r.subrayados || []).length, ultima: ses.length ? ses[ses.length - 1].fecha : "" };
}
function pintarLista() {
  const filas = catalogo.filter((b) => filtro === "todos" || (registro[b.id]?.estado || "pendiente") === filtro).map(filaDatos);
  const ordenes = {
    plan: (a, b) => 0,
    autor: (a, b) => a.b.autor.localeCompare(b.b.autor),
    avance: (a, b) => b.pct - a.pct,
    minutos: (a, b) => b.min - a.min,
    ultima: (a, b) => (b.ultima || "").localeCompare(a.ultima || ""),
  };
  filas.sort(ordenes[ordenLista] || ordenes.plan);
  const etiqueta = { pendiente: "Pendiente", leyendo: "Leyendo", leido: "Leído" };
  const th = (k, t, num) => `<th data-orden="${k}" class="${num ? "num" : ""}">${t}${ordenLista === k ? " ↓" : ""}</th>`;
  $("#vista-lista").innerHTML = `<div class="desplazable"><table class="tabla"><thead><tr>
      ${th("autor", "Lectura")}<th>Plan</th><th>Estado</th>${th("avance", "Avance")}${th("minutos", "Min", 1)}<th class="num">Subrayados</th>${th("ultima", "Última vez")}
    </tr></thead><tbody>${filas.map((f) => `<tr data-id="${esc(f.b.id)}">
      <td class="titulo-celda"><strong>${esc(f.b.autor)} ${esc(f.b.anio)}</strong><span>${esc(f.b.titulo || f.b.tema)}</span></td>
      <td>${esc(f.b.dia || "")}</td>
      <td><span class="estado-chip ${f.estado}">${etiqueta[f.estado]}</span></td>
      <td class="num"><span class="mini-barra"><i style="width:${f.pct}%"></i></span>${f.pct}%</td>
      <td class="num">${f.min}</td><td class="num">${f.subs}</td><td>${f.ultima}</td></tr>`).join("")}</tbody></table></div>`;
  $$("#vista-lista tbody tr").forEach((tr) => tr.addEventListener("click", () => abrir(tr.dataset.id)));
  $$("#vista-lista th[data-orden]").forEach((th) => th.addEventListener("click", () => { ordenLista = th.dataset.orden; escribirLocal("orden", ordenLista); pintarLista(); }));
}

/* ---------------- Vista Plan: Gantt, editor y Calendario ---------------- */
let plan = null;
const hoyISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const DIAS_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
async function pintarPlan() {
  if (!plan) { try { plan = await (await fetch("api/plan")).json(); } catch { return; } }
  pintarGantt();
  pintarEditorPlan();
  cargarCalendarios();
}
function pintarGantt() {
  const fechas = new Set([hoyISO()]);
  plan.bloques.forEach((bl) => fechas.add(bl.fecha));
  Object.values(registro).forEach((r) => (r.sesiones || []).forEach((x) => x.min > 0 && fechas.add(x.fecha)));
  const orden = [...fechas].sort();
  const dias = [];
  for (let d = new Date(orden[0] + "T12:00"); d <= new Date(orden[orden.length - 1] + "T12:00"); d.setDate(d.getDate() + 1))
    dias.push(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const ids = [...new Set([...plan.bloques.map((bl) => bl.id), ...Object.keys(registro).filter((id) => (registro[id].sesiones || []).some((x) => x.min > 0))])];
  const hoy = hoyISO();
  const nombre = (id) => catalogo.find((b) => b.id === id);
  $("#gantt").innerHTML = `<div class="desplazable"><table><thead><tr><th></th>${dias.map((d) => {
      const f = new Date(d + "T12:00");
      return `<th class="${d === hoy ? "hoy" : ""}">${DIAS_CORTOS[f.getDay()]} ${f.getDate()}</th>`; }).join("")}</tr></thead><tbody>
    ${ids.filter(nombre).map((id) => {
      const b = nombre(id), r = registro[id] || {};
      const pct = b.paginas && r.pagina ? Math.round((r.pagina / b.paginas) * 100) : 0;
      return `<tr><td class="nombre" data-id="${esc(id)}">${esc(b.autor)} ${esc(b.anio)}<span>${pct}% · ${r.estado === "leido" ? "leído" : `${Math.round(r.minutos || 0)} min`}</span></td>${dias.map((d) => {
        const planeados = plan.bloques.filter((bl) => bl.id === id && bl.fecha === d);
        const real = (r.sesiones || []).filter((x) => x.fecha === d).reduce((a, x) => a + x.min, 0);
        return `<td class="${d === hoy ? "hoy" : ""}">${planeados.map((bl) => `<span class="g-plan${real >= 20 ? " cumplido" : ""}">${bl.inicio}–${bl.fin}</span>`).join("")}${real >= 0.5 ? `<span class="g-real">${Math.round(real)} min</span>` : ""}</td>`;
      }).join("")}</tr>`; }).join("")}</tbody></table></div>`;
  $$("#gantt td.nombre").forEach((td) => td.addEventListener("click", () => abrir(td.dataset.id)));
}
function pintarEditorPlan() {
  const opciones = catalogo.filter((b) => b.tipo === "pdf").map((b) => `<option value="${esc(b.id)}">${esc(b.autor)} ${esc(b.anio)} · ${esc((b.titulo || b.tema).slice(0, 50))}</option>`).join("");
  $("#plan-editor").innerHTML = plan.bloques.map((bl, i) => `<div class="plan-fila" data-i="${i}">
      <select data-k="id">${opciones}</select>
      <input type="date" data-k="fecha" value="${bl.fecha}">
      <input type="time" data-k="inicio" value="${bl.inicio}">
      <input type="time" data-k="fin" value="${bl.fin}">
      <input data-k="nota" value="${esc(bl.nota || "")}" placeholder="Nota">
      <button class="boton fantasma" data-quitar="${i}" aria-label="Quitar bloque">✕</button></div>`).join("")
    || `<p class="vacio">No hay bloques. Agrega uno.</p>`;
  $$("#plan-editor .plan-fila").forEach((fila) => {
    const bl = plan.bloques[+fila.dataset.i];
    $("select", fila).value = bl.id;
    $$("[data-k]", fila).forEach((c) => c.addEventListener("change", () => { bl[c.dataset.k] = c.value; $("#plan-estado").textContent = "Sin guardar"; }));
  });
  $$("#plan-editor [data-quitar]").forEach((x) => x.addEventListener("click", () => { plan.bloques.splice(+x.dataset.quitar, 1); pintarEditorPlan(); $("#plan-estado").textContent = "Sin guardar"; }));
}
$("#plan-agregar").addEventListener("click", () => {
  const ult = plan.bloques[plan.bloques.length - 1];
  plan.bloques.push({ id: catalogo.find((b) => b.tipo === "pdf").id, fecha: ult?.fecha || hoyISO(), inicio: "19:00", fin: "20:30", nota: "" });
  pintarEditorPlan();
});
$("#plan-guardar").addEventListener("click", async () => {
  $("#plan-estado").textContent = "Guardando…";
  const r = await fetch("api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bloques: plan.bloques }) });
  const res = await r.json();
  if (!r.ok) { $("#plan-estado").textContent = res.error; return; }
  plan = res;
  catalogo = await (await fetch("api/catalogo")).json();
  $("#plan-estado").textContent = "Plan guardado";
  pintarGantt(); pintarEditorPlan();
});
async function cargarCalendarios() {
  if ($("#cal-nombre").dataset.cargado) return;
  try {
    const lista = await (await fetch("api/calendarios")).json();
    $("#cal-nombre").innerHTML = lista.map((n) => `<option>${esc(n)}</option>`).join("");
    if (plan.calendario) $("#cal-nombre").value = plan.calendario;
    $("#cal-nombre").dataset.cargado = "1";
    if (plan.calendario) $("#cal-estado").textContent = `Último envío: ${Object.keys(plan.eventos || {}).length} eventos en «${plan.calendario}»`;
  } catch { $("#cal-nombre").innerHTML = "<option>No se pudo leer el Calendario</option>"; }
}
$("#cal-enviar").addEventListener("click", async () => {
  if ($("#plan-estado").textContent === "Sin guardar") { $("#cal-estado").textContent = "Primero guarda el plan."; return; }
  $("#cal-estado").textContent = "Creando eventos… (la primera vez el Mac puede pedir permiso para usar Calendario)";
  const r = await fetch("api/plan/calendario", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ calendario: $("#cal-nombre").value, direccion: location.origin }) });
  const res = await r.json();
  $("#cal-estado").textContent = r.ok ? `Listo: ${res.eventos} eventos en «${res.calendario}»` : `No se pudo: ${res.error}`;
  if (r.ok) plan = null;
});

/* ---------------- Agregar lectura ---------------- */
$("#b-subir").addEventListener("click", () => { $("#form-subir").reset(); $("#s-estado").textContent = ""; $("#subir").showModal(); });
$("#s-cancelar").addEventListener("click", () => $("#subir").close());
$("#s-archivo").addEventListener("change", () => {
  // Sugiere autor y año a partir del nombre del archivo (p. ej. «lithner2008.pdf»).
  const n = $("#s-archivo").files[0]?.name.replace(/\.pdf$/i, "") || "";
  const m = n.match(/([A-Za-zÀ-ÿ]+)[\s_-]*((?:19|20)\d{2})/);
  if (m && !$("#s-autor").value) { $("#s-autor").value = m[1][0].toUpperCase() + m[1].slice(1); $("#s-anio").value = m[2]; }
});
$("#form-subir").addEventListener("submit", async (e) => {
  e.preventDefault();
  const archivo = $("#s-archivo").files[0];
  if (!archivo) return;
  $("#s-estado").textContent = "Subiendo…";
  $("#s-enviar").disabled = true;
  const q = new URLSearchParams({ autor: $("#s-autor").value, anio: $("#s-anio").value, titulo: $("#s-titulo").value });
  try {
    const r = await fetch(`api/subir?${q}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: archivo });
    const res = await r.json();
    if (!r.ok) throw new Error(res.error);
    catalogo = await (await fetch("api/catalogo")).json();
    $("#subir").close();
    pintarBiblioteca();
  } catch (err) { $("#s-estado").textContent = `No se pudo agregar: ${err.message || "sin conexión con el Mac"}`; }
  $("#s-enviar").disabled = false;
});

$("#exportar").addEventListener("click", () => {
  const filas = [["id", "estado", "pagina", "paginas", "minutos", "afirma", "sostiene", "uso", "dudas", "notas", "subrayados"]];
  const limpio = (t) => String(t || "").replace(/[\t\n]+/g, " ");
  catalogo.forEach((b) => {
    const r = registro[b.id]; if (!r) return;
    filas.push([b.id, r.estado, r.pagina, b.paginas, Math.round(r.minutos), limpio(r.ficha.afirma), limpio(r.ficha.sostiene),
      limpio(r.ficha.uso), limpio(r.ficha.dudas), r.apuntes.map((a) => `p.${a.p}: ${limpio(a.t)}`).join(" | "),
      (r.subrayados || []).map((s) => `p.${s.p} [${(COLORES[s.color] || COLORES.amarillo).nombre}]: ${limpio(s.texto)}`).join(" | ")]);
  });
  const blob = new Blob([filas.map((f) => f.join("\t")).join("\n")], { type: "text/tab-separated-values" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `registro-lecturas-${new Date().toISOString().slice(0, 10)}.tsv` });
  a.click();
});

/* ---------------- Lector ---------------- */
const L = { libro: null, pdf: null, version: "pdf", n: 0, pag: 1, doble: null, imgs: new Map(), textos: new Map(),
  girando: false, pw: 0, ph: 0, ratio: 1.294, sesion: null, ultimoToque: 0, modo: "leer" };

async function abrir(id) {
  const b = catalogo.find((x) => x.id === id);
  if (!b) return;
  L.libro = b;
  history.pushState(null, "", "#leyendo");
  $("#biblioteca").hidden = true;
  $("#lector").hidden = false;
  $("#l-autor").textContent = `${b.autor} ${b.anio}`;
  $("#l-tema").textContent = b.titulo || b.tema;
  $("#b-comparar").hidden = !b.subrayado;
  pintarPanelExamen();
  cargarFicha();
  pintarCapturas();
  const r = item(b.id);
  if (r.estado === "pendiente") { r.estado = "leyendo"; $("#f-estado").value = "leyendo"; guardar(b.id); }
  iniciarSesion();
  cambiarModo("leer");

  const esMd = b.tipo === "md";
  $("#papel").hidden = !esMd; $("#libro").hidden = esMd;
  $("#l-rango").hidden = esMd; $("#b-modo").hidden = esMd; $(".herramientas").hidden = esMd;
  if (esMd) {
    $("#cargando").hidden = true; $("#l-pagina").textContent = "";
    $("#papel").innerHTML = await (await fetch(`md/${encodeURIComponent(id)}`)).text();
    return;
  }
  L.trad = null;
  L.ocrHechas = new Set();
  fetch(`api/ocr/${encodeURIComponent(id)}`).then((x) => x.json()).then((o) => { if (L.libro === b) { L.ocrHechas = new Set(o.paginas); marcarOcr(); } }).catch(() => {});
  if (b.traducido) fetch(`traduccion/${encodeURIComponent(id)}`).then((x) => x.ok ? x.json() : null).then((t) => { if (L.libro === b) L.trad = t; }).catch(() => {});
  await cargarPdf("pdf", r.pagina || 1);
}

async function cargarPdf(version, pagina) {
  L.version = version;
  $("#b-comparar").classList.toggle("activo", version === "subrayado");
  $("#b-comparar").textContent = version === "subrayado" ? "Ver limpio" : "Comparar";
  $("#aviso-comparar").hidden = version !== "subrayado";
  $("#cargando").hidden = false;
  L.imgs.forEach((u) => URL.revokeObjectURL(u)); L.imgs.clear(); L.textos.clear();
  const url = `${version}/${encodeURIComponent(L.libro.id)}`;
  // En la versión web el PDF llega descifrado por fetch; en el Mac, pdf.js lo pide directo.
  const fuente = window.LECTOR_ESTATICO ? { data: new Uint8Array(await (await fetch(url)).arrayBuffer()) } : url;
  L.pdf = await pdfjsLib.getDocument(fuente).promise;
  L.n = L.pdf.numPages;
  const vp = (await L.pdf.getPage(1)).getViewport({ scale: 1 });
  L.ratio = vp.height / vp.width;
  $("#l-rango").max = L.n;
  const r = item(L.libro.id);
  if (r.paginas !== L.n) { r.paginas = L.n; guardar(L.libro.id); }
  L.pag = Math.min(Math.max(1, pagina), L.n);
  maquetar();
  await mostrar();
  $("#cargando").hidden = true;
}
$("#b-comparar").addEventListener("click", () => cargarPdf(L.version === "pdf" ? "subrayado" : "pdf", L.pag));

function quiereDoble() { return L.doble !== null ? L.doble : innerWidth > innerHeight; }

function maquetar() {
  const doble = quiereDoble();
  const mesa = $("#mesa").getBoundingClientRect();
  const altoMax = mesa.height - 28, anchoMax = (mesa.width - 28) / (doble ? 2 : 1);
  let pw = anchoMax, ph = pw * L.ratio;
  if (ph > altoMax) { ph = altoMax; pw = ph / L.ratio; }
  L.pw = Math.floor(pw); L.ph = Math.floor(ph);
  const libro = $("#libro");
  libro.style.setProperty("--pw", `${L.pw}px`);
  libro.style.setProperty("--ph", `${L.ph}px`);
  libro.className = doble ? "doble" : "simple";
  $("#b-modo").textContent = doble ? "1 página" : "2 páginas";
}

/* En doble página, la izquierda es par y la derecha impar: [_,1] [2,3] [4,5]… */
const izquierda = (p) => (p % 2 === 0 ? p : p - 1);
/* Qué página muestra cada hueco ahora mismo. */
function paginasVisibles() {
  if (!quiereDoble()) return { der: L.pag, izq: 0 };
  const iz = izquierda(L.pag);
  return { izq: iz, der: iz + 1 };
}

async function imagen(n) {
  if (n < 1 || n > L.n) return "";
  if (L.imgs.has(n)) return L.imgs.get(n);
  const pagina = await L.pdf.getPage(n);
  const base = pagina.getViewport({ scale: 1 });
  const vp = pagina.getViewport({ scale: (L.pw / base.width) * Math.min(devicePixelRatio || 1, 2) * 1.15 });
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.floor(vp.width); lienzo.height = Math.floor(vp.height);
  await pagina.render({ canvasContext: lienzo.getContext("2d"), viewport: vp }).promise;
  const url = URL.createObjectURL(await new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", 0.9)));
  L.imgs.set(n, url);
  if (L.imgs.size > 24) { const [k, u] = L.imgs.entries().next().value; URL.revokeObjectURL(u); L.imgs.delete(k); }
  return url;
}
function poner(img, url) { img.src = url || "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="; img.style.visibility = url ? "visible" : "hidden"; }

async function mostrar() {
  const v = paginasVisibles();
  if (quiereDoble()) {
    const [a, b] = await Promise.all([imagen(v.izq), imagen(v.der)]);
    poner($("#libro .slot.izq img"), a); poner($("#libro .slot.der img"), b);
  } else {
    poner($("#libro .slot.der img"), await imagen(v.der));
  }
  pintarMarcas();
  pintarCapasTexto();
  actualizarPie();
  precargar();
}

function precargar() {
  const paso = quiereDoble() ? 2 : 1;
  [1, 2, 3].forEach((k) => imagen(L.pag + k * paso));
  imagen(L.pag - paso);
}

function marcarOcr() {
  const v = paginasVisibles();
  $("#b-ocr").classList.toggle("listo", [v.izq, v.der].some((n) => L.ocrHechas?.has(n)));
}

/* ---------------- OCR por página o de todo el documento ---------------- */
let ocrEnCurso = null;
$("#b-ocr").addEventListener("click", (e) => {
  e.stopPropagation();
  $('#menu-ocr [data-ocr="pagina"]').textContent = quiereDoble() ? "Escanear estas 2 páginas" : "Escanear esta página";
  $("#menu-ocr").hidden = !$("#menu-ocr").hidden;
});
addEventListener("click", (e) => { if (!e.target.closest(".ancla")) $("#menu-ocr").hidden = true; });
$$("#menu-ocr [data-ocr]").forEach((b) => b.addEventListener("click", (e) => {
  e.stopPropagation(); // que el toque no llegue a la página y la pase
  $("#menu-ocr").hidden = true;
  const v = paginasVisibles();
  if (b.dataset.ocr === "corregir") return abrirEditorOcr(quiereDoble() && v.izq >= 1 ? v.izq : v.der);
  const paginas = b.dataset.ocr === "todo"
    ? Array.from({ length: L.n }, (_, i) => i + 1)
    : [v.izq, v.der].filter((n) => n >= 1 && n <= L.n);
  escanear(paginas, b.dataset.ocr === "todo");
}));
$$("#menu-ocr [data-exportar]").forEach((b) => b.addEventListener("click", async (e) => {
  e.stopPropagation();
  $("#menu-ocr").hidden = true;
  await enviar(L.libro.id); // que el Mac tenga los últimos subrayados antes de armar el PDF
  location.href = `api/exportar/${encodeURIComponent(L.libro.id)}${b.dataset.exportar === "1" ? "?subrayados=1" : ""}`;
}));

/* ---------------- Editor del OCR ----------------
   La página original al lado de las líneas que leyó el OCR; al tocar una línea se enmarca en la página. */
const EO = { n: 0, lineas: [] };
async function abrirEditorOcr(n) {
  if (!(n >= 1 && n <= L.n)) return;
  EO.n = n;
  $("#editor-ocr").hidden = false;
  $("#eo-titulo").textContent = `Corregir OCR · p. ${n} de ${L.n}`;
  $("#eo-lineas").innerHTML = "";
  $("#eo-foco").hidden = true;
  $("#eo-estado").textContent = L.ocrHechas.has(n) ? "Cargando…" : "Escaneando la página…";
  const [img, res] = await Promise.all([imagenGrande(n), fetch(`api/ocr/${encodeURIComponent(L.libro.id)}/${n}`).then((r) => r.json())]);
  if (EO.n !== n) return;
  L.ocrHechas.add(n); L.textos.delete(n); marcarOcr();
  $(".hoja-ocr img").src = img;
  // Las palabras de una misma línea comparten «y»: se agrupan de vuelta en líneas.
  const grupos = new Map();
  for (const w of res.palabras || []) {
    const k = `${w.y}|${w.h}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(w);
  }
  // En páginas a dos columnas se lee primero la izquierda y luego la derecha.
  const columna = (l) => (res.canal && l.x >= res.canal - 0.01 ? 1 : 0);
  // Un hueco grande separa dos líneas que van a la misma altura.
  const tramos = [];
  for (const ws of grupos.values()) {
    ws.sort((a, b) => a.x - b.x);
    let actual = [ws[0]];
    for (const w of ws.slice(1)) {
      const ant = actual[actual.length - 1];
      if (w.x - (ant.x + ant.w) > 0.04) { tramos.push(actual); actual = [w]; } else actual.push(w);
    }
    tramos.push(actual);
  }
  EO.lineas = tramos.map((ws) => {
    const x1 = Math.min(...ws.map((w) => w.x)), x2 = Math.max(...ws.map((w) => w.x + w.w));
    return { x: x1, y: ws[0].y, w: x2 - x1, h: ws[0].h, texto: ws.map((w) => w.s).join(" ") };
  }).sort((a, b) => columna(a) - columna(b) || a.y - b.y || a.x - b.x);
  $("#eo-estado").textContent = res.corregida ? "Esta página ya tiene correcciones guardadas" : `${EO.lineas.length} líneas leídas`;
  $("#eo-lineas").innerHTML = EO.lineas.map((l, i) =>
    `<li><span>${i + 1}</span><textarea rows="1" data-i="${i}" spellcheck="true" autocapitalize="off">${esc(l.texto)}</textarea></li>`).join("")
    || `<li class="vacio" style="display:block">El OCR no encontró texto en esta página.</li>`;
  requestAnimationFrame(() => $$("#eo-lineas textarea").forEach((ta) => (ta.style.height = `${ta.scrollHeight + 2}px`)));
  $$("#eo-lineas textarea").forEach((ta) => {
    ta.addEventListener("focus", () => enfocarLinea(+ta.dataset.i));
    ta.addEventListener("input", () => { ta.classList.toggle("cambiada", ta.value !== EO.lineas[+ta.dataset.i].texto); ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight + 2}px`; });
  });
}
function enfocarLinea(i) {
  const l = EO.lineas[i];
  const f = $("#eo-foco");
  Object.assign(f.style, { left: `${(l.x - 0.005) * 100}%`, top: `${(l.y - 0.004) * 100}%`, width: `${(l.w + 0.01) * 100}%`, height: `${(l.h + 0.008) * 100}%` });
  f.hidden = false;
  f.scrollIntoView({ block: "center", behavior: "smooth" });
}
async function imagenGrande(n) {
  const pagina = await L.pdf.getPage(n);
  const base = pagina.getViewport({ scale: 1 });
  const vp = pagina.getViewport({ scale: (1100 * Math.min(devicePixelRatio || 1, 2)) / base.width });
  const c = document.createElement("canvas");
  c.width = vp.width; c.height = vp.height;
  await pagina.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  return c.toDataURL("image/jpeg", 0.9);
}
$("#eo-guardar").addEventListener("click", async () => {
  // Cada línea corregida se reparte en palabras a lo ancho de su caja original.
  const palabras = [];
  $$("#eo-lineas textarea").forEach((ta) => {
    const l = EO.lineas[+ta.dataset.i];
    const trozos = ta.value.trim().split(/\s+/).filter(Boolean);
    const letras = trozos.reduce((a, t) => a + t.length, 0) + Math.max(0, trozos.length - 1);
    let cursor = 0;
    for (const t of trozos) {
      palabras.push({ s: t, x: l.x + (l.w * cursor) / Math.max(1, letras), y: l.y, w: (l.w * t.length) / Math.max(1, letras), h: l.h });
      cursor += t.length + 1;
    }
  });
  $("#eo-estado").textContent = "Guardando…";
  try {
    const r = await fetch(`api/ocr/${encodeURIComponent(L.libro.id)}/${EO.n}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ palabras }) });
    if (!r.ok) throw new Error(r.status);
    L.textos.delete(EO.n);
    $$("#eo-lineas textarea.cambiada").forEach((ta) => { EO.lineas[+ta.dataset.i].texto = ta.value; ta.classList.remove("cambiada"); });
    $("#eo-estado").textContent = "Correcciones guardadas";
    pintarCapasTexto();
  } catch { $("#eo-estado").textContent = "No se pudo guardar (¿el Mac está encendido?)"; }
});
$("#eo-cerrar").addEventListener("click", () => ($("#editor-ocr").hidden = true));
$("#eo-ant").addEventListener("click", () => abrirEditorOcr(EO.n - 1));
$("#eo-sig").addEventListener("click", () => abrirEditorOcr(EO.n + 1));

$("#cancelar-ocr").addEventListener("click", () => { if (ocrEnCurso) ocrEnCurso.cancelado = true; });

async function escanear(paginas, forzar) {
  if (ocrEnCurso) return;
  const libro = L.libro;
  const tarea = (ocrEnCurso = { cancelado: false });
  const pendientesOcr = forzar ? paginas.filter((n) => !L.ocrHechas.has(n)) : paginas;
  $("#progreso-ocr").hidden = false;
  $("#cancelar-ocr").hidden = false;
  for (const [k, n] of pendientesOcr.entries()) {
    if (tarea.cancelado || L.libro !== libro) break;
    $("#progreso-ocr span").textContent = pendientesOcr.length > 1 ? `Escaneando p. ${n} · ${k + 1} de ${pendientesOcr.length}` : `Escaneando p. ${n}…`;
    animarEscaner(n, true);
    try {
      // Al menos un barrido completo, aunque la página ya estuviera escaneada.
      await Promise.all([(await fetch(`api/ocr/${encodeURIComponent(libro.id)}/${n}`)).json(), new Promise((r) => setTimeout(r, 1500))]);
      L.ocrHechas.add(n);
      L.textos.delete(n);
      pintarCapasTexto();
    } catch { $("#progreso-ocr span").textContent = "Sin conexión con el Mac"; await new Promise((r) => setTimeout(r, 1500)); break; }
    animarEscaner(n, false);
  }
  $$(".escaner").forEach((x) => (x.hidden = true));
  $("#progreso-ocr span").textContent = tarea.cancelado ? "OCR detenido" : "Listo: ya puedes subrayar y usar la lupa";
  $("#cancelar-ocr").hidden = true;
  marcarOcr();
  setTimeout(() => { if (ocrEnCurso === null) $("#progreso-ocr").hidden = true; }, 2200);
  ocrEnCurso = null;
}
/* La barra de escáner se muestra sobre la página que se está leyendo, si está a la vista. */
function animarEscaner(n, encender) {
  const v = paginasVisibles();
  for (const lado of ["izq", "der"]) $(`#libro .slot.${lado} .escaner`).hidden = !(encender && v[lado] === n);
}

function actualizarPie() {
  marcarOcr();
  const v = paginasVisibles();
  $("#l-pagina").textContent = quiereDoble() ? `pp. ${Math.max(1, v.izq)}–${Math.min(L.n, v.der)} de ${L.n}` : `p. ${L.pag} de ${L.n}`;
  $("#l-rango").value = L.pag;
  $("#a-pag").textContent = `p. ${L.pag}`;
  const r = item(L.libro.id);
  if (r.pagina !== L.pag) { r.pagina = L.pag; if (L.sesion) L.sesion.hasta = Math.max(L.sesion.hasta, L.pag); guardar(L.libro.id); }
}

async function girar(dir) {
  if (L.girando || !L.pdf) return;
  const doble = quiereDoble();
  const hoja = $("#hoja"), frente = $("#hoja .frente img"), dorso = $("#hoja .dorso img");
  let destino, desde, hasta, origen;
  $$(".capa-texto").forEach((c) => (c.innerHTML = ""));
  getSelection()?.removeAllRanges();
  ocultarTraduccion();
  cerrarMenuMarca();

  if (doble) {
    const iz = izquierda(L.pag);
    if (dir > 0) {
      if (iz + 2 > L.n) return;
      destino = iz + 2;
      poner(frente, await imagen(iz + 1)); poner(dorso, await imagen(iz + 2));
      hoja.style.left = `${L.pw}px`; origen = "left center"; desde = 0; hasta = -180;
      poner($("#libro .slot.der img"), await imagen(iz + 3)); $("#libro .slot.der .marcas").innerHTML = "";
    } else {
      if (iz <= 0) return;
      destino = iz - 1;
      poner(frente, await imagen(iz)); poner(dorso, await imagen(iz - 1));
      hoja.style.left = "0px"; origen = "right center"; desde = 0; hasta = 180;
      poner($("#libro .slot.izq img"), await imagen(iz - 2)); $("#libro .slot.izq .marcas").innerHTML = "";
    }
  } else {
    hoja.style.left = "0px"; origen = "left center";
    if (dir > 0) {
      if (L.pag >= L.n) return;
      destino = L.pag + 1;
      poner(frente, await imagen(L.pag)); poner(dorso, "");
      poner($("#libro .slot.der img"), await imagen(destino)); $("#libro .slot.der .marcas").innerHTML = "";
      desde = 0; hasta = -180;
    } else {
      if (L.pag <= 1) return;
      destino = L.pag - 1;
      poner(frente, await imagen(destino)); poner(dorso, "");
      desde = -180; hasta = 0;
    }
  }
  L.girando = true;
  hoja.style.transformOrigin = origen;
  hoja.style.display = "block";
  const dur = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 650;
  const curva = "cubic-bezier(.45,.05,.35,1)";
  const anim = hoja.animate([{ transform: `rotateY(${desde}deg)` }, { transform: `rotateY(${hasta}deg)` }], { duration: dur, easing: curva });
  $$("#hoja .sombra").forEach((s) => s.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: dur, easing: curva }));
  await anim.finished;
  L.pag = destino;
  const v = paginasVisibles();
  if (doble) poner($("#libro .slot.izq img"), await imagen(v.izq));
  poner($("#libro .slot.der img"), await imagen(v.der));
  hoja.style.display = "none";
  L.girando = false;
  pintarMarcas();
  pintarCapasTexto();
  actualizarPie();
  precargar();
}

async function irA(p) {
  if (!L.pdf) return;
  L.pag = Math.min(Math.max(1, p), L.n);
  await mostrar();
}

/* ---------------- Herramientas: leer · lupa · subrayar ---------------- */
$$(".herramientas .segmento").forEach((b) => b.addEventListener("click", () => cambiarModo(b.dataset.modo)));
function cambiarModo(m) {
  L.modo = m;
  $("#mesa").dataset.modo = m;
  $$(".herramientas .segmento").forEach((x) => x.classList.toggle("activo", x.dataset.modo === m));
  $("#cuadro").hidden = true;
  $("#paleta").hidden = m !== "subrayar";
  cerrarMenuMarca();
  if (m !== "lupa") ocultarTraduccion();
}

/* Texto de una página con su caja, en coordenadas de 0 a 1. */
async function textoDe(n) {
  if (L.textos.has(n)) return L.textos.get(n);
  if (L.ocrHechas?.has(n)) {
    const res = await (await fetch(`api/ocr/${encodeURIComponent(L.libro.id)}/${n}`)).json();
    L.textos.set(n, res.palabras || []);
    return res.palabras || [];
  }
  const pagina = await L.pdf.getPage(n);
  const vp = pagina.getViewport({ scale: 1 });
  const contenido = await pagina.getTextContent();
  const items = contenido.items.filter((it) => it.str && it.str.trim()).map((it) => {
    const t = pdfjsLib.Util.transform(vp.transform, it.transform);
    const alto = Math.hypot(t[2], t[3]) || 10;
    return { s: it.str, x: t[4] / vp.width, y: (t[5] - alto) / vp.height, w: it.width / vp.width, h: (alto * 1.15) / vp.height };
  });
  L.textos.set(n, items);
  return items;
}

/* Los ítems dentro de un rectángulo, agrupados en líneas y en orden de lectura. */
function lineasEn(items, r, criterio = "centro") {
  const dentro = items.filter((it) => {
    if (criterio === "centro") {
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
    }
    const cy = it.y + it.h / 2;
    return cy >= r.y && cy <= r.y + r.h && it.x + it.w >= r.x && it.x <= r.x + r.w;
  });
  dentro.sort((a, b) => a.y - b.y || a.x - b.x);
  const lineas = [];
  for (const it of dentro) {
    const ultima = lineas[lineas.length - 1];
    if (ultima && Math.abs(ultima.y - it.y) < it.h * 0.5) {
      ultima.items.push(it);
      ultima.x1 = Math.min(ultima.x1, it.x); ultima.x2 = Math.max(ultima.x2, it.x + it.w);
      ultima.h = Math.max(ultima.h, it.h);
    } else lineas.push({ y: it.y, h: it.h, x1: it.x, x2: it.x + it.w, items: [it] });
  }
  lineas.forEach((l) => l.items.sort((a, b) => a.x - b.x));
  const texto = lineas.map((l) => l.items.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim()).join(" ")
    .replace(/(\w)- (\w)/g, "$1$2").trim();
  return { lineas, texto };
}

/* Puntero sobre una página: qué hueco, qué página y dónde (0 a 1). */
function ubicar(e) {
  for (const lado of ["izq", "der"]) {
    const slot = $(`#libro .slot.${lado}`);
    const c = slot.getBoundingClientRect();
    if (c.width && e.clientX >= c.left && e.clientX <= c.right && e.clientY >= c.top && e.clientY <= c.bottom) {
      const n = paginasVisibles()[lado];
      if (n < 1 || n > L.n) return null;
      return { lado, n, c, x: (e.clientX - c.left) / c.width, y: (e.clientY - c.top) / c.height };
    }
  }
  return null;
}

let arrastre = null;
const libroEl = $("#libro");
libroEl.addEventListener("pointerdown", (e) => {
  if (L.modo === "leer" || !L.pdf || e.target.closest("#menu-marca")) return;
  // La esquina de la lupa cambia su tamaño.
  if (L.modo === "lupa" && e.target.closest(".tirador") && L.lupaU) {
    e.preventDefault();
    try { libroEl.setPointerCapture(e.pointerId); } catch {}
    arrastre = { tamano: true, x0: e.clientX, y0: e.clientY, w0: LUPA.w, h0: LUPA.h, c: L.lupaU.c };
    return;
  }
  const u = ubicar(e);
  if (!u) return;
  e.preventDefault();
  try { libroEl.setPointerCapture(e.pointerId); } catch {}
  arrastre = { ...u, x0: u.x, y0: u.y };
  if (L.modo === "lupa") moverLupa(u);
  else dibujarSeleccion(arrastre, u);
});
libroEl.addEventListener("pointermove", (e) => {
  if (!arrastre) return;
  const c = arrastre.c;
  if (arrastre.tamano) {
    LUPA.w = Math.min(1, Math.max(0.2, arrastre.w0 + (e.clientX - arrastre.x0) / c.width));
    LUPA.h = Math.min(0.7, Math.max(0.04, arrastre.h0 + (e.clientY - arrastre.y0) / c.height));
    const r = { ...L.lupaR, w: Math.min(LUPA.w, 1 - L.lupaR.x), h: Math.min(LUPA.h, 1 - L.lupaR.y) };
    L.lupaR = r;
    ponerCuadro(L.lupaU, r, "lupa");
    traducirRegion(L.lupaU.n, r);
    return;
  }
  const u = { ...arrastre, x: Math.min(1, Math.max(0, (e.clientX - c.left) / c.width)), y: Math.min(1, Math.max(0, (e.clientY - c.top) / c.height)) };
  if (L.modo === "lupa") moverLupa(u);
  else dibujarSeleccion(arrastre, u);
  arrastre.ultimo = u;
});
libroEl.addEventListener("pointerup", async () => {
  if (!arrastre) return;
  const a = arrastre; arrastre = null;
  if (a.tamano) escribirLocal("lupa", JSON.stringify(LUPA));
  else if (L.modo === "subrayar") await subrayar(a, a.ultimo || a);
  else if (L.modo === "recortar") await recortar(a, a.ultimo || a);
});
libroEl.addEventListener("pointercancel", () => { arrastre = null; if (L.modo !== "lupa") $("#cuadro").hidden = true; });

/* La lupa: un cuadro que sigue el dedo y muestra la traducción de lo que tiene debajo.
   Si la lectura ya está traducida por adelantado, sale al instante y sin conexión. */
const LUPA = { w: 0.62, h: 0.16, ...JSON.parse(leerLocal("lupa") || "{}") };
let esperaLupa;
function moverLupa(u) {
  const r = { x: Math.min(Math.max(0, u.x - LUPA.w / 2), 1 - LUPA.w), y: Math.min(Math.max(0, u.y - LUPA.h - 0.03), 1 - LUPA.h), w: LUPA.w, h: LUPA.h };
  L.lupaU = u; L.lupaR = r;
  ponerCuadro(u, r, "lupa");
  clearTimeout(esperaLupa);
  if (L.trad) traducirRegion(u.n, r);
  else esperaLupa = setTimeout(() => traducirRegion(u.n, r), 450);
}
function ponerCuadro(u, r, clase) {
  const lib = libroEl.getBoundingClientRect();
  const q = $("#cuadro");
  q.className = clase;
  q.hidden = false;
  Object.assign(q.style, { left: `${u.c.left - lib.left + r.x * u.c.width}px`, top: `${u.c.top - lib.top + r.y * u.c.height}px`,
    width: `${r.w * u.c.width}px`, height: `${r.h * u.c.height}px` });
}

/* Bloques traducidos que la lupa toca: basta con cubrir la mitad de una línea del párrafo. */
function bloquesBajo(n, r) {
  const bloques = L.trad?.paginas?.[n] || [];
  return bloques.filter(({ caja: [x, y, w, h] }) => {
    const dy = Math.min(y + h, r.y + r.h) - Math.max(y, r.y);
    const dx = Math.min(x + w, r.x + r.w) - Math.max(x, r.x);
    return dx > 0 && dy >= Math.min(h * 0.5, 0.012);
  });
}

const traducciones = new Map();
let ultimaConsulta = "";
async function traducirRegion(n, r) {
  const guardados = bloquesBajo(n, r);
  if (guardados.length) {
    const clave = guardados.map((b) => b.en).join("|");
    if (clave === ultimaConsulta) return;
    ultimaConsulta = clave;
    return mostrarTraduccion(guardados.map((b) => b.en).join("\n\n"),
      guardados.map((b) => b.es || `[sin traducir] ${b.en}`).join("\n\n"), "Traducida por adelantado");
  }
  if (L.trad) return mostrarTraduccion("", "", "Mueve la lupa sobre el texto.");
  const { texto } = lineasEn(await textoDe(n), r);
  if (!texto) {
    mostrarTraduccion("", "", "Página escaneada: leyendo con OCR…");
    try {
      const res = await (await fetch("api/ocr", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: L.libro.id, p: n, caja: [r.x, r.y, r.w, r.h] }) })).json();
      mostrarTraduccion(res.texto || "", "", res.texto ? "Leído con OCR. Selecciónalo y toca «Traducir» del iPad." : "El OCR no encontró texto aquí.");
    } catch { mostrarTraduccion("", "", "Sin conexión con el Mac."); }
    return;
  }
  if (texto === ultimaConsulta) return;
  ultimaConsulta = texto;
  if (traducciones.has(texto)) return mostrarTraduccion(texto, traducciones.get(texto), "");
  mostrarTraduccion(texto, "", "Traduciendo…");
  try {
    const res = await (await fetch("api/traducir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto }) })).json();
    if (texto !== ultimaConsulta) return;
    if (res.traduccion) { traducciones.set(texto, res.traduccion); mostrarTraduccion(texto, res.traduccion, res.cache ? "guardada" : ""); }
    else mostrarTraduccion(texto, "", res.aviso || "No se pudo traducir.");
  } catch { mostrarTraduccion(texto, "", "Sin conexión con el Mac."); }
}
function mostrarTraduccion(original, traduccion, estado) {
  const tarjeta = $("#traduccion");
  tarjeta.hidden = false;
  // En doble página, la tarjeta va sobre la otra página para no tapar lo que se lee.
  const otra = L.lupaU && quiereDoble() ? $(`#libro .slot.${L.lupaU.lado === "der" ? "izq" : "der"}`).getBoundingClientRect() : null;
  if (otra && otra.width) {
    const mesa = $("#mesa").getBoundingClientRect();
    Object.assign(tarjeta.style, { left: `${otra.left + 12}px`, width: `${otra.width - 24}px`, transform: "none",
      top: `${otra.top - mesa.top + $("#mesa").offsetTop + 12}px`, bottom: "auto", maxHeight: `${otra.height - 24}px` });
  } else tarjeta.removeAttribute("style");
  $("#trad-texto").textContent = traduccion || "";
  $("#trad-texto").hidden = !traduccion;
  $("#trad-original").textContent = original;
  $("#traduccion details").open = !traduccion;
  $("#trad-estado").textContent = estado;
}
function ocultarTraduccion() { $("#traduccion").hidden = true; ultimaConsulta = ""; if (L.modo !== "subrayar") $("#cuadro").hidden = true; }
$("#cerrar-trad").addEventListener("click", () => { ocultarTraduccion(); $("#cuadro").hidden = true; });

/* Subrayar: se arrastra sobre las líneas y se marcan completas, como con un resaltador.
   Cada color tiene un sentido; si la página es un escaneo sin texto, se lee con OCR. */
const COLORES = {
  amarillo: { nombre: "Idea clave", rgba: "rgba(250,204,21,.45)" },
  verde: { nombre: "Definición", rgba: "rgba(74,222,128,.42)" },
  azul: { nombre: "Método o evidencia", rgba: "rgba(96,165,250,.40)" },
  naranja: { nombre: "Para mi examen", rgba: "rgba(251,146,60,.42)" },
  rosa: { nombre: "No entendí", rgba: "rgba(244,114,182,.40)" },
};
let colorActual = leerLocal("color") || "amarillo";
function pintarPaleta() {
  $("#paleta").innerHTML = Object.entries(COLORES).map(([k, c]) =>
    `<button class="muestra${k === colorActual ? " activa" : ""}" data-color="${k}" title="${c.nombre}" aria-label="${c.nombre}" style="--c:${c.rgba}"></button>`).join("")
    + `<span class="paleta-nombre">${COLORES[colorActual].nombre}</span>`;
  $$("#paleta .muestra").forEach((m) => m.addEventListener("click", () => { colorActual = m.dataset.color; escribirLocal("color", colorActual); pintarPaleta(); }));
}
pintarPaleta();

function rectDe(a, u) {
  return { x: Math.min(a.x0, u.x), y: Math.min(a.y0, u.y) - 0.004, w: Math.abs(u.x - a.x0), h: Math.abs(u.y - a.y0) + 0.008 };
}
function dibujarSeleccion(a, u) { ponerCuadro(u, rectDe(a, u), L.modo === "recortar" ? "recorte" : "subrayar"); }

/* Un toque sin arrastrar sobre un subrayado abre su menú: cambiar color o borrar. */
function marcaEn(n, x, y) {
  const subs = item(L.libro.id).subrayados;
  for (let i = subs.length - 1; i >= 0; i--) {
    if (subs[i].p === n && subs[i].rects.some(([rx, ry, rw, rh]) => x >= rx && x <= rx + rw && y >= ry - 0.004 && y <= ry + rh + 0.004)) return subs[i];
  }
  return null;
}

async function subrayar(a, u) {
  $("#cuadro").hidden = true;
  const movio = Math.abs(u.x - a.x0) > 0.01 || Math.abs(u.y - a.y0) > 0.006;
  if (!movio) {
    const m = marcaEn(a.n, a.x0, a.y0);
    return m ? abrirMenuMarca(m, a) : cerrarMenuMarca();
  }
  cerrarMenuMarca();
  const r = rectDe(a, u);
  const { lineas, texto } = lineasEn(await textoDe(a.n), r, "linea");
  let rects, textoFinal, ocr = false;
  if (texto) {
    // Si el arrastre es en una sola línea, se recorta a lo tocado; si abarca varias, se toma el ancho de cada línea.
    const una = lineas.length === 1;
    rects = lineas.map((l) => {
      const x1 = una ? Math.max(l.x1, r.x) : l.x1, x2 = una ? Math.min(l.x2, r.x + r.w) : l.x2;
      return [+x1.toFixed(4), +l.y.toFixed(4), +(x2 - x1).toFixed(4), +l.h.toFixed(4)];
    });
    textoFinal = una ? l1Texto(lineas[0], r) : texto;
  } else {
    // Página escaneada: se marca el área y el Mac la lee con el OCR de Apple.
    rects = [[+r.x.toFixed(4), +r.y.toFixed(4), +r.w.toFixed(4), +r.h.toFixed(4)]];
    textoFinal = "Leyendo con OCR…";
    ocr = true;
  }
  const nueva = { id: Date.now().toString(36), p: a.n, rects, texto: textoFinal, color: colorActual, fecha: ahoraCorto(), ...(ocr && { ocr: true }) };
  item(L.libro.id).subrayados.push(nueva);
  pintarMarcas(); pintarApuntes();
  if (ocr) await leerConOcr(nueva, r);
  guardar(L.libro.id, true);
}

async function leerConOcr(marca, r) {
  try {
    const res = await (await fetch("api/ocr", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: L.libro.id, p: marca.p, caja: [r.x, r.y, r.w, r.h] }) })).json();
    marca.texto = res.texto || "(el OCR no encontró texto en esta zona)";
    if (res.lineas?.length) marca.rects = res.lineas.map((c) => [c[0], c[1] - 0.002, c[2], c[3] + 0.004]);
  } catch { marca.texto = "(sin conexión con el Mac: no se pudo leer con OCR)"; }
  pintarMarcas(); pintarApuntes();
}

function l1Texto(linea, r) {
  return linea.items.filter((i) => i.x + i.w >= r.x && i.x <= r.x + r.w).map((i) => i.s).join(" ").replace(/\s+/g, " ").trim();
}

function abrirMenuMarca(m, a) {
  const menu = $("#menu-marca");
  const lib = libroEl.getBoundingClientRect();
  const [x, y] = m.rects[0];
  menu.innerHTML = Object.entries(COLORES).map(([k, c]) =>
    `<button class="muestra${k === (m.color || "amarillo") ? " activa" : ""}" data-color="${k}" title="${c.nombre}" aria-label="${c.nombre}" style="--c:${c.rgba}"></button>`).join("")
    + `<button class="boton fantasma borrar-marca">Borrar</button>`;
  Object.assign(menu.style, { left: `${a.c.left - lib.left + x * a.c.width}px`, top: `${Math.max(0, a.c.top - lib.top + y * a.c.height - 52)}px` });
  menu.hidden = false;
  $$("#menu-marca .muestra").forEach((b) => b.addEventListener("click", () => {
    m.color = b.dataset.color; guardar(L.libro.id, true); pintarMarcas(); pintarApuntes(); cerrarMenuMarca();
  }));
  $("#menu-marca .borrar-marca").addEventListener("click", () => {
    const subs = item(L.libro.id).subrayados;
    subs.splice(subs.indexOf(m), 1);
    guardar(L.libro.id, true); pintarMarcas(); pintarApuntes(); cerrarMenuMarca();
  });
}
function cerrarMenuMarca() { $("#menu-marca").hidden = true; }

/* Capa de texto invisible sobre cada página, para seleccionar, copiar o usar «Traducir» del iPad.
   Usa el texto del OCR si la página ya se escaneó. */
let turnoCapas = 0;
async function pintarCapasTexto() {
  if (!L.pdf) return;
  const turno = ++turnoCapas;
  const v = paginasVisibles();
  for (const lado of ["izq", "der"]) {
    const capa = $(`#libro .slot.${lado} .capa-texto`);
    const n = v[lado];
    if (!(n >= 1 && n <= L.n) || (lado === "izq" && !quiereDoble())) { capa.innerHTML = ""; continue; }
    const items = await textoDe(n);
    if (turno !== turnoCapas) return;
    llenarCapa(capa, items, L.pw, L.ph);
  }
}
function llenarCapa(capa, items, ancho, alto) {
  capa.innerHTML = items.map((it) =>
    `<span style="left:${it.x * 100}%;top:${it.y * 100}%;font-size:${it.h * alto * 0.86}px" data-w="${it.w * ancho}">${esc(it.s)} </span>`).join("");
  // Cada trozo se estira a su ancho real para que la selección calce con lo que se ve.
  for (const sp of capa.children) {
    const natural = sp.getBoundingClientRect().width;
    if (natural > 0) sp.style.transform = `scaleX(${(+sp.dataset.w / natural).toFixed(3)})`;
  }
}
function htmlMarcas(n) {
  return item(L.libro.id).subrayados.filter((s) => s.p === n).flatMap((s) =>
    s.rects.map(([x, y, w, h]) => `<i style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%;background:${(COLORES[s.color] || COLORES.amarillo).rgba}"></i>`)).join("");
}
const haySeleccion = () => (getSelection()?.toString() || "").trim().length > 0;

function pintarMarcas() {
  if (!L.libro) return;
  const v = paginasVisibles();
  const subs = item(L.libro.id).subrayados;
  for (const lado of ["izq", "der"]) {
    const n = v[lado];
    $(`#libro .slot.${lado} .marcas`).innerHTML = subs.filter((s) => s.p === n).flatMap((s) =>
      s.rects.map(([x, y, w, h]) => `<i style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%;background:${(COLORES[s.color] || COLORES.amarillo).rgba}"></i>`)).join("")
      + (L.zonaCita?.p === n ? (([x, y, w, h]) => `<b class="zona-cita" style="left:${(x - 0.01) * 100}%;top:${(y - 0.006) * 100}%;width:${(w + 0.02) * 100}%;height:${(h + 0.012) * 100}%"><em>Lo que citas</em></b>`)(L.zonaCita.caja) : "");
  }
}

/* ---------------- Recortar figuras, mapas e imágenes ----------------
   Se vuelve a dibujar solo esa zona de la página a alta resolución y se guarda en el Mac. */
async function recortar(a, u) {
  const r = { x: Math.min(a.x0, u.x), y: Math.min(a.y0, u.y), w: Math.abs(u.x - a.x0), h: Math.abs(u.y - a.y0) };
  if (r.w < 0.03 || r.h < 0.02) { $("#cuadro").hidden = true; return; }
  const pagina = await L.pdf.getPage(a.n);
  const base = pagina.getViewport({ scale: 1 });
  const escala = Math.min(5, 2000 / (r.w * base.width));
  const vp = pagina.getViewport({ scale: escala, offsetX: -r.x * base.width * escala, offsetY: -r.y * base.height * escala });
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(r.w * base.width * escala); lienzo.height = Math.round(r.h * base.height * escala);
  await pagina.render({ canvasContext: lienzo.getContext("2d"), viewport: vp }).promise;
  // Destello de cámara sobre la zona recortada.
  $("#cuadro").className = "flash";
  setTimeout(() => ($("#cuadro").hidden = true), 450);
  try {
    const res = await fetch(`api/capturas/${encodeURIComponent(L.libro.id)}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: a.n, caja: [r.x, r.y, r.w, r.h].map((v) => +v.toFixed(4)), imagen: lienzo.toDataURL("image/png") }) });
    if (!res.ok) throw new Error(res.status);
    pintarCapturas(await res.json());
    avisar("Captura guardada · está en Ficha → Capturas");
  } catch { avisar("No se pudo guardar la captura (¿el Mac está encendido?)"); }
}
function avisar(texto) {
  const av = $("#aviso");
  av.textContent = texto; av.hidden = false;
  clearTimeout(avisar.t); avisar.t = setTimeout(() => (av.hidden = true), 2600);
}
async function pintarCapturas(lista) {
  const libro = L.libro;
  if (!lista) { try { lista = await (await fetch(`api/capturas/${encodeURIComponent(libro.id)}`)).json(); } catch { return; } }
  if (L.libro !== libro) return;
  const base = `captura/${encodeURIComponent(libro.id)}/`;
  $("#lista-capturas").innerHTML = lista.length ? [...lista].reverse().map((c) => `
    <figure class="captura">
      <img src="${base}${c.archivo}" alt="Captura de la página ${c.p}" loading="lazy">
      <figcaption class="captura-pie">
        <textarea rows="2" data-archivo="${c.archivo}" placeholder="¿Qué muestra esta figura? ¿Para qué te sirve?">${esc(c.nota || "")}</textarea>
        <div class="captura-acciones"><button data-ir="${c.p}">p. ${c.p}</button>
          <a href="${base}${c.archivo}?descargar=1" download>Descargar</a>
          <button class="borrar" data-borrar="${c.archivo}">Borrar</button></div>
      </figcaption>
    </figure>`).join("")
    : `<p class="vacio">Todavía no hay capturas. Elige «Recortar» arriba y arrastra un rectángulo sobre una figura, un mapa o una tabla.</p>`;
  $$("#lista-capturas [data-ir]").forEach((b) => b.addEventListener("click", () => irA(+b.dataset.ir)));
  $$("#lista-capturas textarea").forEach((ta) => ta.addEventListener("change", () =>
    fetch(`api/capturas/${encodeURIComponent(libro.id)}/nota`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archivo: ta.dataset.archivo, nota: ta.value }) })));
  $$("#lista-capturas [data-borrar]").forEach((b) => b.addEventListener("click", async () =>
    pintarCapturas(await (await fetch(`api/capturas/${encodeURIComponent(libro.id)}/borrar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archivo: b.dataset.borrar }) })).json())));
}

/* ---------------- Gestos de lectura ----------------
   Deslizar o tocar los bordes pasa la hoja; doble toque abre la página ampliada. */
let toque = null;
$("#mesa").addEventListener("touchstart", (e) => { if (e.touches.length === 1) toque = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
$("#mesa").addEventListener("touchend", (e) => {
  if (!toque || L.modo !== "leer" || L.libro?.tipo === "md") return;
  const t = e.changedTouches[0], dx = t.clientX - toque.x, dy = t.clientY - toque.y;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) && !haySeleccion()) { girar(dx < 0 ? 1 : -1); e.preventDefault(); }
  toque = null;
});
$("#mesa").addEventListener("click", (e) => {
  if (L.modo !== "leer" || L.libro?.tipo === "md" || e.target.closest("#traduccion")) return;
  if (haySeleccion()) return; // tocar para soltar la selección no debe pasar la página
  const ahora = Date.now();
  if (ahora - L.ultimoToque < 300) { L.ultimoToque = 0; return ampliar(e); }
  L.ultimoToque = ahora;
  const x = e.clientX / innerWidth;
  setTimeout(() => { if (L.ultimoToque === ahora) { if (x > 0.72) girar(1); else if (x < 0.28) girar(-1); } }, 310);
});
addEventListener("keydown", (e) => {
  if ($("#lector").hidden || /TEXTAREA|SELECT|INPUT/.test(document.activeElement.tagName)) return;
  if (e.key === "ArrowRight") girar(1);
  if (e.key === "ArrowLeft") girar(-1);
});

async function ampliar(e) {
  const u = ubicar(e);
  if (!u) return;
  const pagina = await L.pdf.getPage(u.n);
  const base = pagina.getViewport({ scale: 1 });
  const vp = pagina.getViewport({ scale: (innerWidth * 1.6 * Math.min(devicePixelRatio || 1, 2)) / base.width });
  const c = document.createElement("canvas");
  c.width = vp.width; c.height = vp.height;
  await pagina.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  const img = $("#lupa img");
  img.src = c.toDataURL("image/jpeg", 0.92);
  $("#lupa").hidden = false;
  $("#lupa").scrollTo(0, 0);
  await img.decode().catch(() => {});
  // La misma capa de texto y los mismos subrayados, al tamaño ampliado.
  const hoja = $("#lupa .hoja-ampliada");
  $("#lupa .marcas").innerHTML = htmlMarcas(u.n);
  llenarCapa($("#lupa .capa-texto"), await textoDe(u.n), hoja.clientWidth, hoja.clientHeight);
}
$("#cerrar-lupa").addEventListener("click", () => ($("#lupa").hidden = true));

$("#l-rango").addEventListener("change", (e) => irA(+e.target.value));
$("#b-modo").addEventListener("click", () => { L.doble = !quiereDoble(); maquetar(); L.imgs.clear(); mostrar(); });
let espera;
addEventListener("resize", () => { clearTimeout(espera); espera = setTimeout(() => { if (L.pdf && !$("#lector").hidden) { maquetar(); L.imgs.clear(); mostrar(); } }, 250); });

function cerrarLector() {
  cerrarSesion();
  $("#lector").hidden = true; $("#biblioteca").hidden = false; $("#panel").hidden = true;
  ocultarTraduccion();
  L.pdf = null; L.libro = null; L.doble = null; L.zonaCita = null;
  pintarBiblioteca();
}
$("#volver").addEventListener("click", () => history.back());
addEventListener("popstate", () => { if (!$("#lector").hidden) cerrarLector(); });

/* ---------------- Tiempo de lectura ----------------
   Cuenta solo con la pantalla visible y si hubo actividad en los últimos 5 minutos. */
let ultimaActividad = Date.now();
["pointerdown", "keydown", "scroll"].forEach((ev) => addEventListener(ev, () => (ultimaActividad = Date.now()), { passive: true, capture: true }));
function iniciarSesion() {
  const r = item(L.libro.id);
  L.sesion = { fecha: new Date().toISOString().slice(0, 10), inicio: new Date().toTimeString().slice(0, 5), min: 0, desde: r.pagina || 1, hasta: r.pagina || 1 };
  r.sesiones.push(L.sesion);
  pintarTiempo();
}
function cerrarSesion() {
  if (!L.libro || !L.sesion) return;
  const r = item(L.libro.id);
  if (L.sesion.min < 0.5) r.sesiones = r.sesiones.filter((s) => s !== L.sesion);
  L.sesion = null;
  guardar(L.libro.id, true);
}
setInterval(() => {
  if (!L.sesion || document.hidden || Date.now() - ultimaActividad > 5 * 60000) return;
  const r = item(L.libro.id);
  L.sesion.min += 0.25; r.minutos = (r.minutos || 0) + 0.25;
  pintarTiempo();
  if (L.sesion.min % 1 === 0) guardar(L.libro.id);
}, 15000);
function pintarTiempo() {
  const r = item(L.libro.id);
  $("#l-tiempo").textContent = `${Math.round(L.sesion?.min || 0)} min hoy · ${Math.round(r.minutos || 0)} en total`;
}
document.addEventListener("visibilitychange", () => { if (document.hidden && L.libro) guardar(L.libro.id, true); });

/* ---------------- Panel ---------------- */
$("#b-ficha").addEventListener("click", () => ($("#panel").hidden = !$("#panel").hidden));
$("#cerrar-panel").addEventListener("click", () => ($("#panel").hidden = true));
$$(".pestanas button[data-p]").forEach((b) => b.addEventListener("click", () => {
  $$(".pestanas button[data-p]").forEach((x) => x.classList.toggle("activa", x === b));
  $$("#panel .contenido").forEach((c) => (c.hidden = c.dataset.p !== b.dataset.p));
}));

function pintarPanelExamen() {
  const b = L.libro;
  const caja = $('#panel .contenido[data-p="examen"]');
  const cabeza = b.referencia ? `<h3>Referencia</h3><p class="ref">${esc(b.referencia)}</p>` : "";
  if (!b.en_examen.length) {
    caja.innerHTML = cabeza + `<h3>Dónde lo citas</h3><p class="vacio">${b.estante === "Mi documento" ? "Es tu propio documento." : "No se cita en la versión entregada (v5)."}</p>`;
    return;
  }
  const pintar = (citas) => {
    caja.innerHTML = cabeza + `<h3>Dónde lo citas (${b.en_examen.length})</h3>` + b.en_examen.map((o, i) => {
      const c = citas?.[i];
      let pie = "";
      if (c?.zona) pie = `<button class="ir-cita" data-i="${i}">Ver la zona · p. ${c.zona.p} del PDF${c.impresa ? ` (p. ${c.impresa} impresa)` : ""}</button>`;
      else if (c?.pdf) pie = `<button class="ir-cita" data-i="${i}">Ir a la p. ${c.pdf} del PDF (p. ${c.impresa} impresa)</button>`;
      else if (c) pie = `<span class="cita-general">Cita general · todo el documento</span>`;
      return `<figure class="cita"><blockquote>${esc(o)}</blockquote>${pie}</figure>`;
    }).join("");
    $$(".ir-cita", caja).forEach((x) => x.addEventListener("click", () => irACita(citas[+x.dataset.i])));
  };
  pintar(null);
  fetch(`api/citas/${encodeURIComponent(b.id)}`).then((r) => r.json()).then((citas) => { if (L.libro === b) { L.citas = citas; pintar(citas); } }).catch(() => {});
}

/* Lleva a la página citada y enmarca el párrafo que mejor coincide con la frase del examen. */
async function irACita(c) {
  L.zonaCita = c.zona || null;
  $("#panel").hidden = true; // el panel tapa la página derecha
  await irA(c.zona ? c.zona.p : c.pdf);
}

const CAMPOS = ["afirma", "sostiene", "uso", "dudas"];
function cargarFicha() {
  const r = item(L.libro.id);
  $("#f-estado").value = r.estado;
  CAMPOS.forEach((c) => ($(`#f-${c}`).value = r.ficha[c] || ""));
  pintarApuntes();
}
$("#f-estado").addEventListener("change", (e) => { item(L.libro.id).estado = e.target.value; guardar(L.libro.id, true); });
CAMPOS.forEach((c) => $(`#f-${c}`).addEventListener("input", (e) => { item(L.libro.id).ficha[c] = e.target.value; guardar(L.libro.id); }));

$("#form-apunte").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("#a-texto").value.trim();
  if (!t) return;
  item(L.libro.id).apuntes.push({ p: L.pag, t, fecha: ahoraCorto() });
  $("#a-texto").value = "";
  guardar(L.libro.id, true);
  pintarApuntes();
});
function pintarApuntes() {
  const r = item(L.libro.id);
  const todo = [
    ...r.subrayados.map((s, i) => ({ tipo: "marca", p: s.p, t: s.texto, i, color: s.color || "amarillo" })),
    ...r.apuntes.map((a, i) => ({ tipo: "nota", p: a.p, t: a.t, i })),
  ].sort((a, b) => a.p - b.p);
  $("#lista-apuntes").innerHTML = todo.length ? todo.map((a) => `<li class="${a.tipo}"><button data-ir="${a.p}">p. ${a.p}</button>
      <span class="texto">${a.color ? `<small>${COLORES[a.color].nombre}</small><mark style="--c:${COLORES[a.color].rgba}">${esc(a.t)}</mark>` : esc(a.t)}</span><button class="borrar" data-borrar="${a.tipo}:${a.i}" aria-label="Borrar">Borrar</button></li>`).join("")
    : `<li class="vacio" style="display:block">Todavía no hay subrayados ni notas. Elige «Subrayar» arriba y arrastra sobre las líneas.</li>`;
  $$("#lista-apuntes [data-ir]").forEach((b) => b.addEventListener("click", () => irA(+b.dataset.ir)));
  $$("#lista-apuntes [data-borrar]").forEach((b) => b.addEventListener("click", () => {
    const [tipo, i] = b.dataset.borrar.split(":");
    (tipo === "marca" ? r.subrayados : r.apuntes).splice(+i, 1);
    guardar(L.libro.id, true); pintarApuntes(); pintarMarcas();
  }));
}

// En la versión web, primero el PIN.
if (window.LECTOR_ESTATICO) window.esperarDesbloqueo().then(iniciar);
else iniciar();
