// Verifies the server can reach Firestore with the configured credentials.
// Reads FIREBASE_SERVICE_ACCOUNT from the environment and never prints it.
//
//   node check-firebase.js
//
// Expects .env (gitignored) or real environment variables.
require("dotenv").config();

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error("✗ FIREBASE_SERVICE_ACCOUNT is not set");
  process.exit(1);
}

let sa;
try {
  sa = JSON.parse(raw);
} catch (err) {
  console.error("✗ FIREBASE_SERVICE_ACCOUNT is not valid JSON:", err.message);
  console.error("  Most likely the private_key newlines were reformatted on paste.");
  console.error("  Paste the downloaded file's contents byte-for-byte.");
  process.exit(1);
}

// Structural checks that catch the common paste mistakes without revealing anything.
const problems = [];
if (sa.type !== "service_account") problems.push("type is not 'service_account'");
if (!sa.project_id) problems.push("project_id missing");
if (!sa.client_email) problems.push("client_email missing");
if (!sa.private_key) problems.push("private_key missing");
else {
  if (!sa.private_key.startsWith("-----BEGIN PRIVATE KEY-----")) problems.push("private_key has no PEM header");
  if (!sa.private_key.includes("\n")) problems.push("private_key has no line breaks — the \n escapes were stripped");
}
if (problems.length) {
  console.error("✗ Service account looks malformed:");
  for (const p of problems) console.error("   -", p);
  process.exit(1);
}

console.log("credential shape : ok");
console.log("project_id       :", sa.project_id);
console.log("client_email     :", sa.client_email.replace(/^(.{6}).*(@.*)$/, "$1…$2"));
console.log("database id      :", process.env.FIRESTORE_DATABASE_ID || "(unset — will use '(default)')");

process.env.USE_FIRESTORE = "true";
const store = require("./server/store");

(async () => {
  console.log("backend          :", store.name);
  try {
    // A read of a document that shouldn't exist: proves auth, network and
    // database targeting without writing anything.
    const probe = await store.users.findById("__connectivity_probe__");
    console.log("firestore read   : ok", probe === undefined ? "(no such document, as expected)" : "");
    console.log("\n✓ Ready. Set the same variables in Render.");
  } catch (err) {
    console.error("\n✗ Firestore read failed:", err.message);
    if (/NOT_FOUND|database/i.test(err.message)) {
      console.error("  Check FIRESTORE_DATABASE_ID — this project's database is named 'default', not '(default)'.");
    }
    if (/PERMISSION_DENIED|UNAUTHENTICATED|invalid_grant/i.test(err.message)) {
      console.error("  The key may be revoked, or belong to a different project.");
    }
    process.exit(1);
  }
})();
