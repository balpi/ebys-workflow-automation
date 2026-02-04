async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(running) {
  const el = document.getElementById("status");
  el.textContent = running ? "WORKING" : "STOPPED";
  el.style.color = running ? "green" : "crimson";
}

async function loadState() {
  const st = await chrome.storage.local.get(["bn_running", "bn_maxDocs", "bn_speed"]);
  setStatus(!!st.bn_running);
  document.getElementById("maxDocs").value = st.bn_maxDocs ?? 500;
  document.getElementById("speed").value = st.bn_speed ?? 1.0;
}

async function saveConfigFromUI() {
  const bn_maxDocs = parseInt(document.getElementById("maxDocs").value || "500", 10);
  const bn_speed = parseFloat(document.getElementById("speed").value || "1.0");
  await chrome.storage.local.set({ bn_maxDocs, bn_speed });
}

async function injectMainPatch(tabId) {
  //  Patch MAIN world'de çalışacak
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      if (window.__bn_main_patch_installed) return;
      window.__bn_main_patch_installed = true;

      // 1) focusLovLastSelectedItem NOOP (configurable:false ama writable:true => direkt atama OK)
      const noop = function () { return null; };

      const forceNoop = () => {
        try {
          if (typeof window.focusLovLastSelectedItem === "function" &&
              window.focusLovLastSelectedItem !== noop) {
            window.focusLovLastSelectedItem = noop;
            // console.log("[BN-MAIN] focusLovLastSelectedItem NOOPlandı");
          }
        } catch (_) {}
      };

      forceNoop();
      window.__bn_noop_timer = window.__bn_noop_timer || setInterval(forceNoop, 250);

      // 2) PrimeFaces callback
      const hardWrapPF = () => {
        try {
          if (!window.PrimeFaces) return;

          const wrapCfg = (cfg) => {
            if (!cfg || typeof cfg !== "object") return;
            for (const k in cfg) {
              if (!k.startsWith("on")) continue;
              if (typeof cfg[k] !== "function") continue;
              if (cfg[k].__bn_wrapped) continue;
              const orig = cfg[k];
              const safe = function (...args) {
                try { return orig.apply(this, args); }
                catch (e) { return null; }
              };
              safe.__bn_wrapped = true;
              cfg[k] = safe;
            }
          };

          // ab
          if (typeof PrimeFaces.ab === "function" && !PrimeFaces.ab.__bn_wrapped) {
            const o = PrimeFaces.ab;
            const w = function (cfg, ext) { wrapCfg(cfg); return o.call(this, cfg, ext); };
            w.__bn_wrapped = true;
            PrimeFaces.ab = w;
          }

          // Request.handle/send
          const req = PrimeFaces.ajax && PrimeFaces.ajax.Request;
          if (req && typeof req.handle === "function" && !req.handle.__bn_wrapped) {
            const o = req.handle;
            const w = function (cfg, ext) { wrapCfg(cfg); return o.call(this, cfg, ext); };
            w.__bn_wrapped = true;
            req.handle = w;
          }
          if (req && typeof req.send === "function" && !req.send.__bn_wrapped) {
            const o = req.send;
            const w = function (cfg, ext) { wrapCfg(cfg); return o.call(this, cfg, ext); };
            w.__bn_wrapped = true;
            req.send = w;
          }
        } catch (_) {}
      };

      hardWrapPF();
      window.__bn_pf_timer = window.__bn_pf_timer || setInterval(hardWrapPF, 500);

      console.log("[BN-MAIN] Patch kuruldu (noop + PF wrap)");
    }
  });
}

async function injectContent(tabId) {
  // content.js izole world’de kalsın (chrome.runtime mesajları için)
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("start").addEventListener("click", async () => {
    await saveConfigFromUI();
    await chrome.storage.local.set({ bn_running: true });

    const tab = await getActiveTab();

    try {
      await injectMainPatch(tab.id);   //  önce MAIN patch
      await injectContent(tab.id);     // sonra otomasyon
      await chrome.tabs.sendMessage(tab.id, { type: "BN_START" });

      setStatus(true);
    } catch (e) {
      console.error("Start hata:", e);
      alert("Enjeksiyon başarısız. Sayfayı yenileyip tekrar deneyin.");
    }
  });

  document.getElementById("stop").addEventListener("click", async () => {
    await chrome.storage.local.set({ bn_running: false });
    const tab = await getActiveTab();

    try { await chrome.tabs.sendMessage(tab.id, { type: "BN_STOP" }); } catch (_) {}
    setStatus(false);
  });

  document.getElementById("maxDocs").addEventListener("change", saveConfigFromUI);
  document.getElementById("speed").addEventListener("change", saveConfigFromUI);

  await loadState();
});
