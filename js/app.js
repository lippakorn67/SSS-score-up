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
    scene(me).catch(err => console.error('scene:', err));
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

  /* Erases a picture's plain background. Samples the border colour and
     its spread to pick the tolerance automatically, flood-fills inward
     from the edges, and feathers the boundary (partial transparency)
     for a soft, halo-free cut. The same colour *inside* the subject is
     kept because only pixels connected to the edge are cleared.
     Returns a transparent PNG. */
  function removeBackground(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height);
        const px = data.data, W = c.width, H = c.height, N = W * H;

        // sample the border to learn the background colour + how varied it is
        let r = 0, g = 0, b = 0, n = 0;
        const border = [];
        const take = (x, y) => {
          const i = (y * W + x) * 4;
          r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
          border.push(i);
        };
        const sx = Math.max(1, W >> 6), sy = Math.max(1, H >> 6);
        for (let x = 0; x < W; x += sx) { take(x, 0); take(x, H - 1); }
        for (let y = 0; y < H; y += sy) { take(0, y); take(W - 1, y); }
        r /= n; g /= n; b /= n;

        // spread of border colours → adaptive tolerance
        let variance = 0;
        for (const i of border) {
          const dr = px[i] - r, dg = px[i + 1] - g, db = px[i + 2] - b;
          variance += dr * dr + dg * dg + db * db;
        }
        const spread = Math.sqrt(variance / border.length);
        const hard = Math.max(30, spread * 1.4 + 18);   // fully background
        const soft = hard + Math.max(45, spread * 2 + 40); // feather edge
        const dist = (i) => {
          const dr = px[i] - r, dg = px[i + 1] - g, db = px[i + 2] - b;
          return Math.sqrt(dr * dr + dg * dg + db * db);
        };

        // flood-fill from every edge pixel through "background" pixels,
        // feathering the transition band
        const seen = new Uint8Array(N);
        const stack = [];
        for (let x = 0; x < W; x++) { stack.push(x, x + (H - 1) * W); }
        for (let y = 0; y < H; y++) { stack.push(y * W, W - 1 + y * W); }
        while (stack.length) {
          const p = stack.pop();
          if (seen[p]) continue;
          seen[p] = 1;
          const i = p * 4;
          const d = dist(i);
          if (d >= soft) continue;               // clearly the subject — stop
          if (d <= hard) {
            px[i + 3] = 0;                        // clearly background — erase
          } else {
            // feather: fade alpha across the transition, and de-fringe the
            // colour a touch so no background halo remains
            const t = (d - hard) / (soft - hard);
            px[i + 3] = Math.round(px[i + 3] * t);
            continue;                            // don't spread past the edge
          }
          const x = p % W, y = (p / W) | 0;
          if (x > 0) stack.push(p - 1);
          if (x < W - 1) stack.push(p + 1);
          if (y > 0) stack.push(p - W);
          if (y < H - 1) stack.push(p + W);
        }
        ctx.putImageData(data, 0, 0);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Could not process that image.'));
      img.src = dataUrl;
    });
  }

  /* ---------- the scene: admin-editable background pictures ----------
     Everyone sees the pictures; admins get a 🎨 Edit scene button to
     add, drag, resize and remove them live — saved for the whole
     school instantly. */
  async function scene(me) {
    const page = (location.pathname.split('/').pop() || 'index.html').replace('.html', '') || 'index';
    let decos = await SSS.listDecorations(page);

    let wrap = document.getElementById('aero-scene');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'aero-scene';
      document.body.appendChild(wrap);
    }
    const render = () => {
      wrap.innerHTML = decos.map(d =>
        `<img class="scene-img" data-id="${esc(d.id)}" src="${esc(d.src)}" alt="" draggable="false"
          style="left:${d.x}%;top:${d.y}px;width:${d.w}px">`
      ).join('');
    };
    render();

    if (!me || !me.isAdmin) return;

    /* ----- editor (admins only; database rules enforce it too) ----- */
    const bar = document.createElement('div');
    bar.className = 'scene-bar';
    bar.innerHTML = `
      <button class="btn btn-small" id="scene-toggle" type="button">🎨 Edit scene</button>
      <span id="scene-tools" hidden>
        <label class="btn btn-outline btn-small" for="scene-file" style="cursor:pointer">➕ Add picture</label>
        <input id="scene-file" type="file" accept="image/*" hidden>
      </span>`;
    document.body.appendChild(bar);

    const tools = document.createElement('div');
    tools.className = 'scene-sel-tools';
    tools.hidden = true;
    tools.innerHTML = `
      <button data-act="smaller" title="Smaller" type="button">➖</button>
      <button data-act="bigger" title="Bigger" type="button">➕</button>
      <button data-act="del" title="Remove picture" type="button">🗑️</button>`;
    document.body.appendChild(tools);

    let editing = false;
    let selected = null;

    function positionTools(img) {
      const r = img.getBoundingClientRect();
      tools.style.left = (r.left + r.width / 2 + window.scrollX) + 'px';
      tools.style.top = Math.max(8, r.top + window.scrollY - 48) + 'px';
    }
    function select(img) {
      if (selected) selected.classList.remove('sel');
      selected = img;
      if (img) {
        img.classList.add('sel');
        positionTools(img);
      }
      tools.hidden = !img;
    }
    function findDeco(img) {
      return decos.find(d => d.id === img.dataset.id);
    }

    document.getElementById('scene-toggle').addEventListener('click', () => {
      editing = !editing;
      wrap.classList.toggle('editing', editing);
      document.getElementById('scene-tools').hidden = !editing;
      document.getElementById('scene-toggle').textContent = editing ? '✅ Done' : '🎨 Edit scene';
      if (!editing) select(null);
      else toast('Scene editor on — drag pictures to move them, click one for more options.');
    });

    document.getElementById('scene-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        let dataUrl = await fileToDataURL(file, 800);
        if (confirm('Remove the plain background from this picture so it blends into the sky?\n\nOK = remove background (best when the background is one solid colour)\nCancel = keep the picture exactly as it is')) {
          toast('Removing background…');
          dataUrl = await removeBackground(dataUrl);
        }
        const up = await SSS.uploadDecorImage(dataUrl);
        if (!up.ok) { toast(up.error, false); return; }
        const r = await SSS.addDecoration({
          page,
          src: up.url,
          x: 50,
          y: Math.round(window.scrollY + window.innerHeight / 2),
          w: 150
        });
        if (!r.ok) { toast(r.error, false); return; }
        decos.push(r.decoration);
        render();
        select(wrap.querySelector(`[data-id="${r.decoration.id}"]`));
        toast('Picture added — drag it where you want it. 🎨');
      } catch (err) {
        toast(err.message, false);
      }
    });

    /* drag to move */
    let drag = null;
    wrap.addEventListener('pointerdown', e => {
      if (!editing) return;
      const img = e.target.closest('.scene-img');
      if (!img) { select(null); return; }
      e.preventDefault();
      select(img);
      drag = {
        img,
        startX: e.pageX, startY: e.pageY,
        x: parseFloat(img.style.left), y: parseFloat(img.style.top)
      };
      img.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener('pointermove', e => {
      if (!drag) return;
      const nx = drag.x + (e.pageX - drag.startX) / document.documentElement.clientWidth * 100;
      const ny = drag.y + (e.pageY - drag.startY);
      drag.img.style.left = Math.min(100, Math.max(0, nx)) + '%';
      drag.img.style.top = Math.max(0, ny) + 'px';
      positionTools(drag.img);
    });
    const endDrag = async () => {
      if (!drag) return;
      const img = drag.img;
      drag = null;
      const deco = findDeco(img);
      if (!deco) return;
      deco.x = Math.round(parseFloat(img.style.left) * 100) / 100;
      deco.y = Math.round(parseFloat(img.style.top));
      const r = await SSS.updateDecoration(img.dataset.id, { x: deco.x, y: deco.y });
      if (!r.ok) toast(r.error, false);
    };
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);

    /* resize + delete */
    tools.addEventListener('click', async e => {
      const btn = e.target.closest('button');
      if (!btn || !selected) return;
      const deco = findDeco(selected);
      if (!deco) return;
      if (btn.dataset.act === 'del') {
        if (!confirm('Remove this picture from the scene?')) return;
        const r = await SSS.removeDecoration(deco.id);
        if (!r.ok) { toast(r.error, false); return; }
        decos = decos.filter(d => d.id !== deco.id);
        select(null);
        render();
        toast('Picture removed.');
        return;
      }
      const factor = btn.dataset.act === 'bigger' ? 1.15 : 0.87;
      deco.w = Math.round(Math.min(800, Math.max(20, deco.w * factor)));
      selected.style.width = deco.w + 'px';
      positionTools(selected);
      const r = await SSS.updateDecoration(deco.id, { w: deco.w });
      if (!r.ok) toast(r.error, false);
    });
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
          // PNGs keep their transparency (needed for scene decorations)
          resolve(file.type === 'image/png'
            ? canvas.toDataURL('image/png')
            : canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => reject(new Error('That file does not look like an image.'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.readAsDataURL(file);
    });
  }

  return { esc, catInfo, timeAgo, qs, init, header, footer, toast, requireLogin, cardImage, itemCard, itemThumb, avatar, fileToDataURL, removeBackground, reveals };
})();
