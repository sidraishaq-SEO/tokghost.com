// TokGhost frontend logic — wires the tool box to the backend API.
(function () {
  const input = document.getElementById("tokInput");
  const viewBtn = document.getElementById("viewBtn");
  const pasteBtn = document.getElementById("pasteBtn");
  if (!input || !viewBtn) return;

  const path = location.pathname.replace(/\.html$/, "");
  const isVideoInput =
    /downloader|comment|copy-tiktok-link/.test(path) &&
    !/photo-downloader/.test(path);

  let resultBox = document.getElementById("tokResult");
  if (!resultBox) {
    resultBox = document.createElement("div");
    resultBox.id = "tokResult";
    resultBox.style.cssText = "max-width:720px;margin:18px 0 0;font-size:15px;";
    const cardEl = document.querySelector(".toolcard");
    if (cardEl) cardEl.insertAdjacentElement("afterend", resultBox);
  }

  function setBusy(b) {
    viewBtn.disabled = b;
    viewBtn.style.opacity = b ? ".7" : "1";
    viewBtn.dataset.label = viewBtn.dataset.label || viewBtn.textContent;
    viewBtn.textContent = b ? "Working…" : viewBtn.dataset.label;
  }
  function card(html) {
    resultBox.innerHTML =
      '<div style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;box-shadow:var(--shadow-sm)">' + html + "</div>";
  }
  function esc(s) {
    return String(s || "").replace(/[<>&"]/g, (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  }

  async function run() {
    const raw = (input.value || "").trim();
    if (!raw) { input.focus(); return; }
    setBusy(true);
    resultBox.innerHTML = "";
    try {
      let api = isVideoInput
        ? `/api/tiktok?type=video&url=${encodeURIComponent(raw)}`
        : `/api/tiktok?type=profile&u=${encodeURIComponent(raw)}`;
      const r = await fetch(api);
      const data = await r.json();
      if (!data.ok) { card(`<strong>Hmm.</strong> ${esc(data.error || "Something went wrong.")}`); return; }
      if (data.type === "video") {
        card(
          `<div style="font-weight:700;margin-bottom:6px">${esc(data.author || "TikTok video")}</div>` +
          (data.thumbnail ? `<img src="${esc(data.thumbnail)}" alt="" style="max-width:180px;border-radius:10px;margin:8px 0"/>` : "") +
          `<div style="color:var(--muted);font-size:14px">${esc(data.title || "")}</div>` +
          `<a href="${esc(data.authorUrl || "#")}" target="_blank" rel="noopener" style="display:inline-block;margin-top:10px;color:var(--violet);font-weight:600">Open on TikTok →</a>`
        );
      } else {
        const stats = data.followers != null
          ? `<div style="color:var(--muted);font-size:14px;margin-top:4px">${esc(data.followers)} followers</div>` : "";
        card(
          `<div style="font-weight:700">@${esc(data.username)}</div>` + stats +
          (data.note ? `<div style="color:var(--muted);font-size:13px;margin-top:8px">${esc(data.note)}</div>` : "") +
          `<a href="${esc(data.profileUrl || "#")}" target="_blank" rel="noopener" style="display:inline-block;margin-top:10px;color:var(--violet);font-weight:600">Open profile →</a>`
        );
      }
    } catch (e) {
      card("<strong>Network hiccup.</strong> Please try again in a moment.");
    } finally { setBusy(false); }
  }

  viewBtn.addEventListener("click", run);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  if (pasteBtn) {
    pasteBtn.addEventListener("click", async () => {
      try { const t = await navigator.clipboard.readText(); input.value = t.trim(); input.focus(); }
      catch (e) { input.focus(); }
    });
  }
  const menu = document.querySelector(".menutoggle");
  if (menu) menu.addEventListener("click", () =>
    document.querySelector("footer") && document.querySelector("footer").scrollIntoView({ behavior: "smooth" }));
})();
