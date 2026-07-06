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
  const GRADES = ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];

  /* ---------- row mappers (snake_case DB → camelCase app) ---------- */

  const rowToUser = (r) => r ? {
    id: r.id,
    name: r.name,
    schoolNumber: r.school_number,
    grade: r.grade,
    joinedAt: Date.parse(r.joined_at)
  } : null;

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
    const schoolNumber = String(data.schoolNumber || '').trim();
    const name = String(data.name || '').trim();
    const grade = String(data.grade || '').trim();
    const password = String(data.password || '');
    if (!/^[0-9]{3,10}$/.test(schoolNumber)) return { ok: false, error: 'School number should be 3–10 digits.' };
    if (!name) return { ok: false, error: 'Please enter your name.' };
    if (!GRADES.includes(grade)) return { ok: false, error: 'Please choose your grade.' };
    if (password.length < 6) return { ok: false, error: 'Password needs at least 6 characters.' };

    const { data: result, error } = await db.auth.signUp({
      email: emailFor(schoolNumber),
      password,
      options: { data: { school_number: schoolNumber, name, grade } }
    });
    if (error) {
      if (/already registered/i.test(error.message)) {
        return { ok: false, error: 'That school number already has an account. Try logging in instead.' };
      }
      return { ok: false, error: error.message };
    }
    if (!result.session) {
      return { ok: false, error: 'Almost there — the Supabase project still requires email confirmation. In the dashboard, turn off "Confirm email" under Authentication → Sign In / Providers → Email.' };
    }
    cachedProfile = null;
    return { ok: true };
  }

  async function logIn(schoolNumber, password) {
    const { error } = await db.auth.signInWithPassword({
      email: emailFor(schoolNumber),
      password: String(password || '')
    });
    if (error) {
      if (/not confirmed/i.test(error.message)) {
        return { ok: false, error: 'This account is waiting for email confirmation. In the Supabase dashboard, turn off "Confirm email" under Authentication → Sign In / Providers → Email.' };
      }
      return { ok: false, error: 'School number or password is incorrect.' };
    }
    cachedProfile = null;
    return { ok: true };
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
    if (error) return { ok: false, error: error.message };
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
    const { error } = await db.from('requests').insert({
      item_id: data.itemId,
      from_user_id: me.id,
      offered_item_id: offeredItemId,
      message: String(data.message || '').trim()
    });
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'You already have a pending request for this item.' };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  /* Everything the logged-in student is part of, split into
     requests for their items and requests they sent. */
  async function myRequests() {
    const me = await currentUser();
    if (!me) return { incoming: [], sent: [] };
    const { data, error } = await db.from('requests')
      .select(REQUEST_SELECT)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('myRequests:', error.message);
      return { incoming: [], sent: [] };
    }
    const rows = data.map(rowToRequest);
    return {
      incoming: rows.filter(r => r.item && r.item.ownerId === me.id),
      sent: rows.filter(r => r.fromUserId === me.id)
    };
  }

  async function hasPendingRequest(itemId) {
    const me = await currentUser();
    if (!me) return false;
    const { count } = await db.from('requests')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', itemId)
      .eq('from_user_id', me.id)
      .eq('status', 'pending');
    return (count || 0) > 0;
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
    signUp, logIn, logOut, currentUser,
    listItems, getItem, addItem, removeItem,
    createRequest, myRequests, hasPendingRequest,
    acceptRequest, declineRequest,
    stats
  };
})();
