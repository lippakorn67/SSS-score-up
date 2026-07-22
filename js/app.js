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

  /* Fetches the session once, renders header + footer, and returns
     the logged-in user (or null) for the page to use. */
  async function init(active) {
    const me = await SSS.currentUser();
    header(active, me);
    footer();
    if (me) {
      // fetch the notification badge after first paint so pages feel fast
      SSS.notificationCounts().then(n => {
        const slot = document.getElementById('nav-notif');
        if (slot && n.total > 0) {
          slot.innerHTML = `<span class="notif" title="${n.requests} waiting request(s), ${n.messages} unread message(s)">${n.total}</span>`;
        }
      });
    }
    return me;
  }

  function header(active, me) {
    const el = document.getElementById('site-header');
    if (!el) return;
    el.innerHTML = `
      <div class="nav-inner">
        <a class="logo" href="index.html">
          <img class="logo-badge" src="img/logo.png" alt="Swap, Share, Sustain logo">
          <span class="logo-word">Swap · Share · Sustain</span>
        </a>
        <nav class="nav-links" aria-label="Main">
          <a href="browse.html" ${active === 'browse' ? 'aria-current="page"' : ''}>Browse</a>
          <a href="wishes.html" ${active === 'wishes' ? 'aria-current="page"' : ''}>Wishlist</a>
          <a href="upload.html" ${active === 'upload' ? 'aria-current="page"' : ''}>Post an item</a>
          ${me && me.isAdmin ? `<a href="admin.html" ${active === 'admin' ? 'aria-current="page"' : ''}>🛡️ Admin</a>` : ''}
          ${me
            ? `<a class="nav-user" href="profile.html" ${active === 'profile' ? 'aria-current="page"' : ''}>${avatar(me, 'nav-avatar')} ${esc(me.name)}<span id="nav-notif"></span></a>`
            : `<a class="btn btn-small" href="login.html">Log in</a>`}
          <button class="theme-btn" id="theme-btn" type="button" title="Switch between day and night">${document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'}</button>
        </nav>
      </div>`;
    el.querySelector('#theme-btn').addEventListener('click', () => {
      const root = document.documentElement;
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      localStorage.setItem('sss_theme', next);
      el.querySelector('#theme-btn').textContent = next === 'dark' ? '☀️' : '🌙';
    });
  }

  /* Small square thumbnail for an item (photo or category placeholder). */
  function itemThumb(item) {
    if (!item) return `<div class="row-thumb ph">❓</div>`;
    const cat = catInfo(item.category);
    return item.image
      ? `<img class="row-thumb" src="${esc(item.image)}" alt="">`
      : `<div class="row-thumb ph ph-${cat.id}">${cat.emoji}</div>`;
  }

  /* Scroll-triggered reveals: children of [data-reveal] containers
     slide in one after another as they enter the viewport. Does
     nothing when the visitor prefers reduced motion or lacks
     IntersectionObserver — content just stays visible. A safety
     timeout guarantees nothing ever stays stuck hidden. */
  function reveals() {
    if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
    if (!('IntersectionObserver' in window)) return;

    const kids = [];
    document.querySelectorAll('[data-reveal]').forEach(el => {
      [...el.children].forEach(c => { c.classList.add('reveal'); kids.push(c); });
    });
    if (kids.length === 0) return;

    const show = (el) => {
      [...el.children].forEach((child, i) => {
        child.style.transitionDelay = Math.min(i * 70, 490) + 'ms';
        child.classList.add('in');
      });
    };
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        show(entry.target);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));

    // safety net: never let content stay invisible if the observer
    // somehow doesn't fire (odd browsers, background tabs, etc.)
    setTimeout(() => kids.forEach(c => c.classList.add('in')), 2600);
  }

  /* Round profile picture, or the student's initial if they have none. */
  function avatar(user, cls) {
    cls = cls || 'avatar';
    return user && user.avatarUrl
      ? `<img class="${cls} avatar-img" src="${esc(user.avatarUrl)}" alt="">`
      : `<div class="${cls}">${esc(((user && user.name) || '?').charAt(0).toUpperCase())}</div>`;
  }

  function footer() {
    const el = document.getElementById('site-footer');
    if (!el) return;
    el.innerHTML = `
      <div class="footer-inner">
        <span class="aero-deco swim" data-deco="golden-fish" title="golden fish" style="left:3%;top:22%;font-size:2.4rem" aria-hidden="true">🐠</span>
        <span class="aero-deco sway" data-deco="coconut-tree" title="coconut tree" style="right:2%;bottom:-4px;font-size:3.6rem" aria-hidden="true">🌴</span>
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

  function requireLogin(me) {
    if (!me) {
      const here = location.pathname.split('/').pop() + location.search;
      location.href = 'login.html?next=' + encodeURIComponent(here);
      return false;
    }
    return true;
  }

  function cardImage(item, extraClass) {
    const cat = catInfo(item.category);
    return item.image
      ? `<img class="${extraClass}" src="${esc(item.image)}" alt="${esc(item.title)}">`
      : `<div class="${extraClass} ph ph-${cat.id}" role="img" aria-label="${esc(cat.label)}">${cat.emoji}</div>`;
  }

  function itemCard(item) {
    const cat = catInfo(item.category);
    return `
      <a class="item-card" href="item.html?id=${encodeURIComponent(item.id)}">
        ${cardImage(item, 'card-img')}
        <div class="card-body">
          <div class="card-meta">
            <span class="chip chip-${cat.id}">${cat.emoji} ${esc(cat.label)}</span>
            <span class="cond">${esc(item.condition)}</span>
          </div>
          <h3 class="card-title">${esc(item.title)}</h3>
          <p class="card-owner">${esc(item.owner ? item.owner.name : 'A student')} · ${timeAgo(item.createdAt)}</p>
        </div>
      </a>`;
  }

  /* Reads a picked photo, scales it down and returns a JPEG data URL
     ready to upload. maxSize defaults to 900px (use less for avatars). */
  function fileToDataURL(file, maxSize) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const MAX = maxSize || 900;
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

  return { esc, catInfo, timeAgo, qs, init, header, footer, toast, requireLogin, cardImage, itemCard, itemThumb, avatar, fileToDataURL, reveals };
})();
