// Firestore backend, exposing exactly the same shape as the Supabase and JSON
// backends in store.js — so every route, and all 144 tests, keep working
// without knowing which storage is underneath.
//
// Two deliberate choices worth stating:
//
// 1. Timestamps stay ISO strings, not Firestore Timestamps. The rest of the app
//    compares and sorts them as strings (streak dates, invite expiry, the
//    "already sent today" guard). Converting here would mean auditing every
//    one of those call sites for a type change that buys nothing.
//
// 2. Pair-membership is stored as an array (`members`, `parties`) alongside the
//    individual fields. Firestore can't efficiently do "userA == me OR userB ==
//    me" as one query, but `array-contains` is a single indexed lookup. The
//    scalar fields are kept because the rest of the code reads them by name.

// Modular API: `admin.apps` was removed in firebase-admin v12, so the old
// namespaced initialisation check no longer exists.
const { getApps, initializeApp, cert, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const COL = {
  users: "users",
  friendships: "friendships",
  friendRequests: "friendRequests",
  blocks: "blocks",
  invites: "invites",
  inviteResponses: "inviteResponses",
  devices: "devices"
};

function firestoreBackend() {
  // Reuse an app if one is already initialised (the emulator harness does this).
  const inline = process.env.FIRESTORE_EMULATOR_HOST ? null : process.env.FIREBASE_SERVICE_ACCOUNT;
  const app = getApps().length
    ? getApps()[0]
    : initializeApp(
      inline
        ? { credential: cert(JSON.parse(inline)) }
        // GOOGLE_APPLICATION_CREDENTIALS, or the ambient service account when
        // running on Google infrastructure. Against the emulator, no creds.
        : (process.env.FIRESTORE_EMULATOR_HOST
          ? { projectId: process.env.GCLOUD_PROJECT || "demo-project" }
          : { credential: applicationDefault() })
    );

  // This project's database is literally named "default", not the conventional
  // "(default)" — see the note in firebase.json. Left unset against the
  // emulator, which only serves "(default)".
  const databaseId = process.env.FIRESTORE_DATABASE_ID;
  const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

  const docData = snap => (snap && snap.exists ? { ...snap.data(), id: snap.id } : undefined);
  const allData = snap => snap.docs.map(d => ({ ...d.data(), id: d.id }));

  /** Firestore rejects undefined values; strip them rather than fail the write. */
  const clean = obj => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
    return out;
  };

  const userRef = uid => db.collection(COL.users).doc(String(uid));

  /** Single-field equality lookup returning at most one document. */
  async function findOneBy(collection, field, value) {
    if (value === undefined || value === null || value === "") return undefined;
    const snap = await db.collection(collection).where(field, "==", String(value)).limit(1).get();
    return snap.empty ? undefined : { ...snap.docs[0].data(), id: snap.docs[0].id };
  }

  return {
    name: "Cloud Firestore",

    users: {
      async findById(id) {
        const snap = await userRef(id).get();
        return docData(snap);
      },
      async findBySoulId(soulId) {
        return findOneBy(COL.users, "soulId", soulId);
      },
      // Email and phone live in Firebase Auth; these mirrors exist only so the
      // few server paths that look a user up by them keep working.
      async findByEmail(email) {
        return findOneBy(COL.users, "email", String(email || "").toLowerCase());
      },
      async findByPhone(phone) {
        return findOneBy(COL.users, "phone", phone);
      },
      // Legacy identifiers. Firebase Auth owns sign-in now, so nothing should
      // reach these; they return undefined rather than throwing so an old code
      // path degrades to "no such user" instead of a 500.
      async findByUsername() { return undefined; },
      async findByGoogleId() { return undefined; },

      async add(user) {
        // The document id IS the Firebase Auth uid, so identity has exactly one
        // source and can't drift.
        const id = user.id || user.uid;
        await userRef(id).set(clean({ ...user, uid: id, id: undefined }), { merge: true });
        return { ...user, id };
      },
      async update(id, patch) {
        await userRef(id).set(clean(patch), { merge: true });
        return true;
      },

      // Streak lives on the user document; the shape is the contract, the
      // storage isn't.
      async getStreak(id) {
        const snap = await userRef(id).get();
        if (!snap.exists) return null;
        const d = snap.data() || {};
        return {
          current: d.streakCurrent || 0,
          longest: d.streakLongest || 0,
          last: d.streakLast || null,
          days: d.streakDays || 0
        };
      },
      async setStreak(id, s) {
        await userRef(id).set({
          streakCurrent: s.current, streakLongest: s.longest,
          streakLast: s.last, streakDays: s.days
        }, { merge: true });
        return true;
      }
    },

    // Phone verification is Firebase Auth's job now. These remain so the
    // interface stays uniform, but nothing should call them.
    otps: {
      async get() { return undefined; },
      async put(rec) { return rec; },
      async remove() { return true; }
    },

    friends: {
      async listFor(userId) {
        const snap = await db.collection(COL.friendships)
          .where("members", "array-contains", String(userId)).get();
        return allData(snap);
      },
      async get(pairKey) {
        return docData(await db.collection(COL.friendships).doc(pairKey).get());
      },
      async add(f) {
        await db.collection(COL.friendships).doc(f.pairKey).set(clean({
          ...f, members: [f.userA, f.userB]
        }));
        return f;
      },
      async remove(pairKey) {
        await db.collection(COL.friendships).doc(pairKey).delete();
        return true;
      },
      async getRequest(pairKey) {
        return docData(await db.collection(COL.friendRequests).doc(pairKey).get());
      },
      async addRequest(r) {
        await db.collection(COL.friendRequests).doc(r.pairKey).set(clean(r));
        return r;
      },
      async removeRequest(pairKey) {
        await db.collection(COL.friendRequests).doc(pairKey).delete();
        return true;
      },
      async requestsTo(userId) {
        const snap = await db.collection(COL.friendRequests)
          .where("to", "==", String(userId))
          .orderBy("createdAt", "desc").limit(50).get();
        return allData(snap);
      },
      async blocksFor(userId) {
        const snap = await db.collection(COL.blocks)
          .where("parties", "array-contains", String(userId)).get();
        return allData(snap);
      },
      async addBlock(b) {
        // Deterministic id so blocking twice can't create two rows.
        await db.collection(COL.blocks).doc(`${b.blocker}__${b.blocked}`).set(clean({
          ...b, parties: [b.blocker, b.blocked]
        }));
        return b;
      },
      async removeBlock(blocker, blocked) {
        await db.collection(COL.blocks).doc(`${blocker}__${blocked}`).delete();
        return true;
      }
    },

    devices: {
      async forUser(userId) {
        const snap = await db.collection(COL.devices)
          .where("userId", "==", String(userId)).get();
        return allData(snap);
      },
      async all() {
        return allData(await db.collection(COL.devices).get());
      },
      async put(d) {
        await db.collection(COL.devices).doc(d.token).set(clean(d), { merge: true });
        return d;
      },
      async remove(token) {
        await db.collection(COL.devices).doc(token).delete();
        return true;
      }
    },

    invites: {
      async forUser(userId) {
        const snap = await db.collection(COL.invites)
          .where("userId", "==", String(userId))
          .orderBy("createdAt", "desc").limit(1).get();
        return snap.empty ? undefined : { ...snap.docs[0].data(), id: snap.docs[0].id };
      },
      async get(token) {
        return docData(await db.collection(COL.invites).doc(token).get());
      },
      async add(inv) {
        await db.collection(COL.invites).doc(inv.token).set(clean(inv));
        return inv;
      },
      async remove(userId, token) {
        const ref = db.collection(COL.invites).doc(token);
        const snap = await ref.get();
        // Ownership is checked here rather than trusted: this is reachable from
        // a route that takes the token from the caller.
        if (!snap.exists || snap.data().userId !== String(userId)) return false;
        await ref.delete();
        return true;
      },
      async addResponse(r) {
        await db.collection(COL.inviteResponses).doc(r.id).set(clean(r));
        return r;
      },
      async responses(token) {
        const snap = await db.collection(COL.inviteResponses)
          .where("token", "==", String(token))
          .orderBy("createdAt", "desc").limit(50).get();
        return allData(snap);
      }
    },

    people: {
      async forUser(userId) {
        const snap = await userRef(userId).collection("people").get();
        return allData(snap).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      },
      async add(person) {
        await userRef(person.userId).collection("people").doc(person.id).set(clean(person));
        return person;
      },
      async remove(userId, id) {
        const ref = userRef(userId).collection("people").doc(id);
        const snap = await ref.get();
        if (!snap.exists) return false;
        await ref.delete();
        return true;
      }
    },

    conversations: {
      async forUser(userId) {
        const snap = await userRef(userId).collection("conversations")
          .orderBy("updatedAt", "desc").get();
        return allData(snap).map(c => ({ id: c.id, title: c.title, updated_at: c.updatedAt }));
      },
      async get(userId, id) {
        const snap = await userRef(userId).collection("conversations").doc(id).get();
        if (!snap.exists) return undefined;
        const c = snap.data();
        return { ...c, id: snap.id, created_at: c.createdAt, updated_at: c.updatedAt };
      },
      async create(c) {
        await userRef(c.userId).collection("conversations").doc(c.id).set(clean(c));
        return c;
      },
      async update(userId, id, patch) {
        const ref = userRef(userId).collection("conversations").doc(id);
        const snap = await ref.get();
        if (!snap.exists) return false;
        const upd = { updatedAt: patch.updatedAt };
        if (patch.messages !== undefined) upd.messages = patch.messages;
        if (patch.title !== undefined) upd.title = patch.title;
        await ref.set(clean(upd), { merge: true });
        return true;
      },
      async remove(userId, id) {
        const ref = userRef(userId).collection("conversations").doc(id);
        const snap = await ref.get();
        if (!snap.exists) return false;
        await ref.delete();
        return true;
      }
    }
  };
}

module.exports = { firestoreBackend, COL };
