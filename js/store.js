/* ============================================================
   Swap, Share, Sustain — data layer
   Demo backend: everything lives in the browser's localStorage.
   Passwords are only lightly obfuscated — this is a school demo,
   never reuse a real password here.
   ============================================================ */

const SSS = (() => {
  const K = {
    users: 'sss_users',
    items: 'sss_items',
    requests: 'sss_requests',
    session: 'sss_session',
    seeded: 'sss_seeded_v1'
  };

  const load = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  };
  const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const uid = (prefix) => prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(36);
  };

  const CATEGORIES = [
    { id: 'books',      label: 'Books',          emoji: '📚' },
    { id: 'stationery', label: 'Stationery',     emoji: '✏️' },
    { id: 'uniforms',   label: 'Uniforms',       emoji: '👔' },
    { id: 'sports',     label: 'Sports & games', emoji: '⚽' },
    { id: 'other',      label: 'Other',          emoji: '📦' }
  ];
  const CONDITIONS = ['Like new', 'Good', 'Fair', 'Well-loved'];
  const GRADES = ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];

  const DAY = 86400000;

  function seed() {
    if (localStorage.getItem(K.seeded)) return;
    const now = Date.now();
    const users = [
      { id: 'u-mint',  schoolNumber: '10001', name: 'Mint',  grade: 'Grade 11', pass: hash('demo1234'), joinedAt: now - 34 * DAY },
      { id: 'u-ken',   schoolNumber: '10002', name: 'Ken',   grade: 'Grade 9',  pass: hash('demo1234'), joinedAt: now - 28 * DAY },
      { id: 'u-praew', schoolNumber: '10003', name: 'Praew', grade: 'Grade 12', pass: hash('demo1234'), joinedAt: now - 21 * DAY }
    ];
    const items = [
      { id: 'i-bio',   ownerId: 'u-mint',  title: 'IGCSE Biology textbook (3rd edition)', category: 'books',      condition: 'Good',     description: 'Complete with all pages. Some pencil notes in the margins that you can erase. Great for Grade 10–11.', image: null, status: 'available', createdAt: now - 12 * DAY },
      { id: 'i-high',  ownerId: 'u-ken',   title: 'Set of 12 highlighters, barely used',  category: 'stationery', condition: 'Like new', description: 'Bought a big pack and only used two of them. All colours still bright.', image: null, status: 'available', createdAt: now - 10 * DAY },
      { id: 'i-pe',    ownerId: 'u-praew', title: 'PE shirt, size M',                     category: 'uniforms',   condition: 'Good',     description: 'Washed and ironed. I moved up a size, so it is looking for a new owner.', image: null, status: 'available', createdAt: now - 9 * DAY },
      { id: 'i-calc',  ownerId: 'u-ken',   title: 'Casio fx-991EX scientific calculator', category: 'other',      condition: 'Good',     description: 'Works perfectly and includes the slide cover. I got a new one as a gift.', image: null, status: 'available', createdAt: now - 7 * DAY },
      { id: 'i-lit',   ownerId: 'u-praew', title: 'Thai literature reader, M.5',          category: 'books',      condition: 'Fair',     description: 'Cover is a little worn but the inside is clean. All chapters intact.', image: null, status: 'available', createdAt: now - 6 * DAY },
      { id: 'i-rack',  ownerId: 'u-ken',   title: 'Badminton racket with case',           category: 'sports',     condition: 'Good',     description: 'Strings in good shape. Comes with a zip case. I switched to basketball.', image: null, status: 'available', createdAt: now - 5 * DAY },
      { id: 'i-blaz',  ownerId: 'u-mint',  title: 'School blazer, size S',                category: 'uniforms',   condition: 'Like new', description: 'Worn maybe five times. Dry-cleaned and ready for assembly days.', image: null, status: 'available', createdAt: now - 4 * DAY },
      { id: 'i-note',  ownerId: 'u-praew', title: 'Graph notebooks, pack of 3 (unused)',  category: 'stationery', condition: 'Like new', description: 'Still in the plastic wrap. Extra from last term.', image: null, status: 'available', createdAt: now - 2 * DAY },
      { id: 'i-chess', ownerId: 'u-mint',  title: 'Chess set, complete with board',       category: 'sports',     condition: 'Good',     description: 'All 32 pieces counted twice. Folding wooden board.', image: null, status: 'available', createdAt: now - 1 * DAY }
    ];
    const requests = [
      { id: 'r-demo', itemId: 'i-blaz', fromUserId: 'u-ken', offeredItemId: 'i-rack', message: 'My sister needs a blazer for next term — would you trade for my badminton racket?', status: 'pending', createdAt: now - 1 * DAY }
    ];
    save(K.users, users);
    save(K.items, items);
    save(K.requests, requests);
    localStorage.setItem(K.seeded, '1');
  }
  seed();

  /* ---------- users & session ---------- */

  const users = () => load(K.users, []);
  const publicUser = (u) => u ? { id: u.id, name: u.name, schoolNumber: u.schoolNumber, grade: u.grade, joinedAt: u.joinedAt } : null;

  function getUser(id) {
    return publicUser(users().find(u => u.id === id) || null);
  }

  function currentUser() {
    const id = localStorage.getItem(K.session);
    return id ? getUser(id) : null;
  }

  function signUp(data) {
    const schoolNumber = String(data.schoolNumber || '').trim();
    const name = String(data.name || '').trim();
    const grade = String(data.grade || '').trim();
    const password = String(data.password || '');
    if (!/^[0-9]{3,10}$/.test(schoolNumber)) return { ok: false, error: 'School number should be 3–10 digits.' };
    if (!name) return { ok: false, error: 'Please enter your name.' };
    if (!GRADES.includes(grade)) return { ok: false, error: 'Please choose your grade.' };
    if (password.length < 6) return { ok: false, error: 'Password needs at least 6 characters.' };
    const all = users();
    if (all.some(u => u.schoolNumber === schoolNumber)) {
      return { ok: false, error: 'That school number already has an account. Try logging in instead.' };
    }
    const user = { id: uid('u'), schoolNumber, name, grade, pass: hash(password), joinedAt: Date.now() };
    all.push(user);
    save(K.users, all);
    localStorage.setItem(K.session, user.id);
    return { ok: true, user: publicUser(user) };
  }

  function logIn(schoolNumber, password) {
    const u = users().find(x => x.schoolNumber === String(schoolNumber || '').trim());
    if (!u || u.pass !== hash(String(password || ''))) {
      return { ok: false, error: 'School number or password is incorrect.' };
    }
    localStorage.setItem(K.session, u.id);
    return { ok: true, user: publicUser(u) };
  }

  function logOut() {
    localStorage.removeItem(K.session);
  }

  /* ---------- items ---------- */

  const items = () => load(K.items, []);
  const saveItems = (list) => save(K.items, list);

  function getItem(id) {
    return items().find(i => i.id === id) || null;
  }

  function listItems(opts = {}) {
    let list = items();
    if (!opts.includeSwapped) list = list.filter(i => i.status === 'available');
    if (opts.category) list = list.filter(i => i.category === opts.category);
    if (opts.ownerId) list = list.filter(i => i.ownerId === opts.ownerId);
    if (opts.q) {
      const q = String(opts.q).toLowerCase();
      list = list.filter(i => (i.title + ' ' + i.description).toLowerCase().includes(q));
    }
    return list.slice().sort((a, b) => b.createdAt - a.createdAt);
  }

  function addItem(data) {
    const me = currentUser();
    if (!me) return { ok: false, error: 'Log in to post an item.' };
    const title = String(data.title || '').trim();
    if (title.length < 3) return { ok: false, error: 'Give your item a short title (at least 3 characters).' };
    if (!CATEGORIES.some(c => c.id === data.category)) return { ok: false, error: 'Pick a category.' };
    if (!CONDITIONS.includes(data.condition)) return { ok: false, error: 'Pick a condition.' };
    const item = {
      id: uid('i'),
      ownerId: me.id,
      title,
      category: data.category,
      condition: data.condition,
      description: String(data.description || '').trim(),
      image: data.image || null,
      status: 'available',
      createdAt: Date.now()
    };
    const list = items();
    list.push(item);
    try {
      saveItems(list);
    } catch (e) {
      return { ok: false, error: 'Storage is full — try a smaller photo or remove an old item first.' };
    }
    return { ok: true, item };
  }

  function removeItem(id) {
    const me = currentUser();
    const list = items();
    const item = list.find(i => i.id === id);
    if (!item || !me || item.ownerId !== me.id) return { ok: false, error: 'You can only remove your own items.' };
    saveItems(list.filter(i => i.id !== id));
    const reqs = requestsAll().map(r =>
      r.status === 'pending' && (r.itemId === id || r.offeredItemId === id)
        ? Object.assign({}, r, { status: 'declined' })
        : r
    );
    save(K.requests, reqs);
    return { ok: true };
  }

  /* ---------- swap requests ---------- */

  const requestsAll = () => load(K.requests, []);

  function createRequest(data) {
    const me = currentUser();
    if (!me) return { ok: false, error: 'Log in to request a swap.' };
    const item = getItem(data.itemId);
    if (!item || item.status !== 'available') return { ok: false, error: 'This item is no longer available.' };
    if (item.ownerId === me.id) return { ok: false, error: 'This is your own item.' };
    const reqs = requestsAll();
    if (reqs.some(r => r.itemId === data.itemId && r.fromUserId === me.id && r.status === 'pending')) {
      return { ok: false, error: 'You already have a pending request for this item.' };
    }
    const offeredItemId = data.offeredItemId || null;
    if (offeredItemId) {
      const offered = getItem(offeredItemId);
      if (!offered || offered.ownerId !== me.id || offered.status !== 'available') {
        return { ok: false, error: 'The item you offered is not available.' };
      }
    }
    const req = {
      id: uid('r'),
      itemId: data.itemId,
      fromUserId: me.id,
      offeredItemId,
      message: String(data.message || '').trim(),
      status: 'pending',
      createdAt: Date.now()
    };
    reqs.push(req);
    save(K.requests, reqs);
    return { ok: true, request: req };
  }

  function requestsForOwner(userId) {
    const mine = new Set(items().filter(i => i.ownerId === userId).map(i => i.id));
    return requestsAll().filter(r => mine.has(r.itemId)).sort((a, b) => b.createdAt - a.createdAt);
  }

  function requestsFrom(userId) {
    return requestsAll().filter(r => r.fromUserId === userId).sort((a, b) => b.createdAt - a.createdAt);
  }

  function hasPendingRequest(itemId, userId) {
    return requestsAll().some(r => r.itemId === itemId && r.fromUserId === userId && r.status === 'pending');
  }

  function acceptRequest(id) {
    const me = currentUser();
    if (!me) return { ok: false, error: 'Log in first.' };
    const reqs = requestsAll();
    const req = reqs.find(r => r.id === id);
    if (!req || req.status !== 'pending') return { ok: false, error: 'This request is no longer pending.' };
    const itemList = items();
    const item = itemList.find(i => i.id === req.itemId);
    if (!item || item.ownerId !== me.id) return { ok: false, error: 'Only the item owner can accept a request.' };
    item.status = 'swapped';
    if (req.offeredItemId) {
      const offered = itemList.find(i => i.id === req.offeredItemId);
      if (offered) offered.status = 'swapped';
    }
    req.status = 'accepted';
    req.decidedAt = Date.now();
    const swappedIds = new Set([req.itemId, req.offeredItemId].filter(Boolean));
    reqs.forEach(r => {
      if (r.id !== req.id && r.status === 'pending' && (swappedIds.has(r.itemId) || swappedIds.has(r.offeredItemId))) {
        r.status = 'declined';
      }
    });
    saveItems(itemList);
    save(K.requests, reqs);
    return { ok: true };
  }

  function declineRequest(id) {
    const me = currentUser();
    const reqs = requestsAll();
    const req = reqs.find(r => r.id === id);
    if (!req || req.status !== 'pending') return { ok: false, error: 'This request is no longer pending.' };
    const item = getItem(req.itemId);
    const isOwner = me && item && item.ownerId === me.id;
    const isSender = me && req.fromUserId === me.id;
    if (!isOwner && !isSender) return { ok: false, error: 'You are not part of this request.' };
    req.status = isSender ? 'cancelled' : 'declined';
    req.decidedAt = Date.now();
    save(K.requests, reqs);
    return { ok: true };
  }

  /* ---------- stats ---------- */

  function stats() {
    return {
      members: users().length,
      listed: items().length,
      swaps: requestsAll().filter(r => r.status === 'accepted').length
    };
  }

  return {
    CATEGORIES, CONDITIONS, GRADES,
    signUp, logIn, logOut, currentUser, getUser,
    listItems, getItem, addItem, removeItem,
    createRequest, requestsForOwner, requestsFrom, hasPendingRequest,
    acceptRequest, declineRequest,
    stats
  };
})();
