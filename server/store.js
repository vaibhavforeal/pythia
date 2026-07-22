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
  for (const f of [USERS, PEOPLE, CONV]) if (!fs.existsSync(f)) fs.writeFileSync(f, "[]");

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
