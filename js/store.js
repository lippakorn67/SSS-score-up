/* ============================================================
   Swap, Share, Sustain — data layer (Supabase backend)
   Accounts, items, photos and swap requests live in a shared
   Supabase project, so every device sees the same board.
   All functions are async and return { ok, ... } result objects
   where something can go wrong.
   ============================================================ */

const SSS = (() => {
  const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* School numbers double as logins. Supabase Auth wants an email,
     so each school number gets a synthetic one. */
  const emailFor = (schoolNumber) => 'sn' + String(schoolNumber).trim() + '@sss-swap.app';

  const CATEGORIES = [
    { id: 'books',      label: 'Books',          emoji: '📚' },
    { id: 'stationery', label: 'Stationery',     emoji: '✏️' },
    { id: 'uniforms',   label: 'Uniforms',       emoji: '👔' },
    { id: 'sports',     label: 'Sports & games', emoji: '⚽' },
    { id: 'other',      label: 'Other',          emoji: '📦' }
  ];
  const CONDITIONS = ['Like new', 'Good', 'Fair', 'Well-loved'];
  const GRADES = ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12', 'Teacher', 'Staff'];

  /* ---------- row mappers (snake_case DB → camelCase app) ---------- */

  const rowToUser = (r) => r ? {
    id: r.id,
    name: r.name,
    schoolNumber: r.school_number,
    grade: r.grade,
    isAdmin: !!r.is_admin,
    banned: !!r.banned,
    avatarUrl: r.avatar_url || null,
    joinedAt: Date.parse(r.joined_at)
  } : null;

  /* Turns raw database errors into messages a student understands. */
  const friendly = (error) => {
    if (/BLOCKED_CONTENT/.test(error.message)) {
      return 'Your text contains words that are not allowed at school. Please rewrite it.';
    }
    if (/row-level security/i.test(error.message)) {
      return 'Your account is not allowed to do that. If you think this is a mistake, talk to the moderators.';
    }
    return error.message;
  };

  const rowToItem = (r) => r ? {
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    category: r.category,
    condition: r.condition,
    description: r.description,
    image: r.image_url,
    status: r.status,
    createdAt: Date.parse(r.created_at),
    owner: rowToUser(r.owner)
  } : null;

  const rowToRequest = (r) => r ? {
    id: r.id,
    itemId: r.item_id,
    fromUserId: r.from_user_id,
    offeredItemId: r.offered_item_id,
    message: r.message,
    status: r.status,
    createdAt: Date.parse(r.created_at),
    item: rowToItem(r.item),
    offered: rowToItem(r.offered),
    sender: rowToUser(r.sender)
  } : null;

  function dataURLtoBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* ---------- users & session ---------- */

  let cachedProfile = null;

  async function currentUser() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      cachedProfile = null;
      return null;
    }
    if (cachedProfile && cachedProfile.id === session.user.id) return cachedProfile;
    const { data } = await db.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    cachedProfile = rowToUser(data);
    return cachedProfile;
  }

  async function signUp(data) {
    const email = String(data.email || '').trim().toLowerCase();
    const name = String(data.name || '').trim();
    const grade = String(data.grade || '').trim();
    const password = String(data.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Please enter a real email address.' };
    if (!name) return { ok: false, error: 'Please enter your name.' };
    if (!GRADES.includes(grade)) return { ok: false, error: 'Please choose your grade or role.' };
    if (password.length < 6) return { ok: false, error: 'Password needs at least 6 characters.' };

    const { data: result, error } = await db.auth.signUp({
      email,
      password,
      options: { data: { name, grade } }
    });
    if (error) {
      if (/already registered/i.test(error.message)) {
        return { ok: false, error: 'That email already has an account. Try logging in instead.' };
      }
      return { ok: false, error: error.message };
    }
    if (!result.session) {
      return { ok: false, error: 'Almost there — the Supabase project still requires email confirmation. In the dashboard, turn off "Confirm email" under Authentication → Sign In / Providers → Email.' };
    }
    cachedProfile = null;
    return { ok: true };
  }

  /* Accepts an email address, or a school number for accounts made
     before email login existed. */
  async function logIn(identifier, password) {
    const id = String(identifier || '').trim();
    const email = id.includes('@') ? id.toLowerCase() : emailFor(id);
    const { error } = await db.auth.signInWithPassword({
      email,
      password: String(password || '')
    });
    if (error) {
      if (/not confirmed/i.test(error.message)) {
        return { ok: false, error: 'This account is waiting for email confirmation. In the Supabase dashboard, turn off "Confirm email" under Authentication → Sign In / Providers → Email.' };
      }
      return { ok: false, error: 'Email (or school number) or password is incorrect.' };
    }
    cachedProfile = null;
    return { ok: true };
  }

  /* Private contact details — the database only returns these for
     yourself, an admin, or your partner in an accepted swap. */
  async function getContact(userId) {
    const { data } = await db.from('contacts').select('*').eq('user_id', userId).maybeSingle();
    if (!data) return null;
    const email = data.email && !data.email.endsWith('@sss-swap.app') ? data.email : null;
    return { email, phone: data.phone || null };
  }

  async function logOut() {
    await db.auth.signOut();
    cachedProfile = null;
  }

  /* ---------- items ---------- */

  const ITEM_SELECT = '*, owner:profiles(*)';

  async function listItems(opts = {}) {
    let query = db.from('items').select(ITEM_SELECT).order('created_at', { ascending: false });
    if (!opts.includeSwapped) query = query.eq('status', 'available');
    if (opts.category) query = query.eq('category', opts.category);
    if (opts.ownerId) query = query.eq('owner_id', opts.ownerId);
    if (opts.q) {
      const safe = String(opts.q).replace(/[%_,()]/g, ' ').trim();
      if (safe) query = query.or('title.ilike.%' + safe + '%,description.ilike.%' + safe + '%');
    }
    const { data, error } = await query;
    if (error) {
      console.error('listItems:', error.message);
      return [];
    }
    return data.map(rowToItem);
  }

  async function getItem(id) {
    if (!id) return null;
    const { data, error } = await db.from('items').select(ITEM_SELECT).eq('id', id).maybeSingle();
    if (error) return null;
    return rowToItem(data);
  }

  async function addItem(data) {
    const me = await currentUser();
    if (!me) return { ok: false, error: 'Log in to post an item.' };
    const title = String(data.title || '').trim();
    if (title.length < 3) return { ok: false, error: 'Give your item a short title (at least 3 characters).' };
    if (!CATEGORIES.some(c => c.id === data.category)) return { ok: false, error: 'Pick a category.' };
    if (!CONDITIONS.includes(data.condition)) return { ok: false, error: 'Pick a condition.' };

    let imageUrl = null;
    if (data.image) {
      const path = me.id + '/' + Date.now() + '.jpg';
      const { error: upErr } = await db.storage.from('item-photos')
        .upload(path, dataURLtoBlob(data.image), { contentType: 'image/jpeg' });
      if (upErr) return { ok: false, error: 'Photo upload failed: ' + upErr.message };
      imageUrl = db.storage.from('item-photos').getPublicUrl(path).data.publicUrl;
    }

    const { data: row, error } = await db.from('items').insert({
      owner_id: me.id,
      title,
      category: data.category,
      condition: data.condition,
      description: String(data.description || '').trim(),
      image_url: imageUrl
    }).select(ITEM_SELECT).single();
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true, item: rowToItem(row) };
  }

  async function removeItem(id) {
    const { error } = await db.from('items').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  /* ---------- swap requests ---------- */

  const REQUEST_SELECT = '*, ' +
    'item:items!requests_item_id_fkey(*, owner:profiles(*)), ' +
    'offered:items!requests_offered_item_id_fkey(*), ' +
    'sender:profiles!requests_from_user_id_fkey(*)';

  async function createRequest(data) {
    const me = await currentUser();
    if (!me) return { ok: false, error: 'Log in to request a swap.' };
    const item = await getItem(data.itemId);
    if (!item || item.status !== 'available') return { ok: false, error: 'This item is no longer available.' };
    if (item.ownerId === me.id) return { ok: false, error: 'This is your own item.' };
    const offeredItemId = data.offeredItemId || null;
    if (offeredItemId) {
      const offered = await getItem(offeredItemId);
      if (!offered || offered.ownerId !== me.id || offered.status !== 'available') {
        return { ok: false, error: 'The item you offered is not available.' };
      }
    }
    const { data: row, error } = await db.from('requests').insert({
      item_id: data.itemId,
      from_user_id: me.id,
      offered_item_id: offeredItemId,
      message: String(data.message || '').trim()
    }).select('id').single();
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'You already have a pending request for this item.' };
      return { ok: false, error: friendly(error) };
    }
    return { ok: true, requestId: row.id };
  }

  async function getRequest(id) {
    if (!id) return null;
    const { data, error } = await db.from('requests').select(REQUEST_SELECT).eq('id', id).maybeSingle();
    if (error) return null;
    return rowToRequest(data);
  }

  /* Everything the logged-in student is part of, split into
     requests for their items and requests they sent. Each request
     carries an `unread` chat message count. */
  async function myRequests() {
    const me = await currentUser();
    if (!me) return { incoming: [], sent: [] };
    const [reqRes, unreadRes, ratingRes] = await Promise.all([
      db.from('requests').select(REQUEST_SELECT).order('created_at', { ascending: false }),
      db.from('messages').select('request_id').neq('sender_id', me.id).is('read_at', null),
      db.from('ratings').select('request_id, score').eq('rater_id', me.id)
    ]);
    if (reqRes.error) {
      console.error('myRequests:', reqRes.error.message);
      return { incoming: [], sent: [] };
    }
    const unread = {};
    (unreadRes.data || []).forEach(m => { unread[m.request_id] = (unread[m.request_id] || 0) + 1; });
    const myRatings = {};
    (ratingRes.data || []).forEach(r => { myRatings[r.request_id] = r.score; });
    const rows = reqRes.data.map(r => Object.assign(rowToRequest(r), {
      unread: unread[r.id] || 0,
      myRating: myRatings[r.id] || null
    }));
    return {
      incoming: rows.filter(r => r.item && r.item.ownerId === me.id),
      sent: rows.filter(r => r.fromUserId === me.id)
    };
  }

  /* The logged-in student's own pending request for an item, if any. */
  async function pendingRequestFor(itemId) {
    const me = await currentUser();
    if (!me) return null;
    const { data } = await db.from('requests')
      .select('id, status')
      .eq('item_id', itemId)
      .eq('from_user_id', me.id)
      .eq('status', 'pending')
      .maybeSingle();
    return data || null;
  }

  async function acceptRequest(id) {
    const { error } = await db.rpc('accept_request', { req_id: id });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function declineRequest(id) {
    const { error } = await db.rpc('decline_request', { req_id: id });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  /* ---------- chat ---------- */

  const rowToMessage = (r) => ({
    id: r.id,
    requestId: r.request_id,
    senderId: r.sender_id,
    body: r.body,
    createdAt: Date.parse(r.created_at),
    readAt: r.read_at
  });

  async function listMessages(requestId) {
    const { data, error } = await db.from('messages')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('listMessages:', error.message);
      return [];
    }
    return data.map(rowToMessage);
  }

  async function sendMessage(requestId, body) {
    const me = await currentUser();
    if (!me) return { ok: false, error: 'Log in first.' };
    const text = String(body || '').trim();
    if (!text) return { ok: false, error: 'Write a message first.' };
    const { error } = await db.from('messages').insert({
      request_id: requestId,
      sender_id: me.id,
      body: text.slice(0, 500)
    });
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true };
  }

  /* Marks every message the other student sent in this thread as read. */
  async function markThreadRead(requestId) {
    const me = await currentUser();
    if (!me) return;
    await db.from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('request_id', requestId)
      .neq('sender_id', me.id)
      .is('read_at', null);
  }

  /* Badge numbers for the header: pending requests for my items
     plus unread chat messages. */
  async function notificationCounts() {
    const me = await currentUser();
    if (!me) return { requests: 0, messages: 0, total: 0 };
    const [reqRes, msgRes] = await Promise.all([
      db.from('requests')
        .select('id, item:items!requests_item_id_fkey!inner(owner_id)', { count: 'exact', head: true })
        .eq('item.owner_id', me.id)
        .eq('status', 'pending'),
      db.from('messages')
        .select('id', { count: 'exact', head: true })
        .neq('sender_id', me.id)
        .is('read_at', null)
    ]);
    const requests = reqRes.count || 0;
    const messages = msgRes.count || 0;
    return { requests, messages, total: requests + messages };
  }

  /* ---------- wishlist ---------- */

  const rowToWish = (r) => r ? {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    category: r.category,
    status: r.status,
    createdAt: Date.parse(r.created_at),
    owner: rowToUser(r.owner)
  } : null;

  async function listWishes() {
    const { data, error } = await db.from('wishes')
      .select('*, owner:profiles(*)')
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('listWishes:', error.message);
      return [];
    }
    return data.map(rowToWish);
  }

  async function addWish(data) {
    const me = await currentUser();
    if (!me) return { ok: false, error: 'Log in to post a wish.' };
    const title = String(data.title || '').trim();
    if (title.length < 3) return { ok: false, error: 'Describe what you need (at least 3 characters).' };
    if (!CATEGORIES.some(c => c.id === data.category)) return { ok: false, error: 'Pick a category.' };
    const { error } = await db.from('wishes').insert({
      user_id: me.id,
      title: title.slice(0, 80),
      category: data.category
    });
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true };
  }

  async function markWishFound(id) {
    const { error } = await db.from('wishes').update({ status: 'found' }).eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function removeWish(id) {
    const { error } = await db.from('wishes').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  /* ---------- swap ratings ---------- */

  async function rateSwap(requestId, ratedId, score) {
    const me = await currentUser();
    if (!me) return { ok: false, error: 'Log in first.' };
    const { error } = await db.from('ratings').insert({
      request_id: requestId,
      rater_id: me.id,
      rated_id: ratedId,
      score
    });
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'You already rated this swap.' };
      return { ok: false, error: friendly(error) };
    }
    return { ok: true };
  }

  /* Reputation shown next to a student's name: how many rated swaps
     they have, and what share went well. */
  async function ratingSummary(userId) {
    const { data, error } = await db.from('ratings').select('score').eq('rated_id', userId);
    if (error || !data || data.length === 0) return { count: 0, positive: 0 };
    const count = data.length;
    const positive = Math.round(100 * data.filter(r => r.score === 3).length / count);
    return { count, positive };
  }

  /* ---------- badges ---------- */

  async function myBadges() {
    const me = await currentUser();
    if (!me) return [];
    const [reqs, itemsRes, thumbsRes, stickersRes, earlierRes] = await Promise.all([
      myRequests(),
      db.from('items').select('id', { count: 'exact', head: true }).eq('owner_id', me.id),
      db.from('ratings').select('id', { count: 'exact', head: true }).eq('rated_id', me.id).eq('score', 3),
      db.from('stickers').select('id', { count: 'exact', head: true }).eq('user_id', me.id),
      db.from('profiles').select('id', { count: 'exact', head: true }).lt('joined_at', new Date(me.joinedAt).toISOString())
    ]);
    const swaps = reqs.incoming.filter(r => r.status === 'accepted').length
                + reqs.sent.filter(r => r.status === 'accepted').length;
    const posted = itemsRes.count || 0;
    const thumbs = thumbsRes.count || 0;
    const stickers = stickersRes.count || 0;
    const earlier = earlierRes.count == null ? 999 : earlierRes.count;
    return [
      { emoji: '🐝', label: 'Early bee',      desc: 'One of the first 20 members',           earned: earlier < 20 },
      { emoji: '🌱', label: 'First swap',     desc: 'Complete your first swap',              earned: swaps >= 1 },
      { emoji: '♻️', label: 'Eco hero',       desc: 'Complete 10 swaps',                     earned: swaps >= 10 },
      { emoji: '📦', label: 'Generous giver', desc: 'Post 5 items on the board',             earned: posted >= 5 },
      { emoji: '💚', label: 'Well loved',     desc: 'Get 5 👍 ratings from swap partners',   earned: thumbs >= 5 },
      { emoji: '✨', label: 'Decorator',      desc: 'Have 5 stickers on the wall',           earned: stickers >= 5 }
    ];
  }

  /* ---------- profile picture ---------- */

  async function updateAvatar(dataUrl) {
    const me = await currentUser();
    if (!me) return { ok: false, error: 'Log in first.' };
    const path = 'avatars/' + me.id + '-' + Date.now() + '.jpg';
    const { error: upErr } = await db.storage.from('item-photos')
      .upload(path, dataURLtoBlob(dataUrl), { contentType: 'image/jpeg' });
    if (upErr) return { ok: false, error: 'Photo upload failed: ' + upErr.message };
    const url = db.storage.from('item-photos').getPublicUrl(path).data.publicUrl;
    const { error } = await db.from('profiles').update({ avatar_url: url }).eq('id', me.id);
    if (error) return { ok: false, error: error.message };
    cachedProfile = null;
    return { ok: true, url };
  }

  /* ---------- sticker wall ---------- */

  async function listStickers() {
    const { data, error } = await db.from('stickers')
      .select('*, owner:profiles(name)')
      .order('created_at', { ascending: true });
    if (error) {
      console.error('listStickers:', error.message);
      return [];
    }
    return data.map(s => ({
      id: s.id,
      userId: s.user_id,
      emoji: s.emoji,
      x: Number(s.x),
      y: Number(s.y),
      rot: Number(s.rot),
      ownerName: s.owner ? s.owner.name : ''
    }));
  }

  async function addSticker(emoji, x, y) {
    const me = await currentUser();
    if (!me) return { ok: false, error: 'Log in to stick a sticker.' };
    if (me.banned) return { ok: false, error: 'Your account is muted — you cannot place stickers.' };
    const { error } = await db.from('stickers').insert({
      user_id: me.id,
      emoji: String(emoji).slice(0, 8),
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      rot: Math.round((Math.random() * 32 - 16) * 10) / 10
    });
    if (error) {
      if (/row-level security/i.test(error.message)) {
        return { ok: false, error: "You've used all 5 of your stickers — click one of yours to remove it first." };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  async function removeSticker(id) {
    const { error } = await db.from('stickers').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  /* ---------- scene decorations (admin's live visual editor) ---------- */

  const rowToDecoration = (r) => r ? {
    id: r.id, page: r.page, src: r.src,
    x: Number(r.x), y: Number(r.y), w: Number(r.w)
  } : null;

  async function listDecorations(page) {
    const { data, error } = await db.from('decorations')
      .select('*').eq('page', page).order('created_at', { ascending: true });
    if (error) return [];
    return data.map(rowToDecoration);
  }

  async function uploadDecorImage(dataUrl) {
    const blob = dataURLtoBlob(dataUrl);
    const ext = blob.type === 'image/png' ? '.png' : '.jpg';
    const path = 'decor/' + Date.now() + ext;
    const { error } = await db.storage.from('item-photos')
      .upload(path, blob, { contentType: blob.type });
    if (error) return { ok: false, error: 'Upload failed: ' + error.message };
    return { ok: true, url: db.storage.from('item-photos').getPublicUrl(path).data.publicUrl };
  }

  async function addDecoration(deco) {
    const { data, error } = await db.from('decorations').insert({
      page: deco.page, src: deco.src, x: deco.x, y: deco.y, w: deco.w
    }).select('*').single();
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true, decoration: rowToDecoration(data) };
  }

  async function updateDecoration(id, patch) {
    const { error } = await db.from('decorations').update(patch).eq('id', id);
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true };
  }

  async function removeDecoration(id) {
    const { error } = await db.from('decorations').delete().eq('id', id);
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true };
  }

  /* ---------- moderation ---------- */

  /* Any student can flag an item for the moderators. */
  async function reportItem(itemId, reason) {
    const me = await currentUser();
    if (!me) return { ok: false, error: 'Log in to report an item.' };
    const { error } = await db.from('reports').insert({
      item_id: itemId,
      reporter_id: me.id,
      reason: String(reason || '').trim().slice(0, 300)
    });
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'You already reported this item — the moderators will take a look.' };
      return { ok: false, error: friendly(error) };
    }
    return { ok: true };
  }

  /* ---------- admin (protected by database rules, not just the UI) ---------- */

  async function adminListReports() {
    const { data, error } = await db.from('reports')
      .select('*, item:items(*, owner:profiles(*)), reporter:profiles(*)')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('adminListReports:', error.message);
      return [];
    }
    return data.map(r => ({
      id: r.id,
      itemId: r.item_id,
      reason: r.reason,
      createdAt: Date.parse(r.created_at),
      item: rowToItem(r.item),
      reporter: rowToUser(r.reporter)
    }));
  }

  async function adminDismissReports(itemId) {
    const { error } = await db.from('reports').delete().eq('item_id', itemId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function adminSetBanned(userId, value) {
    const { error } = await db.rpc('set_banned', { target: userId, value });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function adminListStudents() {
    const { data, error } = await db.from('profiles')
      .select('*')
      .order('joined_at', { ascending: false });
    if (error) return [];
    return data.map(rowToUser);
  }

  async function adminListWords() {
    const { data, error } = await db.from('blocked_words').select('word').order('word');
    if (error) return [];
    return data.map(r => r.word);
  }

  async function adminAddWord(word) {
    const clean = String(word || '').trim().toLowerCase().slice(0, 40);
    if (!clean) return { ok: false, error: 'Type a word first.' };
    const { error } = await db.from('blocked_words').insert({ word: clean });
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'That word is already on the list.' };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  async function adminRemoveWord(word) {
    const { error } = await db.from('blocked_words').delete().eq('word', word);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  /* ---------- stats ---------- */

  async function stats() {
    const { data, error } = await db.rpc('site_stats');
    if (error) {
      console.error('stats:', error.message);
      return { members: 0, listed: 0, swaps: 0 };
    }
    return data;
  }

  return {
    CATEGORIES, CONDITIONS, GRADES,
    signUp, logIn, logOut, currentUser, getContact,
    listItems, getItem, addItem, removeItem,
    createRequest, getRequest, myRequests, pendingRequestFor,
    acceptRequest, declineRequest,
    listMessages, sendMessage, markThreadRead, notificationCounts,
    updateAvatar,
    listDecorations, uploadDecorImage, addDecoration, updateDecoration, removeDecoration,
    listWishes, addWish, markWishFound, removeWish,
    rateSwap, ratingSummary, myBadges,
    listStickers, addSticker, removeSticker,
    reportItem,
    adminListReports, adminDismissReports, adminSetBanned,
    adminListStudents, adminListWords, adminAddWord, adminRemoveWord,
    stats
  };
})();
