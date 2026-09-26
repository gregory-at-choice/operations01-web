// choice — Importer le contact : lit le profil LinkedIn ouvert (et ses coordonnées si c'est une
// relation de niveau 1), puis ouvre l'app choice avec les champs pré-remplis.
(() => {
  const DEFAULT_URL = "https://gregory-at-choice.github.io/operations01-web/";
  const txt = (sel, root) => { const el = (root || document).querySelector(sel); return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; };
  const publicId = () => { const m = /\/in\/([^/?#]+)/.exec(location.pathname); return m ? decodeURIComponent(m[1]) : ""; };

  function readProfile() {
    const name = txt("main h1") || document.title.replace(/\s*\|\s*LinkedIn\s*$/, "").split(" - ")[0].trim();
    const headline = txt("main .text-body-medium.break-words") || txt("main .text-body-medium");
    const lieu = txt("main .text-body-small.inline.t-black--light.break-words") || txt("main .pv-text-details__left-panel .text-body-small");
    // Entreprise actuelle : bouton « Current company » du bandeau, sinon « chez X » dans le titre.
    let org = txt('main button[aria-label^="Current company"]') || txt('main button[aria-label^="Entreprise actuelle"]') || "";
    const desc = (document.querySelector('meta[property="og:description"]') || {}).content || "";
    if (!org) { const m = /^(.*?)\s+(?:chez|at|@)\s+(.+)$/i.exec(headline); if (m) org = m[2].trim(); }
    if (!org) { const me = /Exp[ée]rience\s*:\s*([^·\n]+)/i.exec(desc); if (me) org = me[1].trim(); }
    const degree = txt("main .dist-value") || txt("main .distance-badge");
    return { nom: name, titre: headline, url: "https://www.linkedin.com/in/" + publicId() + "/", desc, lieu, org, degre: degree };
  }

  // Coordonnées : l'API interne de LinkedIn (celle que la page utilise), avec le jeton de session du navigateur.
  async function contactInfoApi(id) {
    const m = /JSESSIONID="?([^;"]+)"?/.exec(document.cookie); if (!m) return null;
    const r = await fetch(`https://www.linkedin.com/voyager/api/identity/profiles/${encodeURIComponent(id)}/profileContactInfo`, {
      credentials: "include", headers: { "csrf-token": decodeURIComponent(m[1]), "accept": "application/vnd.linkedin.normalized+json+2.1", "x-restli-protocol-version": "2.0.0", "x-li-lang": "fr_FR" } });
    if (!r.ok) return null;
    const j = await r.json(), d = j && (j.data || j);
    if (!d) return null;
    const out = {};
    if (d.emailAddress) out.email = d.emailAddress;
    if (Array.isArray(d.phoneNumbers) && d.phoneNumbers.length) out.telephone = d.phoneNumbers.map((p) => p.number).filter(Boolean).join(" / ");
    if (Array.isArray(d.websites) && d.websites.length) out.site = d.websites.map((w) => w.url).filter(Boolean).join(" ");
    if (Array.isArray(d.twitterHandles) && d.twitterHandles.length) out.twitter = d.twitterHandles.map((t) => t.name).filter(Boolean).join(" ");
    if (d.birthDateOn && d.birthDateOn.month) out.anniversaire = `${String(d.birthDateOn.day || "").padStart(2, "0")}/${String(d.birthDateOn.month).padStart(2, "0")}`;
    return out;
  }
  // Repli : la fenêtre « Coordonnées » de la page, ouverte puis lue puis refermée.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function contactInfoDom() {
    const link = document.querySelector('a[href*="overlay/contact-info"]'); if (!link) return null;
    link.click();
    let modal = null;
    for (let i = 0; i < 20 && !modal; i++) { await sleep(150); modal = document.querySelector(".pv-contact-info, .artdeco-modal .pv-profile-section__section-info, section.pv-contact-info__contact-type") ? document.querySelector(".artdeco-modal") : null; }
    if (!modal) return null;
    const out = {};
    const mail = modal.querySelector('a[href^="mailto:"]'); if (mail) out.email = mail.textContent.trim();
    const tel = modal.querySelector('.ci-phone span, [class*="phone"] span'); if (tel) out.telephone = tel.textContent.trim();
    const site = modal.querySelector('.ci-websites a, [class*="website"] a'); if (site) out.site = site.href;
    const close = modal.querySelector('button[aria-label="Ignorer"], button[aria-label="Dismiss"], button.artdeco-modal__dismiss'); if (close) close.click();
    return out;
  }

  async function importProfile(btn) {
    const id = publicId(); if (!id) return;
    if (btn) { btn.disabled = true; btn.lastChild.textContent = "Lecture du profil…"; }
    const p = readProfile();
    let info = null;
    try { info = await contactInfoApi(id); } catch (e) { info = null; }
    if (!info) { try { info = await contactInfoDom(); } catch (e) { info = null; } }
    Object.assign(p, info || {});
    chrome.storage.sync.get({ appUrl: DEFAULT_URL }, (v) => {
      const base = (v.appUrl || DEFAULT_URL).replace(/\?.*$/, "");
      window.open(base + (base.includes("?") ? "&" : "?") + "addContact=" + encodeURIComponent(JSON.stringify(p)), "_blank");
      if (btn) { btn.disabled = false; btn.lastChild.textContent = "Importer dans choice"; }
    });
  }

  function ensureButton() {
    const onProfile = /^\/in\/[^/]+\/?$/.test(location.pathname);
    let btn = document.getElementById("choice-import-btn");
    if (!onProfile) { if (btn) btn.remove(); return; }
    if (btn) return;
    btn = document.createElement("button");
    btn.id = "choice-import-btn"; btn.type = "button";
    btn.innerHTML = '<span class="c">c</span><span>Importer dans choice</span>';
    btn.onclick = () => importProfile(btn);
    document.body.appendChild(btn);
  }
  ensureButton();
  setInterval(ensureButton, 1500);   // LinkedIn navigue sans recharger la page
  chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === "choice-import") importProfile(document.getElementById("choice-import-btn")); });
})();
