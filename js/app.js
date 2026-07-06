/* ============================================================
   Swap, Share, Sustain — shared UI
   Header/footer rendering, toasts, item cards, image resizing.
   ============================================================ */

const UI = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const catInfo = (id) => SSS.CATEGORIES.find(c => c.id === id) || { id, label: 'Other', emoji: '📦' };

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.floor(h / 24);
    if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago');
    return new Date(ts).toLocaleDateString();
  }

  const qs = (name) => new URLSearchParams(location.search).get(name);

  function header(active) {
    const el = document.getElementById('site-header');
    if (!el) return;
    const me = SSS.currentUser();
    el.innerHTML = `
      <div class="nav-inner">
        <a class="logo" href="index.html">
          <span class="logo-badge">S³</span>
          <span class="logo-word">Swap · Share · Sustain</span>
        </a>
        <nav class="nav-links" aria-label="Main">
          <a href="browse.html" ${active === 'browse' ? 'aria-current="page"' : ''}>Browse</a>
          <a href="upload.html" ${active === 'upload' ? 'aria-current="page"' : ''}>Post an item</a>
          ${me
            ? `<a class="nav-user" href="profile.html" ${active === 'profile' ? 'aria-current="page"' : ''}>👤 ${esc(me.name)}</a>`
            : `<a class="btn btn-small" href="login.html">Log in</a>`}
        </nav>
      </div>`;
  }

  function footer() {
    const el = document.getElementById('site-footer');
    if (!el) return;
    el.innerHTML = `
      <div class="footer-inner">
        <p><strong>Swap, Share, Sustain</strong> — a student project for a school that wastes less.</p>
        <p class="footer-small">Items are exchanged in person at school. Be kind, be honest, and check items before you swap.</p>
      </div>`;
  }

  function toast(msg, ok = true) {
    let t = document.querySelector('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.toggle('toast-error', !ok);
    t.classList.add('toast-show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('toast-show'), 3200);
  }

  function requireLogin() {
    if (!SSS.currentUser()) {
      const here = location.pathname.split('/').pop() + location.search;
      location.href = 'login.html?next=' + encodeURIComponent(here);
      return false;
    }
    return true;
  }

  function cardImage(item, extraClass) {
    const cat = catInfo(item.category);
    return item.image
      ? `<img class="${extraClass}" src="${item.image}" alt="${esc(item.title)}">`
      : `<div class="${extraClass} ph ph-${cat.id}" role="img" aria-label="${esc(cat.label)}">${cat.emoji}</div>`;
  }

  function itemCard(item) {
    const cat = catInfo(item.category);
    const owner = SSS.getUser(item.ownerId);
    return `
      <a class="item-card" href="item.html?id=${encodeURIComponent(item.id)}">
        ${cardImage(item, 'card-img')}
        <div class="card-body">
          <div class="card-meta">
            <span class="chip chip-${cat.id}">${cat.emoji} ${esc(cat.label)}</span>
            <span class="cond">${esc(item.condition)}</span>
          </div>
          <h3 class="card-title">${esc(item.title)}</h3>
          <p class="card-owner">${esc(owner ? owner.name : 'A student')} · ${timeAgo(item.createdAt)}</p>
        </div>
      </a>`;
  }

  /* Reads a picked photo, scales it down and returns a JPEG data URL
     small enough to live in localStorage. */
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX = 900;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            const k = Math.min(MAX / w, MAX / h);
            w = Math.round(w * k);
            h = Math.round(h * k);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => reject(new Error('That file does not look like an image.'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.readAsDataURL(file);
    });
  }

  return { esc, catInfo, timeAgo, qs, header, footer, toast, requireLogin, cardImage, itemCard, fileToDataURL };
})();
