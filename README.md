<div align="center">

# hCaptcha HSW Blob Encryption Analysis

Reverse engineering study of how hCaptcha's HSW script encrypts its fingerprint blob, including recovery of an AES key hidden in a control-flow-flattened implementation.

![Status](https://img.shields.io/badge/status-archived-lightgrey?style=flat-square)
![Purpose](https://img.shields.io/badge/purpose-educational-blue?style=flat-square)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)

</div>

> [!IMPORTANT]
> **Archived research · Educational use only**
> This repository documents past research and is no longer maintained. The analyzed system has changed since publication, so the findings are **outdated** and may not reflect current versions.
> The material is provided solely for educational and defensive security purposes. It must not be used to circumvent protections, automate access without authorization, or violate any platform's terms of service.

---

## Overview

HSW collects browser fingerprints (canvas, WebGL, fonts, timing and more) and encrypts them with AES-128-CBC before they are sent as part of the challenge response. The key is not stored as a plain byte array. Instead it is buried inside a control-flow-flattened, T-table based AES implementation, where the round keys appear as arithmetic constants spread across dozens of switch-case branches.

This project:

1. **Deobfuscates** the HSW script (string array decoding, constant folding, dead code removal) while keeping it runnable
2. **Recovers the AES-128 key** by instrumenting the AddRoundKey step at runtime
3. **Decrypts the fingerprint blob** into readable JSON for analysis

## Repository Structure

| File | Description |
|------|-------------|
| `hsw.js` | Original HSW script (reference copy, as analyzed) |
| `deobfuscate.js` | Node.js deobfuscator: resolves string arrays, inlines constants, cleans up the source |
| `hsw_deobfuscated.js` | Deobfuscated output, still runnable in a browser |
| `fetchblobkey.js` | Instrumentation tool that captures and verifies the AES key |

## Encryption Scheme

```
Plaintext (fingerprint JSON as Uint8Array)
  → PKCS7 padding
  → AES-128-CBC encrypt (random IV, embedded key)
  → base64(IV) + "." + base64(ciphertext)
```

The AES block function uses a switch-case dispatcher in which the product of four state variables selects the next operation. Each case performs one step of an AES round (SubBytes, ShiftRows and MixColumns through T-table lookups, or AddRoundKey through XOR with computed constants). The control-flow variables mutate after every case, which makes static analysis impractical. At runtime, however, the XOR values applied during AddRoundKey are always identical because they derive from fixed arithmetic expressions.

## Key Recovery Approach

`fetchblobkey.js` patches the two AddRoundKey cases of the AES function to snapshot the state before and after the XOR. The difference is the round key, and for AES-128 round key 0 equals the encryption key.

The patched script runs inside a real Chrome instance via `puppeteer-core`. The captured key is then verified by decrypting the captured ciphertext with Node.js `crypto`, re-encrypting the plaintext and comparing both ciphertexts byte for byte.

## Usage

```bash
npm install
node deobfuscate.js     # produces hsw_deobfuscated.js
node fetchblobkey.js    # recovers the key, writes decrypted_blob.json
```

Requires Node.js 18+ and a local Chrome installation.

## Scope

This covers the JavaScript-layer blob encryption only. HSW also contains a WebAssembly component (`encrypt_req_data` / `decrypt_resp_data`) with a separate encryption path, which is not part of this repository.

---

## Legal Notice

hCaptcha is a trademark of Intuition Machines, Inc. This project is independent and is not affiliated with, sponsored or endorsed by hCaptcha. Third-party scripts included for analysis remain the property of their respective owners.

The software is provided "as is", without warranty of any kind. The author accepts no liability for any misuse.

## Contact & Takedown Requests

Vendors with concerns about this repository can reach out at **jomandiscord@gmail.com**. Content will be reviewed and adjusted or removed promptly where appropriate.
