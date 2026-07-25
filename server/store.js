// Data store for users, saved people and saved chat conversations. Uses Supabase
// Postgres when configured (SUPABASE_URL + SUPABASE_SERVICE_KEY), otherwise falls
// back to local JSON files under DATA_DIR — so `npm start` works offline while
// production uses Supabase.
//
// All methods are async (Postgres is over the network). The exported shape —
// { name, users:{...}, people:{...}, conversations:{forUser,get,create,update,remove} }
// is identical for both backends, so the routes don't care which is active.
const path = require("path");
const fs = require("fs");

const URL = (process.env.SUPABASE_URL || "").trim();
const KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();

// Postgres columns are snake_case; the rest of the app speaks camelCase.
const fromInviteRow = r => ({
  token: r.token, userId: r.user_id, name: r.name, birth: r.birth,
  role: r.role, createdAt: r.created_at, expiresAt: r.expires_at
});

// --- Supabase Postgres backend ----------------------------------------------
function supabaseBackend(url, key) {
  if (!/^https?:\/\//i.test(url)) {
    console.error(
      "\n  ✗ SUPABASE_URL is not a valid URL.\n" +
        "    Use your Supabase Project URL (Dashboard → Settings → API → Project URL),\n" +
        "    e.g.  https://abcdefghijkl.supabase.co  — NOT the connection string or the key.\n" +
        `    Got: "${url.slice(0, 40)}${url.length > 40 ? "…" : ""}"\n`
    );
    throw new Error("Invalid SUPABASE_URL");
  }
  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    name: "Supabase Postgres",
    users: {
      // username/email are citext columns → .eq is case-insensitive and wildcard-safe
      async findByUsername(u) {
        const { data, error } = await sb.from("users").select("*").eq("username", String(u)).maybeSingle();
        if (error) throw error;
        return data || undefined;
      },
      async findByEmail(e) {
        const { data, error } = await sb.from("users").select("*").eq("email", String(e)).maybeSingle();
        if (error) throw error;
        return data || undefined;
      },
      async findByGoogleId(gid) {
        const { data, error } = await sb.from("users").select("*").eq("google_id", String(gid)).maybeSingle();
        if (error) throw error;
        return data || undefined;
      },
      async findById(id) {
        const { data, error } = await sb.from("users").select("*").eq("id", id).maybeSingle();
        if (error) throw error;
        return data || undefined;
      },
      async add(user) {
        const { error } = await sb.from("users").insert({
          id: user.id, username: user.username || null, email: user.email || null,
          google_id: user.googleId || null, salt: user.salt || null, hash: user.hash || null,
          created_at: user.createdAt
        });
        if (error) throw error;
        return user;
      },
      async update(id, patch) {
        const upd = {};
        if (patch.googleId !== undefined) upd.google_id = patch.googleId;
        if (patch.email !== undefined) upd.email = patch.email;
        if (patch.salt !== undefined) upd.salt = patch.salt;
        if (patch.hash !== undefined) upd.hash = patch.hash;
        const { error } = await sb.from("users").update(upd).eq("id", id);
        if (error) throw error;
        return true;
      },
      // Streak is exposed as { current, longest, last, days } by both backends,
      // so the column naming stays an implementation detail in here.
      async getStreak(id) {
        const { data, error } = await sb
          .from("users")
          .select("streak_current, streak_longest, streak_last, streak_days")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!data) return null;
        return {
          current: data.streak_current || 0,
          longest: data.streak_longest || 0,
          last: data.streak_last || null,
          days: data.streak_days || 0
        };
      },
      async setStreak(id, s) {
        const { error } = await sb
          .from("users")
          .update({
            streak_current: s.current,
            streak_longest: s.longest,
            streak_last: s.last,
            streak_days: s.days
          })
          .eq("id", id);
        if (error) throw error;
        return true;
      }
    },
    invites: {
      async forUser(userId) {
        const { data, error } = await sb.from("invites").select("*")
          .eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
        if (error) throw error;
        return (data && data[0]) ? fromInviteRow(data[0]) : undefined;
      },
      async get(token) {
        const { data, error } = await sb.from("invites").select("*").eq("token", token).maybeSingle();
        if (error) throw error;
        return data ? fromInviteRow(data) : undefined;
      },
      async add(inv) {
        const { error } = await sb.from("invites").insert({
          token: inv.token, user_id: inv.userId, name: inv.name || null,
          birth: inv.birth, role: inv.role || null,
          created_at: inv.createdAt, expires_at: inv.expiresAt || null
        });
        if (error) throw error;
        return inv;
      },
      async remove(userId, token) {
        const { data, error } = await sb.from("invites").delete()
          .eq("token", token).eq("user_id", userId).select("token");
        if (error) throw error;
        return !!(data && data.length);
      },
      async addResponse(r) {
        const { error } = await sb.from("invite_responses").insert({
          id: r.id, token: r.token, name: r.name || null,
          total: r.total, max: r.max, band: r.band || null, label: r.label || null,
          created_at: r.createdAt
        });
        if (error) throw error;
        return r;
      },
      async responses(token) {
        const { data, error } = await sb.from("invite_responses").select("*")
          .eq("token", token).order("created_at", { ascending: false }).limit(50);
        if (error) throw error;
        return (data || []).map(r => ({
          id: r.id, name: r.name, total: r.total, max: r.max,
          band: r.band, label: r.label, createdAt: r.created_at
        }));
      }
    },
    people: {
      async forUser(userId) {
        const { data, error } = await sb.from("people").select("*").eq("user_id", userId).order("name");
        if (error) throw error;
        return data || [];
      },
      async add(person) {
        const { error } = await sb.from("people").insert({
          id: person.id, user_id: person.userId, name: person.name,
          year: person.year, month: person.month, day: person.day, hour: person.hour, minute: person.minute,
          lat: person.lat, lon: person.lon, tz: person.tz, created_at: person.createdAt
        });
        if (error) throw error;
        return person;
      },
      async remove(userId, id) {
        const { data, error } = await sb.from("people").delete().eq("id", id).eq("user_id", userId).select("id");
        if (error) throw error;
        return (data || []).length > 0;
      }
    },
    conversations: {
      // List is metadata-only (no chart/messages) so the sidebar stays lean.
      async forUser(userId) {
        const { data, error } = await sb.from("conversations")
          .select("id, title, updated_at").eq("user_id", userId).order("updated_at", { ascending: false });
        if (error) throw error;
        return data || [];
      },
      async get(userId, id) {
        const { data, error } = await sb.from("conversations")
          .select("*").eq("id", id).eq("user_id", userId).maybeSingle();
        if (error) throw error;
        return data || undefined;
      },
      async create(c) {
        const { error } = await sb.from("conversations").insert({
          id: c.id, user_id: c.userId, title: c.title,
          chart: c.chart, input: c.input || null, match: c.match || null, messages: c.messages,
          created_at: c.createdAt, updated_at: c.updatedAt
        });
        if (error) throw error;
        return c;
      },
      async update(userId, id, patch) {
        const upd = { updated_at: patch.updatedAt };
        if (patch.messages !== undefined) upd.messages = patch.messages;
        if (patch.title !== undefined) upd.title = patch.title;
        const { data, error } = await sb.from("conversations").update(upd)
          .eq("id", id).eq("user_id", userId).select("id");
        if (error) throw error;
        return (data || []).length > 0;
      },
      async remove(userId, id) {
        const { data, error } = await sb.from("conversations").delete()
          .eq("id", id).eq("user_id", userId).select("id");
        if (error) throw error;
        return (data || []).length > 0;
      }
    }
  };
}

// --- Local JSON-file backend (offline fallback) -----------------------------
function jsonBackend() {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const USERS = path.join(DATA_DIR, "users.json");
  const PEOPLE = path.join(DATA_DIR, "people.json");
  const CONV = path.join(DATA_DIR, "conversations.json");
  const INVITES = path.join(DATA_DIR, "invites.json");
  const INVITE_RES = path.join(DATA_DIR, "invite-responses.json");
  for (const f of [USERS, PEOPLE, CONV, INVITES, INVITE_RES]) {
    if (!fs.existsSync(f)) fs.writeFileSync(f, "[]");
  }

  const read = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return []; } };
  const write = (f, d) => { const t = `${f}.tmp`; fs.writeFileSync(t, JSON.stringify(d, null, 2)); fs.renameSync(t, f); };

  return {
    name: `local JSON files (${DATA_DIR})`,
    users: {
      async findByUsername(u) {
        const t = String(u).toLowerCase();
        return read(USERS).find(x => x.username && x.username.toLowerCase() === t);
      },
      async findByEmail(e) {
        const t = String(e).toLowerCase();
        return read(USERS).find(x => x.email && x.email.toLowerCase() === t);
      },
      async findByGoogleId(gid) {
        return read(USERS).find(x => x.googleId === String(gid));
      },
      async findById(id) {
        return read(USERS).find(x => x.id === id);
      },
      async add(user) {
        const all = read(USERS);
        all.push(user);
        write(USERS, all);
        return user;
      },
      async update(id, patch) {
        const all = read(USERS);
        const u = all.find(x => x.id === id);
        if (!u) return false;
        Object.assign(u, patch);
        write(USERS, all);
        return true;
      },
      // Mirrors the Supabase backend's { current, longest, last, days } shape.
      async getStreak(id) {
        const u = read(USERS).find(x => x.id === id);
        if (!u) return null;
        const s = u.streak || {};
        return {
          current: s.current || 0,
          longest: s.longest || 0,
          last: s.last || null,
          days: s.days || 0
        };
      },
      async setStreak(id, s) {
        const all = read(USERS);
        const u = all.find(x => x.id === id);
        if (!u) return false;
        u.streak = { current: s.current, longest: s.longest, last: s.last, days: s.days };
        write(USERS, all);
        return true;
      }
    },
    // Mirrors the Supabase backend's invite shape exactly.
    invites: {
      async forUser(userId) {
        return read(INVITES)
          .filter(i => i.userId === userId)
          .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
      },
      async get(token) {
        return read(INVITES).find(i => i.token === token);
      },
      async add(inv) {
        const all = read(INVITES);
        all.push(inv);
        write(INVITES, all);
        return inv;
      },
      async remove(userId, token) {
        const all = read(INVITES);
        const next = all.filter(i => !(i.token === token && i.userId === userId));
        write(INVITES, next);
        return next.length !== all.length;
      },
      async addResponse(r) {
        const all = read(INVITE_RES);
        all.push(r);
        write(INVITE_RES, all);
        return r;
      },
      async responses(token) {
        return read(INVITE_RES)
          .filter(r => r.token === token)
          .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
          .slice(0, 50);
      }
    },
    people: {
      async forUser(userId) {
        return read(PEOPLE).filter(p => p.userId === userId)
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      },
      async add(person) {
        const all = read(PEOPLE);
        all.push(person);
        write(PEOPLE, all);
        return person;
      },
      async remove(userId, id) {
        const all = read(PEOPLE);
        const next = all.filter(p => !(p.id === id && p.userId === userId));
        write(PEOPLE, next);
        return next.length !== all.length;
      }
    },
    conversations: {
      async forUser(userId) {
        return read(CONV).filter(c => c.userId === userId)
          .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
          .map(c => ({ id: c.id, title: c.title, updated_at: c.updatedAt }));
      },
      async get(userId, id) {
        const c = read(CONV).find(x => x.id === id && x.userId === userId);
        return c ? { ...c, created_at: c.createdAt, updated_at: c.updatedAt } : undefined;
      },
      async create(c) {
        const all = read(CONV);
        all.push(c);
        write(CONV, all);
        return c;
      },
      async update(userId, id, patch) {
        const all = read(CONV);
        const c = all.find(x => x.id === id && x.userId === userId);
        if (!c) return false;
        if (patch.messages !== undefined) c.messages = patch.messages;
        if (patch.title !== undefined) c.title = patch.title;
        c.updatedAt = patch.updatedAt;
        write(CONV, all);
        return true;
      },
      async remove(userId, id) {
        const all = read(CONV);
        const next = all.filter(x => !(x.id === id && x.userId === userId));
        write(CONV, next);
        return next.length !== all.length;
      }
    }
  };
}

const backend = URL && KEY ? supabaseBackend(URL, KEY) : jsonBackend();

module.exports = backend;
