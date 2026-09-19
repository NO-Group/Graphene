# Code signing — `com.n_o_group.graphene`

## What this is

`make-keystore.sh` creates a **PKCS#12 keystore** (`.p12`) holding a 4096-bit
RSA code-signing key and certificate. One file works for Windows `signtool`,
electron-builder, Java `keytool` and Android, so there is nothing else to
manage.

The identity `com.n_o_group.graphene` is recorded in two places inside the
certificate: the `OU` field of the subject, and a `subjectAltName` URI.

## Creating it

```bash
export KEYSTORE_PASSWORD='a-real-passphrase'     # 8+ characters, required
./build/signing/make-keystore.sh
```

Output lands in `build/signing/keys/` (git-ignored, mode 600):

| File | What it is | Share it? |
|---|---|---|
| `graphene.p12` | keystore: private key + certificate | **never** |
| `graphene.key` | private key on its own | **never** |
| `graphene.crt` | public certificate | yes |

The script refuses to run with a missing or under-8-character password, so it
cannot quietly produce a keystore anyone could open.

## Signing a build

```bash
export CSC_LINK="$(base64 -w0 build/signing/keys/graphene.p12)"
export CSC_KEY_PASSWORD="$KEYSTORE_PASSWORD"
npm run dist:win
```

electron-builder picks both variables up automatically. `verify-keystore.sh`
checks a keystore before you use it:

```bash
KEYSTORE_PASSWORD='…' ./build/signing/verify-keystore.sh build/signing/keys/graphene.p12
```

## In CI

Store the keystore as repository secrets — **Settings → Secrets and variables →
Actions**:

| Secret | Value |
|---|---|
| `CSC_LINK` | `base64 -w0 graphene.p12` output |
| `CSC_KEY_PASSWORD` | the keystore passphrase |

The workflow signs automatically when both are present and produces unsigned
builds when they are not, so a fork without the secrets still builds.

## Self-signed vs. CA-issued — read this

The generated certificate is **self-signed**. It gives you a real, verifiable
signature and a stable identity, and it is what lets you confirm a download has
not been altered.

It does **not** remove the OS warnings:

- **Windows SmartScreen** trusts a publisher only after a CA-issued certificate
  builds reputation. An EV certificate skips the wait.
- **macOS Gatekeeper** only accepts an Apple Developer ID certificate
  ($99/year), and notarisation on top of that.

When you buy one, export it as `.p12` and point `CSC_LINK` at it. No code or
workflow changes are needed.
