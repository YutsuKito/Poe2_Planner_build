/**
 * app.js — PoE2 Build Planner Import Site
 * Lógica de UI: import XML, preview snapshot, gerar/baixar .build
 */

"use strict";

// ============================================================================
// State
// ============================================================================
const state = {
  importPayload: "",
  importLoading: false,
  importError: null,
  importedSnapshot: null,
  importedWarnings: [],

  importExportLoading: false,
  importExportError: null,
  importExportDraft: null,

  zoomedImage: null,
  zoomedImageAlt: "",

  treeData: null,
  passivesData: null,
  mappingLoaded: false,
};

// ============================================================================
// DOM refs
// ============================================================================
const $ = (id) => document.getElementById(id);

const xmlTextarea = $("xml-textarea");
const importBtn = $("import-btn");
const importError = $("import-error");
const snapshotSection = $("snapshot-section");
const snapshotContent = $("snapshot-content");

const generateExportBtn = $("generate-export-btn");
const exportSection = $("export-section");
const exportContent = $("export-content");
const exportError = $("export-error");
const downloadBtn = $("download-btn");

const modalBackdrop = $("modal-backdrop");
const modalImg = $("modal-img");
const modalCaption = $("modal-caption");
const modalClose = $("modal-close");

// ============================================================================
// Init
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Register ALL event listeners immediately — do NOT await anything here.
  // If DOMContentLoaded is async and we await fetch(), the listeners below
  // would never be set up when fetch() hangs on file:// protocol.

  // Step images click-to-zoom
  document.querySelectorAll(".step-card[data-img]").forEach((card) => {
    card.addEventListener("click", () => {
      openModal(card.dataset.img, card.dataset.alt || "");
    });
  });

  // Modal close handlers
  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // Import button
  importBtn.addEventListener("click", handleImport);

  // Generate export button
  generateExportBtn.addEventListener("click", handleGenerateExport);

  // Download button
  downloadBtn.addEventListener("click", handleDownload);

  // Keep textarea state in sync
  xmlTextarea.addEventListener("input", () => {
    state.importPayload = xmlTextarea.value;
  });

  // Load mapping data (tree.json + passives_default.json) in background — fire and forget.
  // The import works without this data; it only improves passive node mapping.
  ExtractorBrowser.loadMappingData("./")
    .then(({ treeData, passivesData }) => {
      state.treeData = treeData;
      state.passivesData = passivesData;
      state.mappingLoaded = !!(treeData && passivesData);
      if (state.mappingLoaded) {
        console.log("[app] Arquivos de mapeamento carregados com sucesso.");
      }
    })
    .catch((err) => {
      console.warn("[app] Mapeamento de passivas não disponível:", err.message);
    });
});

// ============================================================================
// Image Zoom Modal
// ============================================================================
function openModal(imgSrc, alt) {
  state.zoomedImage = imgSrc;
  state.zoomedImageAlt = alt;
  modalImg.src = imgSrc;
  modalImg.alt = alt;
  modalCaption.textContent = alt;
  modalBackdrop.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  state.zoomedImage = null;
  modalBackdrop.classList.remove("open");
  document.body.style.overflow = "";
  // Delay src clear to avoid flash
  setTimeout(() => {
    if (!state.zoomedImage) modalImg.src = "";
  }, 300);
}

// ============================================================================
// Import Handler
// ============================================================================
async function handleImport() {
  const xmlText = xmlTextarea.value.trim();

  if (!xmlText) {
    showError(importError, "Cole o XML do Path of Building no campo acima.");
    return;
  }

  // Reset previous state
  clearError(importError);
  hideSection(snapshotSection);
  hideSection(exportSection);
  state.importedSnapshot = null;
  state.importExportDraft = null;
  generateExportBtn.disabled = true;
  downloadBtn.disabled = true;

  setLoading(importBtn, true, "Importando...");
  state.importLoading = true;

  // Small artificial delay for UX
  await sleep(400);

  try {
    const { snapshot, warnings } = ExtractorBrowser.parsePobXml(xmlText);
    state.importedSnapshot = snapshot;
    state.importedWarnings = warnings;

    renderSnapshot(snapshot, warnings);
    showSection(snapshotSection);
    generateExportBtn.disabled = false;
    snapshotSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showError(importError, err.message || "Erro ao processar o XML. Verifique se o XML é válido.");
  } finally {
    setLoading(importBtn, false, "Importar Build");
    state.importLoading = false;
  }
}

// ============================================================================
// Snapshot Renderer
// ============================================================================
function getClassEmoji(className) {
  const map = {
    witch: "🧙",
    sorceress: "⚡",
    ranger: "🏹",
    warrior: "⚔️",
    monk: "🥋",
    mercenary: "🔫",
    druid: "🌿",
    huntress: "🐍",
    templar: "✝️",
    shadow: "🗡️",
    marauder: "🪓",
    duelist: "⚔️",
    scion: "⭐",
  };
  return map[(className || "").toLowerCase()] || "🧙";
}

function renderSnapshot(snapshot, warnings) {
  const life = snapshot.life ? Math.round(snapshot.life) : 0;
  const es = snapshot.energyShield ? Math.round(snapshot.energyShield) : 0;
  const armour = snapshot.armour ? Math.round(snapshot.armour) : 0;
  const evasion = snapshot.evasion ? Math.round(snapshot.evasion) : 0;

  const fireRes = snapshot.fireRes ?? 0;
  const coldRes = snapshot.coldRes ?? 0;
  const lightRes = snapshot.lightningRes ?? 0;
  const chaosRes = snapshot.chaosRes ?? -60;

  const skillSetups = snapshot.skillSetups || [];
  const allSkills = skillSetups.map((s) => s.mainSkill);
  const passiveCount = snapshot.passiveTree?.totalPoints ?? 0;
  const itemCount = snapshot.equippedItems?.length ?? 0;

  function resBar(val, type) {
    const pct = Math.max(0, Math.min(100, val + 60)) / 160 * 100;
    const capped = val >= 75;
    const neg = val < 0;
    const cls = neg ? "negative" : capped ? "capped" : "";
    return `
      <div class="res-item">
        <span class="res-label">${
          { fire: "Fogo", cold: "Frio", lightning: "Raio", chaos: "Caos" }[type]
        }</span>
        <div class="res-bar-wrap">
          <div class="res-bar ${type}" style="width:${pct}%"></div>
        </div>
        <span class="res-value ${type} ${cls}">${val > 0 ? "+" : ""}${Math.round(val)}%</span>
      </div>
    `;
  }

  function skillTags() {
    if (allSkills.length === 0) return '<span style="color:var(--text-muted);font-size:0.82rem">Nenhuma skill detectada</span>';
    return allSkills.map((s, i) =>
      `<span class="skill-tag ${i === 0 ? "main" : ""}">${s}</span>`
    ).join("");
  }

  function warnHtml() {
    if (!warnings || warnings.length === 0) return "";
    return `
      <div class="alert alert-warning" style="margin-top:0">
        <span class="alert-icon">⚠️</span>
        <ul class="warnings-list" style="margin:0">
          ${warnings.map((w) => `<li>${escHtml(w)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  snapshotContent.innerHTML = `
    <div class="snapshot-card">
      <div class="snapshot-identity">
        <div class="class-badge">${getClassEmoji(snapshot.className)}</div>
        <div class="identity-info">
          <h3>${escHtml(snapshot.className)}${snapshot.ascendancy ? ` — ${escHtml(snapshot.ascendancy)}` : ""}</h3>
          <div class="meta">Level ${snapshot.level} &nbsp;·&nbsp; ${passiveCount} passivas &nbsp;·&nbsp; ${itemCount} itens equipados</div>
        </div>
      </div>

      <div class="snapshot-grid">
        <div class="stat-group">
          <div class="stat-group-title">Defesas</div>
          <div class="stat-row">
            <span class="stat-label">❤️ Vida</span>
            <span class="stat-value life">${life.toLocaleString()}</span>
          </div>
          ${es > 0 ? `<div class="stat-row">
            <span class="stat-label">🔷 Escudo de Energia</span>
            <span class="stat-value es">${es.toLocaleString()}</span>
          </div>` : ""}
          ${armour > 0 ? `<div class="stat-row">
            <span class="stat-label">🛡️ Armadura</span>
            <span class="stat-value">${armour.toLocaleString()}</span>
          </div>` : ""}
          ${evasion > 0 ? `<div class="stat-row">
            <span class="stat-label">💨 Evasão</span>
            <span class="stat-value">${evasion.toLocaleString()}</span>
          </div>` : ""}
        </div>

        <div class="stat-group">
          <div class="stat-group-title">Resistências</div>
          <div class="res-list">
            ${resBar(fireRes, "fire")}
            ${resBar(coldRes, "cold")}
            ${resBar(lightRes, "lightning")}
            ${resBar(chaosRes, "chaos")}
          </div>
        </div>
      </div>

      <div class="stat-group">
        <div class="stat-group-title">Habilidades Detectadas</div>
        <div class="skills-list" style="margin-top:8px">${skillTags()}</div>
      </div>

      ${warnHtml()}

      <div class="alert alert-success">
        <span class="alert-icon">✅</span>
        <span>Build importada com sucesso! Agora gere o arquivo <strong>.build</strong> abaixo.</span>
      </div>
    </div>
  `;
}

// ============================================================================
// Generate Export Handler
// ============================================================================
async function handleGenerateExport() {
  if (!state.importedSnapshot) return;

  clearError(exportError);
  hideSection(exportSection);
  downloadBtn.disabled = true;

  setLoading(generateExportBtn, true, "Gerando...");
  state.importExportLoading = true;

  await sleep(350);

  try {
    const draft = ExtractorBrowser.generateBuildExport(
      state.importedSnapshot,
      state.treeData,
      state.passivesData
    );
    state.importExportDraft = draft;

    renderExportDraft(draft);
    showSection(exportSection);
    downloadBtn.disabled = false;
    exportSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showError(exportError, err.message || "Erro ao gerar o arquivo .build.");
  } finally {
    setLoading(generateExportBtn, false, "Gerar Arquivo .build");
    state.importExportLoading = false;
  }
}

// ============================================================================
// Export Draft Renderer
// ============================================================================
function renderExportDraft(draft) {
  const ex = draft.export;
  const passivesCount = ex.passives?.length ?? 0;
  const skillsCount = ex.skills?.length ?? 0;
  const itemsCount = ex.inventory_slots?.length ?? 0;

  function warningsHtml() {
    if (!draft.warnings || draft.warnings.length === 0) return "";
    return `
      <ul class="warnings-list" style="margin-bottom: 14px;">
        ${draft.warnings.map((w) => `<li>${escHtml(w)}</li>`).join("")}
      </ul>
    `;
  }

  exportContent.innerHTML = `
    <div class="export-preview">
      <div class="export-filename">
        <span style="font-size:0.82rem;color:var(--text-muted)">Arquivo:</span>
        <span class="filename-badge">📄 ${escHtml(draft.filename)}</span>
      </div>

      <div class="export-meta">
        <div class="export-meta-item">⚔️ Ascendência: <strong>${escHtml(ex.ascendancy || "—")}</strong></div>
        <div class="export-meta-item">🌀 Passivas: <strong>${passivesCount} nós</strong></div>
        <div class="export-meta-item">✨ Skills: <strong>${skillsCount} setups</strong></div>
        <div class="export-meta-item">🎽 Itens: <strong>${itemsCount} slots</strong></div>
      </div>

      <div class="stat-group-title" style="margin-bottom:6px">Descrição</div>
      <div class="export-description">${escHtml(ex.description || "")}</div>

      ${warningsHtml()}

      <div class="alert alert-info" style="font-size:0.84rem">
        <span class="alert-icon">ℹ️</span>
        <span>Arquivo pronto para download. Clique em <strong>Baixar .build</strong> e copie para a pasta do jogo.</span>
      </div>
    </div>
  `;
}

// ============================================================================
// Download Handler
// ============================================================================
function handleDownload() {
  if (!state.importExportDraft) return;

  const { filename, export: officialBuild } = state.importExportDraft;

  // Remove internal metadata keys that shouldn't go in the final file
  const fileContent = JSON.stringify(officialBuild, null, 2);
  const blob = new Blob([fileContent], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Release memory
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  // Visual feedback
  const orig = downloadBtn.innerHTML;
  downloadBtn.innerHTML = `<span>✅</span> Baixando...`;
  setTimeout(() => {
    downloadBtn.innerHTML = orig;
  }, 2000);
}

// ============================================================================
// UI Helpers
// ============================================================================
function setLoading(btn, loading, label) {
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${label}`;
  } else {
    btn.disabled = false;
    btn.innerHTML = label;
  }
}

function showError(el, msg) {
  el.innerHTML = `<span class="alert-icon">❌</span> ${escHtml(msg)}`;
  el.classList.remove("hidden");
}

function clearError(el) {
  el.innerHTML = "";
  el.classList.add("hidden");
}

function showSection(el) {
  el.classList.remove("hidden");
}

function hideSection(el) {
  el.classList.add("hidden");
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
