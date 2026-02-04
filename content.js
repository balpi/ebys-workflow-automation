(() => {
  let STOP = true;
  let RUNNING = false;

  const CFG = {
    short: 220,
    mid: 850,
    long: 1600,
    lovPickTimeoutMs: 30000,
    folderCodeRegex: /\b(\d{3}\.\d{2})\b/,
    verbose: true
  };

  let maxDocs = 500;
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
      const tTimeout = setTimeout(() => { obs.disconnect(); reject(new Error("timeout")); }, timeoutMs);

      const done = () => { clearTimeout(tTimeout); obs.disconnect(); resolve(true); };
      const bump = () => { if (tDone) clearTimeout(tDone); tDone = setTimeout(done, quietMs); };

      const obs = new MutationObserver(bump);
      obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

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
    ["mousemove","mouseover","mouseenter","mousedown","mouseup","click"].forEach((type) => {
      el.dispatchEvent(new MouseEvent(type, { bubbles:true, cancelable:true, view:window, clientX:x, clientY:y }));
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
    uniq.sort((a,b) => parseInt(a.textContent,10) - parseInt(b.textContent,10));
    return uniq;
  }

  function getRowsOnPage() {
    return [...document.querySelectorAll("tr.ui-widget-content")].filter(isVisible);
  }

  function extractFolderCodeFromText() {
    const txt = document.body ? document.body.innerText : "";
    const m = txt.match(CFG.folderCodeRegex);
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

  function findTreeClickableByCode(code) {
    const rootLi = document.getElementById("mainPreviewForm:klasorLov_id:lovTree:0");
    if (!rootLi) return null;

    const treeContainer = rootLi.closest("ul")?.parentElement || rootLi.parentElement || rootLi;
    const nodes = [...treeContainer.querySelectorAll("li.ui-treenode.lovTreeNode")];

    const li =
      nodes.find(n => (n.textContent || "").includes(`[Klasör] ${code}`)) ||
      nodes.find(n => (n.textContent || "").includes(code));

    if (!li) return null;

    return (
      li.querySelector("span.ui-treenode-content.ui-tree-selectable") ||
      li.querySelector("span.ui-treenode-content") ||
      li.querySelector(".expandCollapseLovItem") ||
      li
    );
  }

  async function pickTreeByCode(code) {
    const t0 = Date.now();
    while (!STOP && Date.now() - t0 < CFG.lovPickTimeoutMs) {
      await sleep(250);
      const clickable = findTreeClickableByCode(code);
      if (clickable) {
        await click(clickable, { afterWait: true });
        await sleep(160);
        await click(clickable, { afterWait: true });
        return true;
      }
    }
    return false;
  }

  async function processOneRow(row, idx) {
    if (STOP) return false;

    log(`Satır #${idx} tıklanıyor...`);
    await click(row, { afterWait: true });
    await sleep(CFG.mid);

    let code = extractFolderCodeFromText();
    if (!code) {
      await waitForDomQuiet({ quietMs: 350, timeoutMs: 9000 }).catch(() => {});
      code = extractFolderCodeFromText();
    }

    if (!code) {
      warn("Klasör kodu bulunamadı, atlanıyor.");
      const closeBtn = findPreviewCloseButton();
      if (closeBtn) await click(closeBtn, { afterWait: true });
      return true;
    }

    log("Bulunan kod:", code);

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
    lovInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    lovInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));

    const picked = await pickTreeByCode(code);
    if (!picked) {
      warn("Tree seçilemedi:", code);
      return true; // atla devam
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
      maxDocs = st.bn_maxDocs ?? 500;
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

      let rows = getRowsOnPage();
      for (let i = 0; i < rows.length && !STOP; i++) {
        if (processed >= maxDocs) { STOP = true; break; }

        rows = getRowsOnPage();
        const row = rows[i];
        if (!row) continue;

        processed++;
        const ok = await processOneRow(row, processed);
        if (!ok) { STOP = true; break; }
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
