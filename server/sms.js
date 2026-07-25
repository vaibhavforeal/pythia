// SMS delivery for OTPs.
//
// Provider-agnostic on purpose: in India transactional SMS needs DLT
// registration of the sender ID and the exact template text with a telecom
// operator, and that approval takes days. Everything else can be built,
// deployed and tested before it clears; switching providers on is env config.
//
// Configure with:
//   SMS_PROVIDER   msg91 | twilio | console   (unset = disabled)
//   SMS_SENDER     the DLT-approved sender ID / from-number
//   MSG91_AUTH_KEY / MSG91_TEMPLATE_ID
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN
//
// The message text must match the DLT-approved template exactly, character for
// character, or the operator silently drops it.

const PROVIDER = (process.env.SMS_PROVIDER || "").trim().toLowerCase();
const SENDER = (process.env.SMS_SENDER || "PYTHIA").trim();
const IS_PROD = process.env.NODE_ENV === "production";

const enabled = () => PROVIDER !== "";

function messageFor(code) {
  return `${code} is your Pythia verification code. It expires in 10 minutes. Do not share it with anyone.`;
}

// --- Providers ---------------------------------------------------------------

async function sendViaMsg91(phone, code) {
  const key = process.env.MSG91_AUTH_KEY;
  const template = process.env.MSG91_TEMPLATE_ID;
  if (!key || !template) throw new Error("MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required");

  const res = await fetch("https://control.msg91.com/api/v5/otp", {
    method: "POST",
    headers: { "Content-Type": "application/json", authkey: key },
    body: JSON.stringify({
      template_id: template,
      mobile: phone.replace(/^\+/, ""), // MSG91 wants the number without '+'
      otp: code,
      sender: SENDER
    })
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`MSG91 ${res.status}: ${body.slice(0, 200)}`);
  // MSG91 answers 200 with {"type":"error"} for template/DLT problems.
  if (/"type"\s*:\s*"error"/.test(body)) throw new Error(`MSG91 rejected: ${body.slice(0, 200)}`);
}

async function sendViaTwilio(phone, code) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required");

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ To: phone, From: SENDER, Body: messageFor(code) })
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Local development only. Refuses to run in production so a missing provider
// can never quietly degrade into "codes are printed in the server log".
async function sendViaConsole(phone, code) {
  if (IS_PROD) throw new Error("SMS_PROVIDER=console is not permitted in production");
  console.log(`\n  ✉  OTP for ${phone}: ${code}\n`);
}

/**
 * Send a code. Throws on failure so the caller can avoid recording a send that
 * never happened — otherwise the user burns their daily quota on nothing.
 */
async function sendOtp(phone, code) {
  switch (PROVIDER) {
    case "msg91": return sendViaMsg91(phone, code);
    case "twilio": return sendViaTwilio(phone, code);
    case "console": return sendViaConsole(phone, code);
    default: throw new Error("SMS is not configured (set SMS_PROVIDER)");
  }
}

module.exports = { sendOtp, enabled, messageFor, PROVIDER, SENDER };
