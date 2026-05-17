# HSW-Blob Reverse Engineering

Reverse engineering of hCaptcha's Fingerprint blob.

## What this does

HSW collects browser fingerprints (canvas, WebGL, fonts, timing, etc.) and encrypts the browser events with AES-128-CBC before sending them as part of the challenge response. The encryption key is not stored as a plain byte array — it's buried inside a control-flow-flattened AES implementation using T-tables, where the round keys are embedded as arithmetic constants across dozens of switch-case branches.

This project:

1. **Deobfuscates** the HSW script (string array decoding, constant folding, dead code removal) while keeping it fully runnable
2. **Extracts the AES-128-CBC key** by hooking the AddRoundKey step at runtime
3. **Decrypts the fingerprint blob** and saves it as readable JSON

## Files

| File | Description |
|------|-------------|
| `deobfuscate.js` | Node.js deobfuscator — resolves string arrays, inlines constants, cleans up the source |
| `hsw_deobfuscated.js` | Deobfuscated output, fully runnable in a browser |
| `fetchblobkey.js` | Key extraction tool — patches the JS in-memory, runs it in a real Chrome instance, captures the AES key, verifies it by decrypting + re-encrypting |

## How the encryption works

```
Plaintext (fingerprint JSON as Uint8Array)
  → PKCS7 padding
  → AES-128-CBC encrypt (random IV, hardcoded key)
  → base64(IV) + "." + base64(ciphertext)
```

The AES block cipher (`kc` function) uses a switch-case dispatcher where the product `Ux * pF * wc * MZ` determines which operation runs next. Each case performs one step of an AES round (SubBytes/ShiftRows/MixColumns via T-table lookups, or AddRoundKey via XOR with computed constants). The control flow variables mutate after every case, making static analysis impractical — but at runtime the XOR values applied during AddRoundKey are always the same, because they come from fixed arithmetic expressions.

## Key extraction approach

`fetchblobkey.js` patches two switch-cases in the AES function (cases 17280 and 37248 — the AddRoundKey steps) to snapshot `dq` before and after the XOR. The delta is the round key. Since this is AES-128, round key 0 = the encryption key.

The patched script runs inside a real Chrome instance (via puppeteer-core, no webdriver flags) to avoid detection. After capturing the key, the tool verifies it by:
- Decrypting the captured ciphertext with Node.js crypto
- Re-encrypting the plaintext and comparing it byte-for-byte with the original ciphertext

## Usage

```bash
npm install
node deobfuscate.js        # produces hsw_deobfuscated.js
node fetchblobkey.js        # extracts key, saves decrypted_blob.json
```

Requires Chrome installed and Node.js 18+.

## Scope

This covers the JavaScript-layer blob encryption only. HSW also has a WASM component (`encrypt_req_data` / `decrypt_resp_data`) that handles a separate encryption path — that's not part of this repo.

## Contact

If you represent a company and want this taken down, reach out to jomandiscord@gmail.com.
