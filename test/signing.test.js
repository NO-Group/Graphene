/* signing.test.js — the code-signing toolchain for com.n_o_group.graphene.
   A signing script that only *looks* right is worse than none, so these tests
   actually generate a keystore with openssl, sign a payload with it, verify the
   signature, and confirm a tampered payload is rejected. Skips cleanly when
   openssl is unavailable. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${name.padEnd(54)}${!cond && extra !== undefined ? " → " + extra : ""}`);
};
const sh = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

let haveOpenssl = true;
try { sh("openssl version"); } catch (e) { haveOpenssl = false; }

console.log("— scripts exist and are executable —");
{
  for (const f of ["make-keystore.sh", "verify-keystore.sh", "README.md"]) {
    const p = path.join(ROOT, "build", "signing", f);
    t(`build/signing/${f} exists`, fs.existsSync(p));
    if (f.endsWith(".sh") && fs.existsSync(p)) {
      t(`  …and is executable`, (fs.statSync(p).mode & 0o111) !== 0);
      let ok = true;
      try { sh(`bash -n "${p}"`); } catch (e) { ok = false; }
      t(`  …and is valid bash`, ok);
    }
  }
}

console.log("— key material can never be committed —");
{
  const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  for (const pat of ["build/signing/keys/", "*.p12", "*.key"]) {
    t(`.gitignore covers ${pat}`, ignore.includes(pat));
  }
  for (const f of ["build/signing/keys/graphene.p12", "build/signing/keys/graphene.key"]) {
    let ignored = false;
    try { execFileSync("git", ["check-ignore", "-q", f], { cwd: ROOT }); ignored = true; } catch (e) { ignored = false; }
    t(`git ignores ${f}`, ignored);
  }
  const tracked = sh("git ls-files", { cwd: ROOT });
  t("no key material is tracked in git",
    !/\.(p12|pfx|jks|keystore)$|signing\/keys\//.test(tracked),
    (tracked.match(/.*(p12|pfx|jks|keystore|signing\/keys).*/g) || []).slice(0, 2).join(", "));
}

console.log("— the password guard is real —");
if (!haveOpenssl) { console.log("  SKIP: openssl unavailable"); }
else {
  const script = path.join(ROOT, "build", "signing", "make-keystore.sh");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gks-"));
  const run = env => {
    try {
      sh(`bash "${script}"`, { env: { ...process.env, OUT_DIR: tmp, ...env } });
      return { ok: true };
    } catch (e) { return { ok: false, err: String(e.stderr || e.stdout || e.message) }; }
  };
  const noPw = run({ KEYSTORE_PASSWORD: "" });
  t("refuses to run without a password", !noPw.ok && /KEYSTORE_PASSWORD/.test(noPw.err), noPw.err && noPw.err.slice(0, 60));
  const shortPw = run({ KEYSTORE_PASSWORD: "abc" });
  t("refuses a password under 8 characters", !shortPw.ok && /8 characters/.test(shortPw.err), shortPw.err && shortPw.err.slice(0, 60));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("— a generated keystore is genuinely usable —");
if (!haveOpenssl) { console.log("  SKIP: openssl unavailable"); }
else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gks-"));
  const PW = "GrapheneTest12345";
  const script = path.join(ROOT, "build", "signing", "make-keystore.sh");
  let made = true, err = "";
  try { sh(`bash "${script}"`, { env: { ...process.env, OUT_DIR: tmp, KEYSTORE_PASSWORD: PW } }); }
  catch (e) { made = false; err = String(e.stderr || e.message).slice(0, 80); }
  t("make-keystore.sh completes", made, err);

  const p12 = path.join(tmp, "graphene.p12");
  const crt = path.join(tmp, "graphene.crt");
  const key = path.join(tmp, "graphene.key");
  t("produces a .p12 keystore", fs.existsSync(p12));
  t("produces a public certificate", fs.existsSync(crt));
  t("produces a private key", fs.existsSync(key));

  if (fs.existsSync(p12)) {
    /* PKCS#12 is DER: it must start with a SEQUENCE tag, not be a text stub */
    const head = fs.readFileSync(p12).slice(0, 2);
    t("the keystore is real DER, not a placeholder file", head[0] === 0x30, `first bytes ${head.toString("hex")}`);

    const mode = fs.statSync(p12).mode & 0o777;
    t("the keystore is not world-readable", (mode & 0o077) === 0, "0" + mode.toString(8));

    let opens = false;
    try { sh(`openssl pkcs12 -in "${p12}" -nokeys -passin pass:${PW} -out /dev/null`); opens = true; } catch (e) { opens = false; }
    t("it opens with the correct password", opens);

    let rejects = false;
    try { sh(`openssl pkcs12 -in "${p12}" -nokeys -passin pass:WrongPassword999 -out /dev/null`); }
    catch (e) { rejects = true; }
    t("it rejects the wrong password", rejects);
  }

  if (fs.existsSync(crt)) {
    const text = sh(`openssl x509 -in "${crt}" -noout -text`);
    t("certificate declares Code Signing usage", /Code Signing/.test(text));
    t("certificate carries com.n_o_group.graphene", /com\.n_o_group\.graphene/.test(text));
    t("  …in the subjectAltName too", /URI:com\.n_o_group\.graphene/.test(text));
    t("key is 4096-bit", /Public-Key: \(4096 bit\)/.test(text));
    t("signed with SHA-256", /sha256WithRSAEncryption/.test(text));
    t("is not a CA certificate", /CA:FALSE/.test(text));
    let notExpired = true;
    try { sh(`openssl x509 -in "${crt}" -noout -checkend 0`); } catch (e) { notExpired = false; }
    t("certificate is currently valid", notExpired);
  }

  /* the real proof: sign something, verify it, then break it */
  if (fs.existsSync(p12) && fs.existsSync(crt) && fs.existsSync(key)) {
    const payload = path.join(tmp, "payload.bin");
    const sig = path.join(tmp, "payload.p7s");
    fs.writeFileSync(payload, "graphene signing proof\n");
    let signed = false;
    try {
      sh(`openssl smime -sign -binary -in "${payload}" -out "${sig}" -outform DER -signer "${crt}" -inkey "${key}" -passin pass:${PW} -nodetach`);
      signed = true;
    } catch (e) { signed = false; }
    t("the key can sign a payload", signed);

    if (signed) {
      let verified = false;
      try { sh(`openssl smime -verify -binary -in "${sig}" -inform DER -CAfile "${crt}" -noverify -out /dev/null`); verified = true; } catch (e) { verified = false; }
      t("the signature verifies against the certificate", verified);

      /* corrupt the signed CONTENT, not arbitrary bytes: flipping a byte
         elsewhere can land in an unauthenticated region and still verify */
      const buf = fs.readFileSync(sig);
      const at = buf.indexOf(Buffer.from("graphene signing proof"));
      t("  …the signed payload is locatable for tampering", at > 0, at);
      if (at > 0) {
        const bad = Buffer.from(buf);
        bad.write("XXXX", at);
        const badPath = path.join(tmp, "bad.p7s");
        fs.writeFileSync(badPath, bad);
        let rejected = false;
        try { sh(`openssl smime -verify -binary -in "${badPath}" -inform DER -CAfile "${crt}" -noverify -out /dev/null`); }
        catch (e) { rejected = true; }
        t("a tampered payload is rejected", rejected);
      }
    }
  }

  /* verify-keystore.sh must agree, and must fail on a bad password */
  const vs = path.join(ROOT, "build", "signing", "verify-keystore.sh");
  if (fs.existsSync(p12)) {
    let vOK = true, vOut = "";
    try { vOut = sh(`bash "${vs}" "${p12}"`, { env: { ...process.env, KEYSTORE_PASSWORD: PW } }); }
    catch (e) { vOK = false; vOut = String(e.stdout || e.message); }
    t("verify-keystore.sh passes a good keystore", vOK && /usable for signing/.test(vOut), vOut.slice(-90));
    t("  …and reports no failures", !/FAIL/.test(vOut), (vOut.match(/FAIL.*/g) || []).join(" | "));

    let badRejected = false;
    try { sh(`bash "${vs}" "${p12}"`, { env: { ...process.env, KEYSTORE_PASSWORD: "TotallyWrong123" } }); }
    catch (e) { badRejected = true; }
    t("verify-keystore.sh rejects a wrong password", badRejected);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("— CI wiring —");
{
  const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "build-installers.yml"), "utf8");
  t("the workflow passes CSC_LINK to electron-builder", /CSC_LINK:\s*\$\{\{\s*secrets\.CSC_LINK/.test(wf));
  t("the workflow passes the key password", /CSC_KEY_PASSWORD:\s*\$\{\{\s*secrets\.CSC_KEY_PASSWORD/.test(wf));
  t("unsigned builds still work (no hard failure)", /::warning::.*UNSIGNED/.test(wf));
  t("checksums are produced for every artifact", /SHA256SUMS\.txt/.test(wf));
  t("the suite runs before any installer is built", /needs:\s*test/.test(wf));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
