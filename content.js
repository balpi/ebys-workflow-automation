(() => {
  let STOP = true;
  let RUNNING = false;

  const CFG = {
    short: 220,
    mid: 850,
    long: 1600,
    lovPickTimeoutMs: 30000,
    verbose: true
  };

  let maxDocs = 50;
  let speed = 1.0;

  const log = (...a) => CFG.verbose && console.log("[BN]", ...a);
  const warn = (...a) => console.warn("[BN]", ...a);

  console.log("[BN] content.js enjekte edildi");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (speed || 1.0)));

  function isVisible(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function waitForDomQuiet({ quietMs = 350, timeoutMs = 12000 } = {}) {
    return new Promise((resolve, reject) => {
      let tDone = null;
      const bump = () => {
        if (tDone) clearTimeout(tDone);
        tDone = setTimeout(done, quietMs);
      };
      const obs = new MutationObserver(bump);
      const tTimeout = setTimeout(() => {
        obs.disconnect();
        reject(new Error("timeout"));
      }, timeoutMs);

      const done = () => {
        clearTimeout(tTimeout);
        obs.disconnect();
        resolve(true);
      };

      obs.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });

      bump();
    });
  }

  async function waitFor(fn, { timeoutMs = 15000, intervalMs = 150 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (STOP) return null;
      const v = fn();
      if (v) return v;
      await sleep(intervalMs);
    }
    return null;
  }

  function realMouseClick(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(Math.max(r.width / 2, 5), r.width - 5);
    const y = r.top + Math.min(Math.max(r.height / 2, 5), r.height - 5);
    ["mousemove", "mouseover", "mouseenter", "mousedown", "mouseup", "click"].forEach((type) => {
      el.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y })
      );
    });
  }

  async function click(el, { afterWait = true } = {}) {
    if (!el || STOP) return false;
    el.scrollIntoView({ block: "center", inline: "center" });
    await sleep(CFG.short);
    realMouseClick(el);
    await sleep(140);
    realMouseClick(el);

    if (afterWait) {
      await waitForDomQuiet({ quietMs: 350, timeoutMs: 15000 }).catch(() => {});
      await sleep(CFG.short);
    }
    return true;
  }

  function fireInput(el, value) {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: " " }));
  }

  function getPaginatorPages() {
    const pages = [...document.querySelectorAll("a.ui-paginator-page")].filter(isVisible);
    const map = new Map();
    for (const p of pages) {
      const t = (p.textContent || "").trim();
      if (!t) continue;
      if (!map.has(t)) map.set(t, p);
    }
    const uniq = [...map.values()];
    uniq.sort((a, b) => parseInt(a.textContent, 10) - parseInt(b.textContent, 10));
    return uniq;
  }

  function getRowsOnPage() {
    const tbody = document.getElementById("mainInboxForm:inboxDataTable_data");
    if (!tbody) return [];

    const rows = [...tbody.querySelectorAll("tr.ui-datatable-selectable[data-ri]")];

    return rows.filter((r) => {
      if (!isVisible(r)) return false;
      const hasKonu = !!r.querySelector(".ui-inbox-satir1");
      const hasKayit = (r.innerText || "").includes("Kayıt Tarihi / Sayı:");
      return hasKonu && hasKayit;
    });
  }

  // ✅ KODU SADECE TIKLANAN SATIRDAN ÇEK (E-...-803-... => 803)
  function extractFolderCodeFromRow(row) {
  if (!row) return null;

  const txt = row.innerText || "";

  const m = txt.match(/E-\d+-((?:\d{3}(?:\.\d{2}){0,2}))-\d+/);
  return m ? m[1] : null;
}

  function findPreviewCloseButton() {
    const a = [...document.querySelectorAll("button[aria-label='Evrak Kapat']")].find(isVisible);
    if (a) return a;
    return [...document.querySelectorAll("button")].find((b) => isVisible(b) && /Evrak Kapat/i.test(b.innerText || ""));
  }

  function findLovInput() {
    return document.getElementById("mainPreviewForm:klasorLov_id:LovText");
  }

  function findFinalCloseButton() {
    return document.getElementById("mainPreviewForm:onaysizKapatId");
  }

  // ✅ LOV Açık mı? Değilse input yanındaki trigger’a tıkla
  async function ensureLovOpen() {
    const rootLi = document.getElementById("mainPreviewForm:klasorLov_id:lovTree:0");
    if (rootLi && isVisible(rootLi)) return true;

    const input = findLovInput();
    if (!input) return false;

    const container = input.closest(".ui-lov") || input.closest("span") || input.parentElement;
    const trigger = (container && container.querySelector("button, a")) || document.querySelector("[id*='klasorLov_id'][onclick]");

    if (trigger) {
      await click(trigger, { afterWait: true });
      await sleep(300);
      await waitForDomQuiet({ quietMs: 300, timeoutMs: 8000 }).catch(() => {});
    }

    const rootLi2 = document.getElementById("mainPreviewForm:klasorLov_id:lovTree:0");
    return !!(rootLi2 && isVisible(rootLi2));
  }

  function findTreeClickableByCode(code) {
    const rootLi = document.getElementById("mainPreviewForm:klasorLov_id:lovTree:0");
    if (!rootLi) return null;

    const treeContainer =
      rootLi.closest(".ui-tree") ||
      rootLi.closest("ul")?.parentElement ||
      rootLi.parentElement ||
      rootLi;

    const nodes = [...treeContainer.querySelectorAll("li.ui-treenode.lovTreeNode")];

    const codeStr = String(code);
    // 803 veya 803.00 gibi varyasyonlar
    const re = new RegExp(`\\b${codeStr}(?:\\.\\d{2})?\\b`);

    let li =
      nodes.find((n) => (n.textContent || "").includes(`[Klasör] ${codeStr}`)) ||
      nodes.find((n) => re.test((n.textContent || "")));

    if (!li) return null;

    const label =
      li.querySelector("span.ui-treenode-label") ||
      li.querySelector(".expandCollapseLovItem") ||
      li.querySelector("span.ui-treenode-content.ui-tree-selectable") ||
      li.querySelector("span.ui-treenode-content") ||
      li;

    return { li, target: label };
  }

  async function pickTreeByCode(code) {
    const t0 = Date.now();

    await waitForDomQuiet({ quietMs: 300, timeoutMs: 8000 }).catch(() => {});
    await sleep(350);

    while (!STOP && Date.now() - t0 < CFG.lovPickTimeoutMs) {
      await sleep(250);

      const found = findTreeClickableByCode(code);
      if (!found) continue;

      const { li, target } = found;

      (target || li).scrollIntoView({ block: "center", inline: "center" });
      await sleep(120);

      await click(target || li, { afterWait: false });
      await sleep(180);
      await click(target || li, { afterWait: false });
      await sleep(250);

      const selected =
        li.getAttribute("aria-selected") === "true" ||
        li.classList.contains("ui-treenode-selected") ||
        li.classList.contains("ui-treenode-highlight") ||
        li.querySelector(".ui-treenode-content")?.getAttribute("aria-selected") === "true";

      if (selected) {
        await waitForDomQuiet({ quietMs: 350, timeoutMs: 12000 }).catch(() => {});
        return true;
      }
    }

    return false;
  }

  async function processOneRow(row, idx) {
    if (STOP) return false;

    log(`Satır #${idx} tıklanıyor...`);
    const clickTarget =
    row.querySelector(".searchText") ||
    row.querySelector("h3.ui-inbox-satir1") ||
    row;

    await click(clickTarget, { afterWait: true });
    await sleep(CFG.mid);

    // ✅ SADECE ROW-SCOPED KOD
    let code = extractFolderCodeFromRow(row);

    if (!code) {
      warn("Satırdan kod çekilemedi (row-scoped). Atlanıyor.");
      const closeBtn0 = findPreviewCloseButton();
      if (closeBtn0) await click(closeBtn0, { afterWait: true });
      return true;
    }

    log("Bulunan kod (row-scoped):", code);

    const closeBtn = await waitFor(() => {
      const b = findPreviewCloseButton();
      return b && isVisible(b) ? b : null;
    }, { timeoutMs: 20000 });
    if (!closeBtn) return false;

    await click(closeBtn, { afterWait: true });

    const lovInput = await waitFor(() => {
      const i = findLovInput();
      return i && isVisible(i) ? i : null;
    }, { timeoutMs: 20000 });
    if (!lovInput) return false;

    fireInput(lovInput, code);

    // ✅ Enter tetiklemesini güçlendir
    lovInput.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 })
    );
    lovInput.dispatchEvent(
      new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 })
    );

    await sleep(600);
    await waitForDomQuiet({ quietMs: 350, timeoutMs: 12000 }).catch(() => {});

    // ✅ LOV açık değilse aç
    const lovOk = await ensureLovOpen();
    if (!lovOk) {
      warn("LOV tree açılamadı (root görünmüyor).");
      return true;
    }

    const picked = await pickTreeByCode(code);
    if (!picked) {
      warn("Tree seçilemedi:", code);
      return true;
    }

    const finalBtn = await waitFor(() => {
      const b = findFinalCloseButton();
      return b && isVisible(b) ? b : null;
    }, { timeoutMs: 20000 });
    if (!finalBtn) return false;

    await click(finalBtn, { afterWait: true });
    await sleep(CFG.long);
    await waitForDomQuiet({ quietMs: 350, timeoutMs: 15000 }).catch(() => {});
    return true;
  }

  async function runLoop() {
    if (RUNNING) return;
    RUNNING = true;
    STOP = false;

    try {
      const st = await chrome.storage.local.get(["bn_maxDocs", "bn_speed"]);
      maxDocs = st.bn_maxDocs ?? 50;
      speed = st.bn_speed ?? 1.0;
    } catch (_) {}

    log("Başladı", { maxDocs, speed });

    let processed = 0;

    let pages = getPaginatorPages();
    if (pages.length === 0) pages = [null];

    for (let p = 0; p < pages.length && !STOP; p++) {
      if (pages[p]) {
        log("Sayfa:", (pages[p].textContent || "").trim());
        await click(pages[p], { afterWait: true });
        await sleep(CFG.mid);
      }

      while (!STOP && processed < maxDocs) {
  let rows = getRowsOnPage();
  if (!rows.length) break;

  const row = rows[0]; // ✅ her zaman en üstteki evrak
  processed++;

  const ok = await processOneRow(row, processed);
  if (!ok) { STOP = true; break; }

  // küçük bir bekleme bazen PrimeFaces refresh için şart
  await sleep(CFG.mid);

      }

      pages = getPaginatorPages();
      if (pages.length === 0) pages = [null];
    }

    RUNNING = false;
    log("Bitti. İşlenen:", processed);
  }

  function stopLoop() {
    STOP = true;
    log("STOP alındı.");
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "BN_START") runLoop();
    if (msg?.type === "BN_STOP") stopLoop();
  });
})();
