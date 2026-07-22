// Data store for users and saved people. Uses Supabase Postgres when configured
// (SUPABASE_URL + SUPABASE_SERVICE_KEY), otherwise falls back to local JSON files
// under DATA_DIR — so `npm start` works offline while production uses Supabase.
//
// All methods are async (Postgres is over the network). The exported shape —
// { name, users:{findByUsername,findById,add}, people:{forUser,add,remove} } —
// is identical for both backends, so the routes don't care which is active.
const path = require("path");
const fs = require("fs");

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

// --- Supabase Postgres backend ----------------------------------------------
function supabaseBackend(url, key) {
  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    name: "Supabase Postgres",
    users: {
      async findByUsername(u) {
        // username is a citext column → .eq is case-insensitive and wildcard-safe
        const { data, error } = await sb.from("users").select("*").eq("username", String(u)).maybeSingle();
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
          id: user.id, username: user.username, salt: user.salt, hash: user.hash, created_at: user.createdAt
        });
        if (error) throw error;
        return user;
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
    }
  };
}

// --- Local JSON-file backend (offline fallback) -----------------------------
function jsonBackend() {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const USERS = path.join(DATA_DIR, "users.json");
  const PEOPLE = path.join(DATA_DIR, "people.json");
  for (const f of [USERS, PEOPLE]) if (!fs.existsSync(f)) fs.writeFileSync(f, "[]");

  const read = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return []; } };
  const write = (f, d) => { const t = `${f}.tmp`; fs.writeFileSync(t, JSON.stringify(d, null, 2)); fs.renameSync(t, f); };

  return {
    name: `local JSON files (${DATA_DIR})`,
    users: {
      async findByUsername(u) {
        return read(USERS).find(x => x.username.toLowerCase() === String(u).toLowerCase());
      },
      async findById(id) {
        return read(USERS).find(x => x.id === id);
      },
      async add(user) {
        const all = read(USERS);
        all.push(user);
        write(USERS, all);
        return user;
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
    }
  };
}

const backend = URL && KEY ? supabaseBackend(URL, KEY) : jsonBackend();

module.exports = backend;
