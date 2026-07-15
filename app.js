// TokGhost frontend — wires each tool page to /api/tiktok
(function () {
  const input = document.getElementById("tokInput");
  const viewBtn = document.getElementById("viewBtn");
  const pasteBtn = document.getElementById("pasteBtn");
  if (!input || !viewBtn) return;

  const path = location.pathname.replace(/\.html$/, "").replace(/^\/(id|tr)/, "");

  // Which pages take a VIDEO LINK vs a USERNAME
  const wantsVideoLink =
    /video-downloader|mp3-downloader|comment-viewer|copy-tiktok-link/.test(path);

  let box = document.getElementById("tokResult");
  if (!box) {
    box = document.createElement("div");
    box.id = "tokResult";
    box.className = "result";
    const card = document.querySelector(".toolcard");
    if (card) card.insertAdjacentElement("afterend", box);
  }

  const esc = (s) =>
    String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const nfmt = (n) =>
    n == null ? "—" : n >= 1e9 ? (n / 1e9).toFixed(1) + "B"
      : n >= 1e6 ? (n / 1e6).toFixed(1) + "M"
      : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);

  function busy(on) {
    viewBtn.disabled = on;
    viewBtn.dataset.label = viewBtn.dataset.label || viewBtn.textContent;
    viewBtn.textContent = on ? "Working…" : viewBtn.dataset.label;
    viewBtn.style.opacity = on ? ".65" : "1";
  }
  const card = (html) => { box.innerHTML = `<div class="rcard">${html}</div>`; };
  const note = (msg) => card(`<p class="rmsg">${esc(msg)}</p>`);

  function renderProfile(d) {
    if (d.private) {
      return card(
        `<div class="rhead">
           ${d.avatar ? `<img class="ravatar" src="${esc(d.avatar)}" alt="">` : ""}
           <div><strong>@${esc(d.username)}</strong>
           <p class="rmsg">This account is private, so its content cannot be viewed through any tool.</p></div>
         </div>`
      );
    }
    card(
      `<div class="rhead">
         ${d.avatar ? `<img class="ravatar" src="${esc(d.avatar)}" alt="">` : ""}
         <div>
           <strong>${esc(d.nickname || d.username)}</strong>${d.verified ? ' <span class="rver">✓</span>' : ""}
           <div class="rsub">@${esc(d.username)}</div>
         </div>
       </div>
       ${d.bio ? `<p class="rbio">${esc(d.bio)}</p>` : ""}
       <div class="rstats">
         <div><b>${nfmt(d.followers)}</b><span>Followers</span></div>
         <div><b>${nfmt(d.following)}</b><span>Following</span></div>
         <div><b>${nfmt(d.likes)}</b><span>Likes</span></div>
         <div><b>${nfmt(d.videos)}</b><span>Videos</span></div>
       </div>
       ${d.avatar ? `<a class="rbtn" href="${esc(d.avatar)}" target="_blank" rel="noopener" download>Download profile picture</a>` : ""}
       <a class="rlink" href="${esc(d.profileUrl)}" target="_blank" rel="noopener">Open on TikTok →</a>`
    );
  }

  function renderVideo(d) {
    const wantsAudio = /mp3-downloader/.test(path);
    const dl = wantsAudio ? d.music : d.download;
    const label = wantsAudio ? "Download MP3" : "Download without watermark";
    card(
      `<div class="rhead">
         ${d.cover ? `<img class="rcover" src="${esc(d.cover)}" alt="">` : ""}
         <div>
           <strong>@${esc(d.author)}</strong>
           <p class="rbio">${esc(d.title)}</p>
         </div>
       </div>
       <div class="rstats">
         <div><b>${nfmt(d.plays)}</b><span>Views</span></div>
         <div><b>${nfmt(d.likes)}</b><span>Likes</span></div>
         <div><b>${nfmt(d.comments)}</b><span>Comments</span></div>
         <div><b>${nfmt(d.shares)}</b><span>Shares</span></div>
       </div>
       ${dl ? `<a class="rbtn" href="${esc(dl)}" target="_blank" rel="noopener" download>${label}</a>`
            : `<p class="rmsg">A clean download link is not available for this one.</p>`}`
    );
  }

  async function run() {
    const raw = (input.value || "").trim();
    if (!raw) return input.focus();
    busy(true);
    box.innerHTML = "";
    try {
      const q = wantsVideoLink
        ? `type=video&url=${encodeURIComponent(raw)}`
        : `type=profile&u=${encodeURIComponent(raw)}`;
      const r = await fetch(`/api/tiktok?${q}`);
      const d = await r.json();

      if (!d.ok) return note(d.error || "Something went wrong. Please try again.");
      if (d.type === "video") renderVideo(d);
      else renderProfile(d);
    } catch (e) {
      note("Network hiccup. Please try again in a moment.");
    } finally {
      busy(false);
    }
  }

  viewBtn.addEventListener("click", run);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });

  if (pasteBtn) {
    pasteBtn.addEventListener("click", async () => {
      try { input.value = (await navigator.clipboard.readText()).trim(); } catch (_) {}
      input.focus();
    });
  }

  const menu = document.querySelector(".menutoggle");
  if (menu) menu.addEventListener("click", () => {
    const f = document.querySelector("footer");
    if (f) f.scrollIntoView({ behavior: "smooth" });
  });
})();

// ---------- Language switcher ----------
(function () {
  const btn = document.querySelector(".langbtn");
  if (!btn) return;

  // Wrap the button so the menu can position against it
  let wrap = btn.parentElement;
  if (!wrap.classList.contains("langwrap")) {
    wrap = document.createElement("span");
    wrap.className = "langwrap";
    btn.parentNode.insertBefore(wrap, btn);
    wrap.appendChild(btn);
  }

  // Work out which page we are on, stripped of any language prefix
  const path = location.pathname.replace(/\.html$/, "");
  const m = path.match(/^\/(id|tr)(\/.*)?$/);
  const current = m ? m[1] : "en";
  const base = m ? (m[2] || "/") : (path || "/");

  // Only the homepage and story viewer have translations so far.
  // For any other page, the language links point at that language's homepage.
  const translated = ["/", "/tiktok-story-viewer"];
  const target = translated.includes(base) ? base : "/";

  const LANGS = [
    { code: "en", label: "English",          flag: "🇬🇧" },
    { code: "id", label: "Bahasa Indonesia", flag: "🇮🇩" },
    { code: "tr", label: "Türkçe",           flag: "🇹🇷" },
    { code: "ar", label: "العربية",          flag: "🇸🇦" },
    { code: "vi", label: "Tiếng Việt",       flag: "🇻🇳" },
    { code: "es", label: "Español",          flag: "🇪🇸" },
    { code: "it", label: "Italiano",         flag: "🇮🇹" },
    { code: "th", label: "ไทย",              flag: "🇹🇭" },
    { code: "ru", label: "Русский",          flag: "🇷🇺" },
    { code: "fr", label: "Français",         flag: "🇫🇷" },
    { code: "de", label: "Deutsch",          flag: "🇩🇪" },
    { code: "ko", label: "한국어",            flag: "🇰🇷" },
    { code: "pt", label: "Português",        flag: "🇵🇹" },
  ];
  const langs = LANGS.map((l) => ({
    ...l,
    href: l.code === "en" ? target : "/" + l.code + (target === "/" ? "" : target),
  }));

  const menu = document.createElement("div");
  menu.className = "langmenu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = langs
    .map(
      (l) =>
        `<a href="${l.href}" role="menuitem"${l.code === current ? ' class="active"' : ""}>` +
        `<span class="flag" aria-hidden="true">${l.flag}</span>${l.label}</a>`
    )
    .join("");
  wrap.appendChild(menu);

  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  document.addEventListener("click", () => {
    menu.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      menu.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    }
  });
})();
