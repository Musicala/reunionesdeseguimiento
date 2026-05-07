'use strict';

console.log("APP JS CARGÓ ✅ (remejorado sin romper)");

// Firestore
import {
  collection, addDoc, doc, getDoc, updateDoc,
  query, orderBy, limit, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { db } from "./firebase.js";
import { buildPrompt } from "./prompt.js";

/* =============================
   TEMPLATES / CONFIG
============================= */

const TEMPLATES = {
  admin: {
    key: "admin",
    label: "Administrativos",
    titleSuffix: "Admin",
    sections: [
      { key:"agradecimiento", title:"Agradecimiento por el trabajo hasta la fecha" },
      { key:"retroEstudiantes", title:"Seguimiento de retroalimentaciones de estudiantes" },
      { key:"retroAdmin", title:"Seguimiento de retroalimentaciones administrativas (Musicala)" },
      { key:"distintivos", title:"Uso de distintivos (chaqueta, carnet)" },
      { key:"puntualidad", title:"Puntualidad y registro de jornadas" },
      { key:"bitacora", title:"Bitácora de tareas" },
      { key:"kpis", title:"KPI's" },
      { key:"proyeccion", title:"Proyección" },
      { key:"palabrasTrabajador", title:"Palabras del trabajador" },
      { key:"mejorasCargo", title:"Retroalimentaciones y puntos de mejora en el cargo" },
      { key:"bienestar", title:"Espacios de bienestar" },
    ]
  },
  docente: {
    key: "docente",
    label: "Docentes",
    titleSuffix: "Docente",
    sections: [
      { key:"agradecimiento", title:"Agradecimiento por el trabajo hasta la fecha" },
      { key:"retroEstudiantes", title:"Seguimiento de retroalimentaciones de estudiantes" },
      { key:"retroAdmin", title:"Seguimiento de retroalimentaciones administrativas (Musicala)" },
      { key:"distintivos", title:"Uso de distintivos (chaqueta, carnet)" },
      { key:"puntualidad", title:"Puntualidad y registro de jornadas" },
      { key:"bitacora", title:"Bitácora de tareas" },
      { key:"registroClases", title:"Registro de clases" },
      { key:"muestrasProceso", title:"Muestras de proceso" },
      { key:"proyeccion", title:"Proyección" },
      { key:"palabrasDocente", title:"Palabras del docente" },
      { key:"mejorasCargo", title:"Retroalimentaciones y puntos de mejora en el cargo" },
      { key:"bienestar", title:"Espacios de bienestar" },
    ]
  }
};

const STATUS_OPTIONS = [
  "🟢 Bien",
  "🟡 En proceso",
  "🔴 Por mejorar",
  "⚪ No aplica"
];

const ACTION_STATUS = ["pendiente", "en progreso", "listo"];

function defaultSectionConfig(templateKey = "admin"){
  const tpl = TEMPLATES[templateKey] || TEMPLATES.admin;
  return tpl.sections.map((s, index) => ({
    key: s.key,
    title: s.title,
    description: s.description || "",
    enabled: true,
    visible: true,
    applies: true,
    archived: false,
    custom: false,
    order: index
  }));
}

function allDefaultSections(){
  return Object.values(TEMPLATES).flatMap(t => t.sections);
}

function normalizeSectionConfig(meeting){
  const templateKey = templateFromMeeting(meeting);
  const defaults = defaultSectionConfig(templateKey);
  const incoming = Array.isArray(meeting?.sectionConfig) ? meeting.sectionConfig : [];
  const byKey = new Map();
  const defaultKeys = new Set(defaults.map(def => def.key));

  incoming.forEach((item, index) => {
    const key = safeTrim(item?.key);
    if (!key) return;
    const def = defaults.find(d => d.key === key);
    const visible = item?.visible !== false && item?.enabled !== false;
    const custom = item?.custom === true || !defaultKeys.has(key);
    byKey.set(key, {
      key,
      title: safeTrim(item?.title) || def?.title || key,
      description: safeTrim(item?.description || item?.guide || def?.description || ""),
      enabled: visible,
      visible,
      applies: item?.applies !== false,
      archived: item?.archived === true,
      custom,
      order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index
    });
  });

  defaults.forEach(def => {
    if (!byKey.has(def.key)) byKey.set(def.key, def);
  });

  return Array.from(byKey.values())
    .filter(item => item.archived !== true)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((item, index) => ({ ...item, order: index }));
}

function getSectionTitleByKey(meeting, key){
  const cfg = Array.isArray(meeting?.sectionConfig) ? meeting.sectionConfig : defaultSectionConfig(templateFromMeeting(meeting));
  const custom = cfg.find(s => s.key === key);
  if (custom?.title) return custom.title;
  const fallback = allDefaultSections().find(s => s.key === key);
  return fallback?.title || key;
}

/* =============================
   STATE
============================= */
let currentMeetingId = null;
let currentMeeting = null;
let saveTimer = null;
let dirty = false;
let lastMeetingList = [];
let lastSaveError = null;

/* =============================
   DOM
============================= */
const $ = id => document.getElementById(id);

// Top / List
const savePill = $("savePill");
const meetingList = $("meetingList");
const emptyList = $("emptyList");
const qEmployee = $("qEmployee");
const noMeetingState = $("noMeetingState");
const meetingOnlyCards = Array.from(document.querySelectorAll(".meetingOnly"));

// Form
const fDate = $("fDate");
const fPeriod = $("fPeriod");
const fEmployeeName = $("fEmployeeName");
const fRole = $("fRole");
const fArea = $("fArea");
const fAttendees = $("fAttendees");

// New fields (si existen)
const fTemplate = $("fTemplate");
const fPlace = $("fPlace");
const appModeLabel = $("appModeLabel");

// Buttons
const btnNew = $("btnNew");
const btnNewEmpty = $("btnNewEmpty");
const btnCopyPrompt = $("btnCopyPrompt");
const btnFinalize = $("btnFinalize");
const btnUnfinalize = $("btnUnfinalize");
const btnClearLocal = $("btnClearLocal");

// Optional helpers
const btnExpandAll = $("btnExpandAll");
const btnCollapseAll = $("btnCollapseAll");
const btnConfigureSections = $("btnConfigureSections");
const btnCopyActions = $("btnCopyActions");
const btnRefreshPrompt = $("btnRefreshPrompt");
const btnSelectPrompt = $("btnSelectPrompt");

// Sections / Actions / Prompt
const sectionsWrap = $("sectionsWrap");
const actionsList = $("actionsList");
const actionsEmpty = $("actionsEmpty");
const promptPreview = $("promptPreview");

// Meta tags
const meetingIdTag = $("meetingIdTag");
const statusTag = $("statusTag");

// Toast
const toast = $("toast");

/* =============================
   HELPERS
============================= */
const isoToday = () => new Date().toISOString().slice(0, 10);

function setPill(state, msg){
  const map = {
    ok: "🟢 Guardado",
    saving: "🟡 Guardando…",
    offline: "🔴 Sin conexión",
    idle: "⚪ Listo",
    error: "🔴 Error"
  };
  if (!savePill) return;
  savePill.textContent = msg || map[state] || "⚪ Listo";
}

function showToast(msg){
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 2400);
}

function renderEmptyState(){
  const hasMeeting = !!currentMeetingId && !!currentMeeting;

  noMeetingState?.classList.toggle("hidden", hasMeeting);
  meetingOnlyCards.forEach(card => card.classList.toggle("hidden", !hasMeeting));

  if (!hasMeeting){
    meetingIdTag?.classList.add("hidden");
    statusTag && (statusTag.textContent = "sin reunión");
    if (appModeLabel) appModeLabel.textContent = "Sin reunión";
    if (promptPreview) promptPreview.value = "";
    if (sectionsWrap) sectionsWrap.innerHTML = "";
    if (actionsList) actionsList.innerHTML = "";
    actionsEmpty?.classList.remove("hidden");
    if (btnCopyPrompt) btnCopyPrompt.disabled = true;
    if (btnCopyActions) btnCopyActions.disabled = true;
    if (btnFinalize) btnFinalize.disabled = true;
    if (btnUnfinalize) btnUnfinalize.disabled = true;
  }
}

function escapeHtml(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

function safeTrim(s){ return (s ?? "").toString().trim(); }

function parseAttendees(text){
  const raw = (text ?? "").split(",").map(x => x.trim()).filter(Boolean);
  return Array.from(new Set(raw));
}

function templateFromMeeting(m){
  const t = safeTrim(m?.template).toLowerCase();
  return TEMPLATES[t] ? t : "admin";
}

function getTemplate(){ return templateFromMeeting(currentMeeting); }

function getSectionDefs(){
  if (!currentMeeting) return defaultSectionConfig("admin");
  return normalizeSectionConfig(currentMeeting).filter(s => s.visible !== false && s.enabled !== false && s.archived !== true);
}

function getAllSectionDefsForConfig(){
  if (!currentMeeting) return defaultSectionConfig("admin");
  return normalizeSectionConfig(currentMeeting);
}

function nowId(){
  return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
}

function makeSectionKey(title, existingKeys = []){
  const base = safeTrim(title)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "nueva-seccion";
  const taken = new Set(existingKeys);
  let key = `custom-${base}`;
  while (taken.has(key)){
    key = `custom-${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`;
  }
  return key;
}

function isSectionNoAplica(sec){
  return safeTrim(sec?.status).toLowerCase().includes("no aplica");
}

function normalizeAction(a, sectionKey, sectionTitle){
  const base = {
    id: a?.id || nowId(),
    title: safeTrim(a?.title || ""),
    owner: safeTrim(a?.owner || ""),
    dueDateISO: safeTrim(a?.dueDateISO || ""),
    status: ACTION_STATUS.includes(a?.status) ? a.status : "pendiente",
    details: safeTrim(a?.details || ""),
    sectionKey: sectionKey || safeTrim(a?.sectionKey || ""),
    sectionTitle: sectionTitle || safeTrim(a?.sectionTitle || "")
  };
  if (typeof a === "string") base.title = safeTrim(a);
  return base;
}

function ensureSectionShape(sec){
  const out = {
    status: safeTrim(sec?.status) || "⚪ No aplica",
    notes: (sec?.notes ?? "").toString(),
    actions: Array.isArray(sec?.actions) ? sec.actions : []
  };
  if (!STATUS_OPTIONS.includes(out.status)) out.status = "⚪ No aplica";
  return out;
}

function ensureMeetingSections(m){
  const config = normalizeSectionConfig(m);
  const defsAll = allDefaultSections();
  const allKeys = Array.from(new Set([
    ...defsAll.map(s => s.key),
    ...config.map(s => s.key),
    ...Object.keys(m.sections || {})
  ]));

  const sections = { ...(m.sections || {}) };
  allKeys.forEach(k => { sections[k] = ensureSectionShape(sections[k]); });

  allKeys.forEach(k => {
    sections[k].actions = (sections[k].actions || []).map(a =>
      normalizeAction(a, k, getSectionTitleByKey(m, k))
    );
  });

  return sections;
}

/* =============================
   LOCAL DRAFT
============================= */
const localKey = () => currentMeetingId ? `acta_draft_${currentMeetingId}` : null;

function saveLocalDraft(){
  if (!currentMeetingId || !currentMeeting) return;
  try{
    localStorage.setItem(localKey(), JSON.stringify(currentMeeting));
  }catch(e){
    console.warn("Local draft failed:", e);
  }
}

function loadLocalDraft(id){
  try{
    const raw = localStorage.getItem(`acta_draft_${id}`);
    return raw ? JSON.parse(raw) : null;
  }catch{
    return null;
  }
}

function clearLocalDraft(){
  if (!currentMeetingId) return;
  localStorage.removeItem(localKey());
  showToast("Borrador local eliminado ✅");
}

/* =============================
   DATA MODEL  (FIX: sin recursión)
============================= */
function makeBaseMeeting(template = "admin"){
  const t = TEMPLATES[template] ? template : "admin";

  const sections = {};
  const allDefs = Object.values(TEMPLATES).flatMap(x => x.sections);
  allDefs.forEach(s => { sections[s.key] = { status:"⚪ No aplica", notes:"", actions:[] }; });

  return {
    status: "draft",
    template: t,
    dateISO: isoToday(),
    periodLabel: "",
    employeeName: "",
    role: "",
    area: "administrativa",
    attendees: [],
    attendeesText: "",
    place: "",
    sectionConfig: defaultSectionConfig(t),
    sections,
    actionItems: []
  };
}

function makeEmptyMeeting(overrides = {}){
  const template = TEMPLATES[overrides.template] ? overrides.template : "admin";
  return { ...makeBaseMeeting(template), ...overrides };
}

function normalizeMeeting(m){
  const t = templateFromMeeting(m);
  const base = makeBaseMeeting(t);
  const out = { ...base, ...(m || {}) };

  out.template = templateFromMeeting(out);
  out.sectionConfig = normalizeSectionConfig(out);

  out.attendeesText = (out.attendeesText ?? "").toString();
  out.attendees = Array.isArray(out.attendees) ? out.attendees : parseAttendees(out.attendeesText);
  if (!out.attendeesText && out.attendees.length) out.attendeesText = out.attendees.join(", ");

  out.dateISO = safeTrim(out.dateISO) || isoToday();
  out.place = (out.place ?? "").toString();

  out.sections = ensureMeetingSections(out);
  out.actionItems = consolidateActions(out);

  return out;
}

function mergeMeeting(remote, local){
  const merged = {
    ...(remote || {}),
    ...(local || {}),
    sections: { ...((remote && remote.sections) || {}), ...((local && local.sections) || {}) }
  };
  return normalizeMeeting(merged);
}

/* =============================
   SAVE (debounce + flush)
============================= */
function debounceSave(){
  // OJO: si no hay reunión abierta, no hay a dónde guardar.
  // Prefiero avisarte a mentirte.
  if (!currentMeetingId || !currentMeeting) {
    setPill("idle", "⚪ Abre o crea una reunión");
    return;
  }

  dirty = true;
  saveLocalDraft();
  setPill(navigator.onLine ? "saving" : "offline");

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow({ silentOk: true }), 900);
}

/**
 * Guardado inmediato (local siempre; remoto si hay conexión)
 * @param {object} opts
 * @param {string} opts.reason - Mensaje para toast
 * @param {boolean} opts.silentOk - no mostrar toast en ok
 */
async function saveNow(opts = {}){
  const { reason = "", silentOk = false } = opts;

  if (!currentMeetingId || !currentMeeting){
    showToast("Primero abre o crea una reunión 🙃");
    return false;
  }

  // Guardar local YA
  dirty = true;
  saveLocalDraft();

  // Recalcular consolidado antes de mandar
  currentMeeting.actionItems = consolidateActions(currentMeeting);

  // Sin conexión: quedamos en local
  if (!navigator.onLine){
    setPill("offline", "🔴 Sin conexión (guardado local)");
    if (reason) showToast(`${reason} (local) ✅`);
    return true;
  }

  // Guardar remoto YA
  setPill("saving");
  try{
    await saveRemote();
    if (!silentOk) {
      if (reason) showToast(`${reason} ✅`);
      else showToast("Guardado ✅");
    }
    return true;
  }catch(e){
    // saveRemote ya pone pill error, pero acá dejamos rastro
    console.error(e);
    lastSaveError = e;
    showToast("Error guardando (quedó local) ⚠️");
    return false;
  }
}

async function saveRemote(){
  if (!navigator.onLine || !currentMeetingId || !currentMeeting) return;

  const ref = doc(db, "meetings", currentMeetingId);

  currentMeeting.actionItems = consolidateActions(currentMeeting);

  const payload = { ...currentMeeting };
  delete payload.createdAt;

  try{
    await updateDoc(ref, {
      ...payload,
      updatedAt: serverTimestamp()
    });

    dirty = false;
    setPill("ok");
    lastSaveError = null;
  }catch(e){
    console.error(e);
    setPill("error");
    lastSaveError = e;
    throw e;
  }
}

/* =============================
   FIRESTORE
============================= */
async function listMeetings(){
  try{
    const q = query(
      collection(db, "meetings"),
      orderBy("updatedAt", "desc"),
      limit(50)
    );
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    lastMeetingList = items;
    renderMeetingList(items);
  }catch(err){
    console.error(err);
    setPill("error");
    showToast("Error cargando reuniones");
  }
}

async function createMeeting(){
  // Si hay cambios sin guardar, los empujamos antes de crear otra
  if (dirty && currentMeetingId && currentMeeting){
    await saveNow({ reason: "Guardado antes de crear nueva", silentOk: true });
  }

  if (!navigator.onLine){
    showToast("Sin conexión. No puedo crear reunión en Firestore. (Tu borrador local sí se guarda) ⚠️");
    return;
  }

  const suggestedTemplate = (fArea && fArea.value === "academica") ? "docente" : "admin";
  const base = normalizeMeeting(makeEmptyMeeting({ template: suggestedTemplate }));

  try{
    const ref = await addDoc(collection(db, "meetings"), {
      ...base,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await openMeeting(ref.id);
    await listMeetings();
    showToast("Reunión creada ✅");
  }catch(e){
    console.error(e);
    showToast("No se pudo crear la reunión");
    setPill("error");
  }
}

async function openMeeting(id){
  currentMeetingId = id;

  meetingIdTag?.classList.remove("hidden");
  if (meetingIdTag) meetingIdTag.textContent = `ID: ${id}`;
  setPill("saving", "🟡 Cargando…");

  try{
    const ref = doc(db, "meetings", id);
    const snap = await getDoc(ref);
    if (!snap.exists()){
      setPill("error");
      showToast("La reunión no existe");
      return;
    }

    const remote = snap.data();
    const local = loadLocalDraft(id);
    currentMeeting = local ? mergeMeeting(remote, local) : normalizeMeeting(remote);

    renderAll();
    saveLocalDraft();
    dirty = false;
    setPill("ok");
    btnCopyPrompt && (btnCopyPrompt.disabled = false);
  }catch(e){
    console.error(e);
    setPill("error");
    showToast("Error abriendo la reunión");
  }
}

/* =============================
   RENDER LIST
============================= */
function renderMeetingList(items){
  if (!meetingList) return;

  meetingList.innerHTML = "";

  if (!items.length){
    emptyList && emptyList.classList.remove("hidden");
    return;
  }
  emptyList && emptyList.classList.add("hidden");

  items.forEach(m => {
    const el = document.createElement("div");
    el.className = "item";

    const t = templateFromMeeting(m);
    const tLabel = TEMPLATES[t]?.label || "Administrativos";
    const st = (m.status || "draft").toString();

    el.innerHTML = `
      <div class="row1">
        <div class="name">${escapeHtml(m.employeeName || "—")}</div>
        <div class="date">${escapeHtml(m.dateISO || "—")}</div>
      </div>
      <div class="row2">
        <div class="metaSmall">${escapeHtml(m.role || "")}</div>
        <div class="metaSmall">${escapeHtml(tLabel)} · ${escapeHtml(st)}</div>
      </div>
    `;

    el.onclick = () => openMeeting(m.id);
    meetingList.appendChild(el);
  });
}

function applyMeetingListFilter(){
  const q = safeTrim(qEmployee?.value || "").toLowerCase();
  if (!q) return renderMeetingList(lastMeetingList);

  const filtered = lastMeetingList.filter(m => {
    const name = (m.employeeName || "").toString().toLowerCase();
    const role = (m.role || "").toString().toLowerCase();
    const period = (m.periodLabel || "").toString().toLowerCase();
    return name.includes(q) || role.includes(q) || period.includes(q);
  });

  renderMeetingList(filtered);
}

/* =============================
   RENDER FORM
============================= */
function renderAll(){
  renderEmptyState();
  if (!currentMeetingId || !currentMeeting) return;

  statusTag && (statusTag.textContent = currentMeeting.status);
  if (appModeLabel) appModeLabel.textContent = TEMPLATES[getTemplate()].titleSuffix;

  fDate && (fDate.value = currentMeeting.dateISO);
  fPeriod && (fPeriod.value = currentMeeting.periodLabel);
  fEmployeeName && (fEmployeeName.value = currentMeeting.employeeName);
  fRole && (fRole.value = currentMeeting.role);
  fArea && (fArea.value = currentMeeting.area);
  fAttendees && (fAttendees.value = currentMeeting.attendeesText);
  fTemplate && (fTemplate.value = getTemplate());
  fPlace && (fPlace.value = currentMeeting.place || "");

  const isFinal = currentMeeting.status === "final";
  if (btnFinalize) btnFinalize.disabled = isFinal || !currentMeetingId;
  if (btnUnfinalize) btnUnfinalize.disabled = !isFinal || !currentMeetingId;

  renderSections();
  renderActionsAndPrompt();
}

function renderSections(){
  if (!sectionsWrap || !currentMeeting) return;

  sectionsWrap.innerHTML = "";

  const defs = getSectionDefs();

  defs.forEach(def => {
    const sec = currentMeeting.sections[def.key] || ensureSectionShape(null);
    currentMeeting.sections[def.key] = sec;

    const card = document.createElement("div");
    card.className = "section";
    card.dataset.key = def.key;

    const header = document.createElement("div");
    header.className = "sectionHead";

    const title = document.createElement("div");
    title.className = "sectionTitle";
    title.textContent = def.title;
    if (def.description){
      const hint = document.createElement("div");
      hint.className = "sectionHint";
      hint.textContent = def.description;
      title.appendChild(hint);
    }

    const controls = document.createElement("div");
    controls.className = "sectionControls";

    // Status select
    const sel = document.createElement("select");
    sel.className = "input selectStatus";

    STATUS_OPTIONS.forEach(o => {
      const op = document.createElement("option");
      op.value = o;
      op.textContent = o;
      sel.appendChild(op);
    });

    sel.value = sec.status;
    sel.onchange = () => {
      sec.status = sel.value;
      debounceSave();
      renderActionsAndPrompt();
    };
    sel.onblur = () => saveNow({ reason: "Estado guardado", silentOk: true });

    // ✅ Botón Guardar sección (flush inmediato)
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn small";
    saveBtn.textContent = "Guardar sección";
    saveBtn.onclick = async () => {
      await saveNow({ reason: "Sección guardada" });
      // refrescamos el prompt por si acaso
      renderActionsAndPrompt();
    };

    // Toggle
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "btn small ghost";
    toggleBtn.textContent = "Contraer";
    toggleBtn.onclick = () => toggleSectionBody(def.key);

    controls.append(sel, saveBtn, toggleBtn);
    header.append(title, controls);

    const body = document.createElement("div");
    body.className = "sectionBody";
    body.dataset.open = "1";

    const ta = document.createElement("textarea");
    ta.className = "textarea";
    ta.rows = 4;
    ta.placeholder = "Notas de esta sección…";
    ta.value = sec.notes;

    ta.oninput = () => {
      sec.notes = ta.value;
      debounceSave();
      renderActionsAndPrompt();
    };
    // flush al salir del campo (móvil friendly)
    ta.onblur = () => saveNow({ reason: "Notas guardadas", silentOk: true });

    // Acuerdos por sección
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "secActions";

    const actionsHead = document.createElement("div");
    actionsHead.className = "secActionsHead";

    const actionsTitle = document.createElement("div");
    actionsTitle.className = "secActionsTitle";
    actionsTitle.textContent = "Acuerdos de esta sección";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn small";
    addBtn.textContent = "+ Agregar acuerdo";
    addBtn.onclick = () => {
      addAction(def.key, def.title);
      renderSections();
      renderActionsAndPrompt();
      debounceSave();
    };

    actionsHead.append(actionsTitle, addBtn);

    const actionsListLocal = document.createElement("div");
    actionsListLocal.className = "secActionsList";

    if (!sec.actions.length){
      const empty = document.createElement("div");
      empty.className = "emptySmall";
      empty.textContent = "Sin acuerdos por ahora.";
      actionsListLocal.appendChild(empty);
    } else {
      sec.actions.forEach(action => {
        actionsListLocal.appendChild(renderActionRow(def.key, def.title, action));
      });
    }

    actionsWrap.append(actionsHead, actionsListLocal);

    body.append(ta, actionsWrap);

    card.append(header, body);
    sectionsWrap.appendChild(card);
  });
}

function toggleSectionBody(sectionKey, forceOpen = null){
  const node = sectionsWrap?.querySelector(`.section[data-key="${CSS.escape(sectionKey)}"] .sectionBody`);
  // OJO: ahora hay varios botones. Buscamos específicamente el ghost toggle.
  const btn = sectionsWrap?.querySelector(`.section[data-key="${CSS.escape(sectionKey)}"] .sectionControls .btn.ghost`);
  if (!node) return;

  const open = node.dataset.open === "1";
  const next = forceOpen === null ? !open : !!forceOpen;

  node.dataset.open = next ? "1" : "0";
  node.style.display = next ? "" : "none";
  if (btn) btn.textContent = next ? "Contraer" : "Expandir";
}

/* =============================
   ACTIONS
============================= */
function addAction(sectionKey, sectionTitle){
  const sec = currentMeeting.sections[sectionKey];
  if (!sec) return;

  sec.actions = Array.isArray(sec.actions) ? sec.actions : [];
  sec.actions.push(normalizeAction({
    id: nowId(),
    title: "",
    owner: "",
    dueDateISO: "",
    status: "pendiente",
    details: ""
  }, sectionKey, sectionTitle));
}

function deleteAction(sectionKey, actionId){
  const sec = currentMeeting.sections[sectionKey];
  if (!sec?.actions) return;
  sec.actions = sec.actions.filter(a => a.id !== actionId);
}

function consolidateActions(m){
  const out = [];
  const defs = normalizeSectionConfig(m).filter(s =>
    s.enabled !== false &&
    s.visible !== false &&
    s.applies !== false &&
    s.archived !== true
  );

  defs.forEach(s => {
    const sec = m.sections?.[s.key];
    if (!sec || isSectionNoAplica(sec)) return;

    (sec.actions || []).forEach(a => {
      const norm = normalizeAction(a, s.key, s.title);

      const hasContent =
        !!safeTrim(norm.title) ||
        !!safeTrim(norm.owner) ||
        !!safeTrim(norm.dueDateISO) ||
        !!safeTrim(norm.details);

      if (hasContent) out.push(norm);
    });
  });

  return out;
}

function renderActionRow(sectionKey, sectionTitle, action){
  const a = normalizeAction(action, sectionKey, sectionTitle);

  const row = document.createElement("div");
  row.className = "actionRow";

  const title = document.createElement("input");
  title.className = "input";
  title.placeholder = "Acuerdo / acción";
  title.value = a.title;
  title.oninput = () => { a.title = title.value; syncAction(sectionKey, a); };
  title.onblur = () => saveNow({ silentOk: true });

  const owner = document.createElement("input");
  owner.className = "input";
  owner.placeholder = "Responsable";
  owner.value = a.owner;
  owner.oninput = () => { a.owner = owner.value; syncAction(sectionKey, a); };
  owner.onblur = () => saveNow({ silentOk: true });

  const due = document.createElement("input");
  due.className = "input";
  due.type = "date";
  due.value = a.dueDateISO || "";
  due.oninput = () => { a.dueDateISO = due.value; syncAction(sectionKey, a); };
  due.onblur = () => saveNow({ silentOk: true });

  const st = document.createElement("select");
  st.className = "input";
  ACTION_STATUS.forEach(s => {
    const op = document.createElement("option");
    op.value = s;
    op.textContent = s;
    st.appendChild(op);
  });
  st.value = a.status;
  st.onchange = () => { a.status = st.value; syncAction(sectionKey, a); };
  st.onblur = () => saveNow({ silentOk: true });

  const details = document.createElement("textarea");
  details.className = "textarea";
  details.rows = 2;
  details.placeholder = "Detalles (opcional)";
  details.value = a.details;
  details.oninput = () => { a.details = details.value; syncAction(sectionKey, a); };
  details.onblur = () => saveNow({ silentOk: true });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn small ghost";
  del.textContent = "Eliminar";
  del.onclick = () => {
    deleteAction(sectionKey, a.id);
    renderSections();
    renderActionsAndPrompt();
    debounceSave();
  };

  const grid = document.createElement("div");
  grid.className = "actionGrid";
  grid.append(title, owner, due, st);

  row.append(grid, details, del);
  return row;
}

function syncAction(sectionKey, actionObj){
  const sec = currentMeeting.sections[sectionKey];
  if (!sec?.actions) return;

  const idx = sec.actions.findIndex(x => (x.id || "") === actionObj.id);
  if (idx >= 0) sec.actions[idx] = actionObj;
  else sec.actions.push(actionObj);

  renderActionsAndPrompt();
  debounceSave();
}

function renderActionsAndPrompt(){
  if (!currentMeeting) return;

  const actions = consolidateActions(currentMeeting);
  currentMeeting.actionItems = actions;

  actionsEmpty && actionsEmpty.classList.toggle("hidden", actions.length > 0);
  actionsList && actionsList.classList.toggle("hidden", actions.length === 0);

  if (actionsList){
    actionsList.innerHTML = "";
    actions.forEach(a => {
      const item = document.createElement("div");
      item.className = "actionItem";
      item.innerHTML = `
        <div class="actionTop">
          <div class="actionTitle">${escapeHtml(a.title || "—")}</div>
          <div class="actionMeta">${escapeHtml(a.status)}${a.dueDateISO ? " · " + escapeHtml(a.dueDateISO) : ""}</div>
        </div>
        <div class="actionSub">
          <div class="actionSec">${escapeHtml(a.sectionTitle || a.sectionKey || "")}</div>
          <div class="actionOwner">${escapeHtml(a.owner || "")}</div>
        </div>
        ${a.details ? `<div class="actionDetails">${escapeHtml(a.details)}</div>` : ``}
      `;
      actionsList.appendChild(item);
    });
  }

  if (btnCopyActions) btnCopyActions.disabled = actions.length === 0;

  if (promptPreview){
    try{
      promptPreview.value = buildPrompt({ ...currentMeeting, actionItems: actions });
    }catch(err){
      console.error("Prompt build failed:", err);
      promptPreview.value = "⚠️ Error creando el prompt. Revisa prompt.js.";
      setPill("error");
    }
  }

  if (btnCopyPrompt) btnCopyPrompt.disabled = !currentMeetingId;
}

/* =============================
   SECTION CONFIG MODAL
============================= */
function openSectionsConfigModal(){
  if (!currentMeetingId || !currentMeeting){
    showToast("Primero crea o abre una reunion");
    return;
  }

  let draft = getAllSectionDefsForConfig().map(x => ({ ...x }));

  const backdrop = document.createElement("div");
  backdrop.className = "modalBackdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "modalPanel sectionConfigPanel";

  const close = () => backdrop.remove();

  const title = document.createElement("div");
  title.className = "modalTitle";
  title.textContent = "Configurar secciones";

  const desc = document.createElement("p");
  desc.className = "muted";
  desc.textContent = "Edita el nombre, la descripcion, el orden, la visibilidad y si cada seccion aplica para esta reunion. Las secciones ocultas o No aplica no saldran en el acta.";

  const addBox = document.createElement("div");
  addBox.className = "configAddBox";

  const addTitle = document.createElement("input");
  addTitle.className = "input";
  addTitle.placeholder = "Nombre de la nueva seccion";

  const addDescription = document.createElement("textarea");
  addDescription.className = "textarea";
  addDescription.rows = 2;
  addDescription.placeholder = "Descripcion o guia interna opcional";

  const addOrder = document.createElement("input");
  addOrder.className = "input";
  addOrder.type = "number";
  addOrder.min = "1";
  addOrder.placeholder = "Orden";

  const addSection = document.createElement("button");
  addSection.type = "button";
  addSection.className = "btn";
  addSection.textContent = "+ Agregar seccion";

  addBox.append(addTitle, addDescription, addOrder, addSection);

  const rows = document.createElement("div");
  rows.className = "configRows";

  function renderRows(){
    rows.innerHTML = "";

    draft.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "configRow";

      const visible = document.createElement("input");
      visible.type = "checkbox";
      visible.checked = item.visible !== false && item.enabled !== false;
      visible.title = "Mostrar esta seccion";
      visible.onchange = () => {
        item.visible = visible.checked;
        item.enabled = visible.checked;
      };

      const input = document.createElement("input");
      input.className = "input";
      input.value = item.title;
      input.placeholder = "Nombre de la seccion";
      input.oninput = () => { item.title = input.value; };

      const description = document.createElement("textarea");
      description.className = "textarea configDescription";
      description.rows = 2;
      description.value = item.description || "";
      description.placeholder = "Descripcion o guia interna opcional";
      description.oninput = () => { item.description = description.value; };

      const appliesWrap = document.createElement("label");
      appliesWrap.className = "configCheck";
      const applies = document.createElement("input");
      applies.type = "checkbox";
      applies.checked = item.applies !== false;
      applies.onchange = () => { item.applies = applies.checked; };
      appliesWrap.append(applies, document.createTextNode(" Aplica"));

      const up = document.createElement("button");
      up.type = "button";
      up.className = "btn small ghost";
      up.textContent = "Subir";
      up.disabled = index === 0;
      up.onclick = () => {
        [draft[index - 1], draft[index]] = [draft[index], draft[index - 1]];
        renderRows();
      };

      const down = document.createElement("button");
      down.type = "button";
      down.className = "btn small ghost";
      down.textContent = "Bajar";
      down.disabled = index === draft.length - 1;
      down.onclick = () => {
        [draft[index + 1], draft[index]] = [draft[index], draft[index + 1]];
        renderRows();
      };

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn small ghost";
      remove.textContent = item.custom ? "Quitar" : "Ocultar";
      remove.onclick = () => {
        if (item.custom){
          item.archived = true;
          item.visible = false;
          item.enabled = false;
          draft = draft.filter(x => x.key !== item.key);
          renderRows();
          return;
        }
        item.visible = false;
        item.enabled = false;
        visible.checked = false;
      };

      const label = document.createElement("div");
      label.className = "configKey";
      label.textContent = item.custom ? item.key + " - personalizada" : item.key;

      row.append(visible, input, description, appliesWrap, up, down, remove, label);
      rows.appendChild(row);
    });
  }

  addSection.onclick = () => {
    const sectionTitle = safeTrim(addTitle.value);
    if (!sectionTitle){
      showToast("Escribe el nombre de la nueva seccion");
      addTitle.focus();
      return;
    }

    const key = makeSectionKey(sectionTitle, [
      ...draft.map(x => x.key),
      ...Object.keys(currentMeeting.sections || {})
    ]);

    const newSection = {
      key,
      title: sectionTitle,
      description: safeTrim(addDescription.value),
      enabled: true,
      visible: true,
      applies: true,
      archived: false,
      custom: true,
      order: draft.length
    };

    const desiredOrder = Number(addOrder.value);
    if (Number.isFinite(desiredOrder) && desiredOrder > 0){
      draft.splice(Math.min(desiredOrder - 1, draft.length), 0, newSection);
    } else {
      draft.push(newSection);
    }

    addTitle.value = "";
    addDescription.value = "";
    addOrder.value = "";
    renderRows();
  };

  const actions = document.createElement("div");
  actions.className = "row modalActions";

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "btn ghost";
  reset.textContent = "Restablecer plantilla";
  reset.onclick = () => {
    draft = defaultSectionConfig(getTemplate()).map(x => ({ ...x }));
    renderRows();
  };

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn ghost";
  cancel.textContent = "Cancelar";
  cancel.onclick = close;

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "btn primary";
  apply.textContent = "Guardar cambios";
  apply.onclick = async () => {
    currentMeeting.sectionConfig = draft.map((item, index) => ({
      key: item.key,
      title: safeTrim(item.title) || getSectionTitleByKey(currentMeeting, item.key),
      description: safeTrim(item.description || ""),
      enabled: item.visible !== false && item.enabled !== false,
      visible: item.visible !== false && item.enabled !== false,
      applies: item.applies !== false,
      archived: item.archived === true,
      custom: item.custom === true,
      order: index
    }));

    currentMeeting.sectionConfig.forEach(cfg => {
      if (!currentMeeting.sections[cfg.key]) currentMeeting.sections[cfg.key] = ensureSectionShape(null);
      const sec = currentMeeting.sections?.[cfg.key];
      if (!sec?.actions) return;
      sec.actions = sec.actions.map(a => normalizeAction(a, cfg.key, cfg.title));
    });

    currentMeeting = normalizeMeeting(currentMeeting);
    renderAll();
    await saveNow({ reason: "Configuracion de secciones guardada" });
    close();
  };

  actions.append(reset, document.createElement("div"), cancel, apply);
  actions.children[1].className = "spacer";

  modal.append(title, desc, addBox, rows, actions);
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });
  document.body.appendChild(backdrop);

  renderRows();
  addTitle.focus();
}

/* =============================
   FORM + EVENTS
============================= */
function bindForm(){
  if (fDate) {
    fDate.oninput = () => {
      if (!currentMeeting) return;
      currentMeeting.dateISO = fDate.value || isoToday();
      debounceSave();
      renderActionsAndPrompt();
    };
    fDate.onblur = () => saveNow({ silentOk: true });
  }

  if (fPeriod) {
    fPeriod.oninput = () => {
      if (!currentMeeting) return;
      currentMeeting.periodLabel = fPeriod.value;
      debounceSave();
      renderActionsAndPrompt();
    };
    fPeriod.onblur = () => saveNow({ silentOk: true });
  }

  if (fEmployeeName) {
    fEmployeeName.oninput = () => {
      if (!currentMeeting) return;
      currentMeeting.employeeName = fEmployeeName.value;
      debounceSave();
    };
    fEmployeeName.onblur = () => saveNow({ reason: "Datos generales guardados", silentOk: true });
  }

  if (fRole) {
    fRole.oninput = () => {
      if (!currentMeeting) return;
      currentMeeting.role = fRole.value;
      debounceSave();
    };
    fRole.onblur = () => saveNow({ silentOk: true });
  }

  if (fArea) {
    fArea.onchange = () => {
      if (!currentMeeting) return;
      currentMeeting.area = fArea.value;

      // Auto-template: si cambian a académica, sugerimos docente
      if (currentMeeting.template === "admin" && fArea.value === "academica"){
        currentMeeting.template = "docente";
        currentMeeting.sectionConfig = normalizeSectionConfig(currentMeeting);
        if (fTemplate) fTemplate.value = "docente";
        renderAll();
      }

      debounceSave();
    };
    fArea.onblur = () => saveNow({ silentOk: true });
  }

  if (fAttendees) {
    fAttendees.oninput = () => {
      if (!currentMeeting) return;
      currentMeeting.attendeesText = fAttendees.value;
      currentMeeting.attendees = parseAttendees(fAttendees.value);
      debounceSave();
    };
    fAttendees.onblur = () => saveNow({ silentOk: true });
  }

  if (fTemplate) {
    fTemplate.onchange = () => {
      if (!currentMeeting) return;
      const next = TEMPLATES[fTemplate.value] ? fTemplate.value : "admin";
      currentMeeting.template = next;
      currentMeeting.sectionConfig = normalizeSectionConfig(currentMeeting);
      renderAll();
      debounceSave();
    };
    fTemplate.onblur = () => saveNow({ silentOk: true });
  }

  if (fPlace) {
    fPlace.oninput = () => {
      if (!currentMeeting) return;
      currentMeeting.place = fPlace.value;
      debounceSave();
    };
    fPlace.onblur = () => saveNow({ silentOk: true });
  }
}

async function setStatus(next){
  if (!currentMeetingId || !currentMeeting) {
    showToast("Primero abre una reunión");
    return;
  }
  currentMeeting.status = next;
  renderAll();
  await saveNow({ reason: next === "final" ? "Marcada como FINAL" : "Volvió a DRAFT" });
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    showToast("Copiado ✅");
  }catch{
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("Copiado ✅");
  }
}

function wireButtons(){
  btnNew && (btnNew.onclick = createMeeting);
  btnNewEmpty && (btnNewEmpty.onclick = createMeeting);
  btnConfigureSections && (btnConfigureSections.onclick = openSectionsConfigModal);
  btnClearLocal && (btnClearLocal.onclick = clearLocalDraft);

  btnFinalize && (btnFinalize.onclick = () => setStatus("final"));
  btnUnfinalize && (btnUnfinalize.onclick = () => setStatus("draft"));

  btnCopyPrompt && (btnCopyPrompt.onclick = () => promptPreview && copyText(promptPreview.value || ""));

  btnCopyActions && (btnCopyActions.onclick = () => {
    if (!currentMeeting) return;
    const actions = consolidateActions(currentMeeting);
    const txt = actions.map(a => {
      const parts = [
        `• ${a.title || "—"}`,
        a.owner ? `Resp: ${a.owner}` : "",
        a.dueDateISO ? `Fecha: ${a.dueDateISO}` : "",
        a.status ? `Estado: ${a.status}` : "",
        a.sectionTitle ? `Sección: ${a.sectionTitle}` : ""
      ].filter(Boolean).join(" | ");
      return parts;
    }).join("\n");
    copyText(txt);
  });

  btnRefreshPrompt && (btnRefreshPrompt.onclick = () => renderActionsAndPrompt());

  btnSelectPrompt && (btnSelectPrompt.onclick = () => {
    if (!promptPreview) return;
    promptPreview.focus();
    promptPreview.select();
  });

  btnExpandAll && (btnExpandAll.onclick = () => getSectionDefs().forEach(s => toggleSectionBody(s.key, true)));
  btnCollapseAll && (btnCollapseAll.onclick = () => getSectionDefs().forEach(s => toggleSectionBody(s.key, false)));
}

function wireSearch(){
  if (!qEmployee) return;
  qEmployee.oninput = () => applyMeetingListFilter();
}

window.onbeforeunload = e => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = "";
};

window.addEventListener("online", () => {
  if (!currentMeetingId) return setPill("idle");
  setPill(dirty ? "saving" : "idle");
});
window.addEventListener("offline", () => setPill("offline"));

/* =============================
   INIT
============================= */
(async function init(){
  setPill("idle");

  bindForm();
  wireButtons();
  wireSearch();

  // Estado inicial: sin reunión abierta.
  // No mostramos campos editables si no hay un documento guardable abierto.
  currentMeetingId = null;
  currentMeeting = null;
  renderAll();
  btnCopyPrompt && (btnCopyPrompt.disabled = true);

  await listMeetings();
})();

