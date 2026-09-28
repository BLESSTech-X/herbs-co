/* ============================================================================
   Herbs-Co — config.js
   Shared utilities for the public landing page and admin CMS.
   Plain JS. No frameworks. No build step.

   SCHEMA (from spec — do not extend):
     profiles:         id, role, agent_code
     content:          id, section, title, body, media_url, media_type,
                       sort_order, active, created_at, updated_at
     contact_links:    id, key, label, value, icon, active, sort_order
     site_settings:    key, value (JSONB), updated_at
     form_submissions: id, form_type, name, phone, email, message,
                       handled, created_at
     click_events:     id, link_key, ip_hash, created_at
   ============================================================================ */

const SB_URL = 'https://brrgwkgfvzwebcgxwzca.supabase.co';
const SB_KEY = 'sb_publishable_zTmYB-DyadCMbnRTdcLu1g_aHL5Cw5m';
const CONFIG = {
  brandName: 'Herbs-Co',
  tagline:   'Wellness that pays.',
  waNumber:  '260979603741',
  siteUrl:   'https://herbs-co.vercel.app',
  colors: {
    primary: '#0a4d3a',
    accent:  '#d4a017',
    cream:   '#faf7f0',
    dark:    '#0a1a14',
  },
  currency: 'ZMW',
  settings: {},
};

/* ─── SESSION ───────────────────────────────────────────────────────────── */
const SESSION_KEY = 'hc_admin_session';

function _readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function _writeSession(obj) {
  try {
    if (obj) sessionStorage.setItem(SESSION_KEY, JSON.stringify(obj));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch (e) { /* ignore */ }
}

/* ─── AUTH ──────────────────────────────────────────────────────────────── */
const auth = {
  async signIn(email, password) {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        data.error_description ||
        data.msg ||
        data.error ||
        'Sign in failed'
      );
    }
    _writeSession({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    data.expires_at,
      user_id:       data.user && data.user.id,
      email:         data.user && data.user.email,
    });
    return data;
  },

  async signOut() {
    const token = auth.currentToken();
    if (token) {
      try {
        await fetch(`${SB_URL}/auth/v1/logout`, {
          method: 'POST',
          headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` },
        });
      } catch (e) { /* ignore */ }
    }
    _writeSession(null);
  },

  currentUserId() { const s = _readSession(); return s ? s.user_id : null; },
  currentEmail()  { const s = _readSession(); return s ? s.email : null; },
  currentToken()  { const s = _readSession(); return s ? s.access_token : null; },
  isLoggedIn()    { const s = _readSession(); return !!(s && s.access_token); },
  _session()      { return _readSession(); },

  async refresh() {
    const s = _readSession();
    if (!s || !s.refresh_token) return null;
    try {
      const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      if (!res.ok) { _writeSession(null); return null; }
      const data = await res.json();
      _writeSession({
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_at:    data.expires_at,
        user_id:       data.user && data.user.id,
        email:         data.user && data.user.email,
      });
      return data.access_token;
    } catch (e) {
      _writeSession(null);
      return null;
    }
  },
};

/* ─── DATABASE ──────────────────────────────────────────────────────────── */
// Supports: { select, eq:{}, neq:{}, gt:{}, gte:{}, lt:{}, lte:{},
//             ilike:{}, in:{}, is:{}, or, order, limit, offset }
function _buildQuery(opts) {
  const parts = [];
  if (opts.select) parts.push(`select=${encodeURIComponent(opts.select)}`);
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike'].forEach(op => {
    if (opts[op]) {
      Object.entries(opts[op]).forEach(([k, v]) => {
        parts.push(`${k}=${op}.${encodeURIComponent(v)}`);
      });
    }
  });
  if (opts.in) {
    Object.entries(opts.in).forEach(([k, arr]) => {
      const list = Array.isArray(arr)
        ? arr.map(x => `"${x}"`).join(',')
        : arr;
      parts.push(`${k}=in.(${list})`);
    });
  }
  if (opts.is) {
    Object.entries(opts.is).forEach(([k, v]) => {
      parts.push(`${k}=is.${v}`);
    });
  }
  if (opts.or) parts.push(`or=(${opts.or})`);
  if (opts.order) parts.push(`order=${opts.order}`);
  if (opts.limit != null) parts.push(`limit=${opts.limit}`);
  if (opts.offset != null) parts.push(`offset=${opts.offset}`);
  return parts.join('&');
}

async function _dbFetch(path, options = {}, _retried = false) {
  const token = auth.currentToken();
  const headers = {
    apikey: SB_KEY,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { ...options, headers });

  if (res.status === 401 && !_retried && auth._session() && auth._session().refresh_token) {
    const newTok = await auth.refresh();
    if (newTok) return _dbFetch(path, options, true);
  }
  return res;
}

const db = {
  async query(table, opts = {}) {
    const qs = _buildQuery(opts);
    const path = `${table}${qs ? '?' + qs : ''}`;
    const res = await _dbFetch(path);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Query failed on ${table}`);
    }
    if (res.status === 204) return [];
    return res.json();
  },

  async insert(table, data) {
    const res = await _dbFetch(table, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Insert failed on ${table}`);
    }
    const out = await res.json();
    return Array.isArray(out) ? out[0] : out;
  },

  async update(table, filter, data) {
    const qs = _buildQuery({ ...filter });
    const res = await _dbFetch(`${table}?${qs}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Update failed on ${table}`);
    }
    const out = await res.json();
    return Array.isArray(out) ? out[0] : out;
  },

  async remove(table, filter) {
    const qs = _buildQuery({ ...filter });
    const res = await _dbFetch(`${table}?${qs}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Delete failed on ${table}`);
    }
    return res.json().catch(() => null);
  },

  async getOne(table, filter) {
    const rows = await db.query(table, { ...filter, limit: 1 });
    return rows && rows.length ? rows[0] : null;
  },

  async getAll(table, opts = {}) {
    return db.query(table, opts);
  },
};

/* ─── DATA LOADERS ──────────────────────────────────────────────────────── */
let _profileCache = null;
async function getProfile() {
  if (_profileCache) return _profileCache;
  const uid = auth.currentUserId();
  if (!uid) return null;
  try {
    const row = await db.getOne('profiles', { eq: { id: uid } });
    _profileCache = row;
    return row;
  } catch (e) {
    return null;
  }
}

async function isAdmin() {
  const p = await getProfile();
  return !!(p && p.role === 'admin');
}

async function getContent(section) {
  try {
    const opts = {
      eq: { active: true },
      order: 'sort_order.asc',
    };
    if (section) opts.eq.section = section;
    const rows = await db.query('content', opts);
    return rows || [];
  } catch (e) {
    return [];
  }
}

async function getLinks() {
  try {
    const rows = await db.query('contact_links', {
      eq: { active: true },
      order: 'sort_order.asc',
    });
    return rows || [];
  } catch (e) {
    return [];
  }
}

async function getSiteSettings() {
  try {
    const rows = await db.query('site_settings', { select: 'key,value' });
    const out = {};
    (rows || []).forEach(r => {
      out[r.key] = r.value;
    });
    CONFIG.settings = out;
    return out;
  } catch (e) {
    CONFIG.settings = {};
    return {};
  }
}

// Fire-and-forget. Never throws.
async function submitForm(payload) {
  const res = await fetch(`${SB_URL}/rest/v1/form_submissions`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      form_type: payload.form_type || 'contact',
      name:      payload.name || null,
      phone:     payload.phone || null,
      email:     payload.email || null,
      message:   payload.message || null,
      handled:   false,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Submission failed');
  }
  return true;
}

// Fire-and-forget. Never throws. Swallows errors silently.
async function trackClick(linkKey) {
  try {
    await fetch(`${SB_URL}/rest/v1/click_events`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ link_key: linkKey || 'unknown' }),
    });
  } catch (e) { /* silent */ }
}

/* ─── STORAGE ───────────────────────────────────────────────────────────── */
function _uploadToBucket(bucket, file, onProgress) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file selected'));
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const token = auth.currentToken();

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SB_URL}/storage/v1/object/${bucket}/${path}`);
    xhr.setRequestHeader('apikey', SB_KEY);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'true');

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(`${SB_URL}/storage/v1/object/public/${bucket}/${path}`);
      } else {
        let msg = 'Upload failed';
        try {
          const err = JSON.parse(xhr.responseText);
          if (err.message) msg = err.message;
        } catch (e) { /* ignore */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

async function uploadContentImage(file, onProgress) {
  if (!file) throw new Error('No file selected');
  if (!/^image\//.test(file.type)) throw new Error('Not an image file');
  if (file.size > 8 * 1024 * 1024) throw new Error('Image must be under 8MB');
  return _uploadToBucket('content-images', file, onProgress);
}

async function uploadContentVideo(file, onProgress) {
  if (!file) throw new Error('No file selected');
  if (file.type !== 'video/mp4') throw new Error('Only MP4 videos are allowed');
  if (file.size > 50 * 1024 * 1024) throw new Error('Video must be under 50MB');
  return _uploadToBucket('content-videos', file, onProgress);
}

/* ─── UTILITIES ─────────────────────────────────────────────────────────── */
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const _MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function _toDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

function fmtDate(d) {
  const dt = _toDate(d);
  if (!dt) return '—';
  return `${dt.getDate()} ${_MONTHS_SHORT[dt.getMonth()]} ${dt.getFullYear()}`;
}

function fmtDateTime(d) {
  const dt = _toDate(d);
  if (!dt) return '—';
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${fmtDate(dt)} · ${hh}:${mm}`;
}

function fmtMoney(n) {
  const num = Number(n || 0);
  return `ZMW ${num.toLocaleString('en-ZM', { maximumFractionDigits: 2 })}`;
}

function toast(msg, duration = 3000) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = msg;
  el.appendChild(item);
  requestAnimationFrame(() => item.classList.add('toast-show'));
  setTimeout(() => {
    item.classList.remove('toast-show');
    setTimeout(() => item.remove(), 300);
  }, duration);
}

function setLoading(btn, loading, label) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset._origHtml) btn.dataset._origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${esc(label || 'Working…')}`;
  } else {
    btn.disabled = false;
    if (btn.dataset._origHtml) {
      btn.innerHTML = btn.dataset._origHtml;
      delete btn.dataset._origHtml;
    }
  }
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Copied to clipboard');
    return true;
  } catch (e) {
    toast('Could not copy');
    return false;
  }
}

function waLink(number, msg) {
  const num = String(number || CONFIG.waNumber).replace(/\D/g, '');
  const text = msg ? `?text=${encodeURIComponent(msg)}` : '';
  return `https://wa.me/${num}${text}`;
}

function telLink(number) {
  const num = String(number || '').replace(/[^\d+]/g, '');
  return `tel:${num}`;
}

function mailtoLink(email, subject, body) {
  const parts = [];
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
  if (body) parts.push(`body=${encodeURIComponent(body)}`);
  const qs = parts.length ? `?${parts.join('&')}` : '';
  return `mailto:${email}${qs}`;
}

// Loose Zambian phone check. Accepts +260XXXXXXXXX, 260XXXXXXXXX, 09XXXXXXXX,
// 0XXXXXXXXX. Must contain 9-12 digits total.
function isPhoneZambia(s) {
  if (!s) return false;
  const digits = String(s).replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 12) return false;
  return true;
}

/* ─── BOOT HELPERS ──────────────────────────────────────────────────────── */
// Apply site settings overrides onto CONFIG. Called after getSiteSettings().
function applySiteSettingsToConfig() {
  const s = CONFIG.settings || {};
  if (s.brand_name)    CONFIG.brandName = s.brand_name;
  if (s.tagline)       CONFIG.tagline   = s.tagline;
  if (s.wa_number)     CONFIG.waNumber  = s.wa_number;
  if (s.site_url)      CONFIG.siteUrl   = s.site_url;
}

// Resolve a WhatsApp group invite URL. Prefers site_settings.group_invite_url,
// then falls back to contact_links.key = 'group'.
async function getGroupInviteUrl(links) {
  const s = CONFIG.settings || {};
  if (s.group_invite_url) return s.group_invite_url;
  const list = links || await getLinks();
  const g = (list || []).find(l => l.key === 'group');
  return g ? g.value : '';
}

// Turn a YouTube / youtu.be / direct video URL into an embeddable form.
// Returns { kind: 'youtube'|'mp4'|'unknown', src }.
function videoEmbed(url) {
  if (!url) return { kind: 'unknown', src: '' };
  const u = String(url).trim();
  // Matches youtube.com/watch, youtu.be, /shorts/, /embed/, /live/, /v/, m.youtube.com
  const yt = u.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/
  );
  if (yt) return { kind: 'youtube', src: `https://www.youtube.com/embed/${yt[1]}` };
  if (/\.mp4(\?|$)/i.test(u)) return { kind: 'mp4', src: u };
  return { kind: 'unknown', src: u };
}

// Simple 60-second rate limit using sessionStorage.
function rateLimit(key, seconds = 60) {
  const k = `rl_${key}`;
  const now = Date.now();
  let last = 0;
  try { last = Number(sessionStorage.getItem(k) || 0); } catch (e) { last = 0; }
  if (now - last < seconds * 1000) return false;
  try { sessionStorage.setItem(k, String(now)); } catch (e) { /* ignore */ }
  return true;
}

// Favicon — small inline SVG on load.
(function applyBrandFavicon() {
  try {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0a4d3a"/><text x="16" y="22" font-family="Georgia,serif" font-size="18" font-weight="700" fill="#d4a017" text-anchor="middle">H</text></svg>`
    );
    document.head.appendChild(link);
  } catch (e) { /* ignore */ }
})();
