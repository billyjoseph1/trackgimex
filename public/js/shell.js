/* TrackGimex — dashboard shell shared by landlord & tenant pages */
const Shell = (() => {
  let cfg, me;

  async function init(options) {
    cfg = options;
    document.body.innerHTML = UI.loading("Loading your dashboard…");
    try { me = await Store.init(); }
    catch (err) { document.body.innerHTML = UI.failed(err.message); return null; }
    if (!me || me.role !== cfg.role) {
      const here = location.pathname.split("/").pop() + location.search;
      location.replace("login.html?role=" + cfg.role + "&next=" + encodeURIComponent(here));
      return null;
    }
    document.body.innerHTML = `
      <div class="app">
        <aside class="sidebar" id="sidebar">
          <a class="brand" href="index.html"><span class="logo-mark sm">${UI.LOGO}</span>TrackGimex</a>
          <nav class="side-nav" id="sideNav"></nav>
          <div class="side-foot">
            <div class="me"><div class="avatar" id="meAvatar"></div>
              <div><div class="name" id="meName"></div><div class="role" id="meRole"></div></div></div>
            <div class="side-nav"><button data-logout>${UI.icon("logout")} Log out</button></div>
          </div>
        </aside>
        <div class="main">
          <header class="topbar">
            <div style="display:flex;align-items:center;gap:12px">
              <button class="bell menu-btn" id="menuBtn" aria-label="Open menu">☰</button>
              <h1 id="viewTitle"></h1>
            </div>
            <div class="topbar-actions" id="topActions">
              <button class="bell" id="refreshBtn" aria-label="Refresh" title="Refresh">⟳</button>
              <button class="bell" id="bellBtn" aria-label="Notifications">${UI.icon("bell")}<span class="dot" id="bellDot" hidden></span></button>
            </div>
          </header>
          <div class="content" id="view"></div>
        </div>
      </div>`;
    UI.$("[data-logout]").onclick = async () => { await Store.logout(); location.href = "index.html"; };
    UI.$("#bellBtn").onclick = () => go("notifications");
    UI.$("#refreshBtn").onclick = async () => {
      try { await Store.refresh(); render(); UI.toast("Up to date."); } catch (err) { UI.toast(err.message, "err"); }
    };
    UI.$("#menuBtn").onclick = () => UI.$("#sidebar").classList.toggle("open");
    window.addEventListener("hashchange", render);
    // live updates: a new notification means something changed — data is already reloaded
    Store.onChange((note) => { if (!UI.$(".modal-backdrop")) render(); if (note && note.text) UI.toast(note.text); });
    // One click handler for every [data-act] button, anywhere on the page (including modals)
    document.addEventListener("click", async (e) => {
      const el = e.target.closest("[data-act]");
      if (!el || !cfg.actions[el.dataset.act] || el.dataset.busy) return;
      e.preventDefault();
      el.dataset.busy = "1";
      try { await cfg.actions[el.dataset.act](el.dataset, el); }
      catch (err) { UI.toast(err.message, "err"); }
      finally { delete el.dataset.busy; }
    });
    document.addEventListener("change", async (e) => {
      const el = e.target.closest("[data-change]");
      if (!el || !cfg.actions[el.dataset.change]) return;
      try { await cfg.actions[el.dataset.change](el.dataset, el); } catch (err) { UI.toast(err.message, "err"); }
    });
    render();
    return me;
  }

  const current = () => (location.hash.slice(1).split("?")[0] || cfg.nav[0][0]);
  function go(view) { if (current() === view) render(); else location.hash = view; }

  function render() {
    me = Store.currentUser();
    if (!me) { location.replace("login.html?role=" + cfg.role); return; }
    const view = current();
    const counts = cfg.counts ? cfg.counts(me) : {};
    UI.$("#meAvatar").textContent = (me.name || "?")[0];
    UI.$("#meName").textContent = me.name;
    UI.$("#meRole").textContent = me.role === "landlord" ? me.kind || "Landlord" : "Tenant";
    UI.$("#sideNav").innerHTML = cfg.nav.map(([id, label, ic]) =>
      `<button class="${id === view ? "active" : ""}" onclick="location.hash='${id}'">${UI.icon(ic)} ${label}
        ${counts[id] ? `<span class="count">${counts[id]}</span>` : ""}</button>`).join("");
    const unread = Store.notificationsOf(me.id).filter((n) => !n.read).length;
    UI.$("#bellDot").hidden = !unread;
    UI.$("#bellDot").textContent = unread;
    const entry = cfg.nav.find((n) => n[0] === view) || cfg.nav[0];
    UI.$("#viewTitle").textContent = entry[1];
    UI.$("#sidebar").classList.remove("open");
    const keepScroll = render.lastView === entry[0];
    const y = window.scrollY;
    UI.$("#view").innerHTML = cfg.views[entry[0]](me);
    if (cfg.after && cfg.after[entry[0]]) cfg.after[entry[0]](me);
    window.scrollTo(0, keepScroll ? y : 0);
    render.lastView = entry[0];
  }

  function notificationsView(me) {
    const list = Store.notificationsOf(me.id);
    const html = `<div class="card">
      <div class="card-head"><h3>All notifications</h3><span class="muted small">${list.length} total</span></div>
      ${list.length ? list.map((n) => `<div class="notif ${n.read ? "" : "unread"} ${/MOVE-OUT/.test(n.text) ? "alert" : ""}">
        <span class="n-dot"></span><div style="flex:1"><div>${UI.esc(n.text)}</div><div class="n-time">${UI.timeAgo(n.date)}</div></div>
        ${n.link ? `<a class="btn btn-ghost btn-sm" href="#${UI.esc(n.link)}">View</a>` : ""}</div>`).join("")
        : '<div class="empty">No notifications yet.</div>'}</div>`;
    setTimeout(async () => {
      try { await Store.markAllRead(); UI.$("#bellDot").hidden = true; } catch (e) { /* not critical */ }
    }, 800);
    return html;
  }

  return { init, render, go, current, notificationsView };
})();
