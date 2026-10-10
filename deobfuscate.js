const fs = require('fs');
const acorn = require('acorn');
const astring = require('astring');

const src = fs.readFileSync('./hsw.js', 'utf8');

// ─── Step 1: Extract and rotate string arrays, build decoders ───

function extractArray(...markers) {
    let pos = -1;
    for (const m of markers) { pos = src.indexOf(m); if (pos !== -1) break; }
    if (pos === -1) throw new Error('Cannot find array marker: ' + markers[0]);
    const arrStart = src.indexOf('[', pos);
    let depth = 0, arrEnd = -1;
    for (let i = arrStart; i < src.length; i++) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
    }
    return eval(src.substring(arrStart, arrEnd + 1));
}

const bR_arr = extractArray('bR = function() {\r\n        var Ux = [', 'bR = function() {\n        var Ux = [');
const pW_arr = extractArray('var pW = function() {\r\n        var Ux = [', 'var pW = function() {\n        var Ux = [');

function decodeBase64String(encoded) {
    if (!encoded || typeof encoded !== 'string') return undefined;
    const alpha = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=";
    let decoded = "", b = 0, counter = 0;
    for (let i = 0; i < encoded.length; i++) {
        const c = alpha.indexOf(encoded[i]);
        if (c === -1) continue;
        b = counter % 4 ? 64 * b + c : c;
        if (counter++ % 4) decoded += String.fromCharCode(255 & (b >> (-2 * counter & 6)));
    }
    let urlEncoded = "";
    for (let i = 0; i < decoded.length; i++)
        urlEncoded += "%" + ("00" + decoded.charCodeAt(i).toString(16)).slice(-2);
    try { return decodeURIComponent(urlEncoded); }
    catch { return decoded; }
}

function rotateBR(arr) {
    const hd_try = (arr, idx) => decodeBase64String(arr[idx - 355]);
    for (let attempt = 0; attempt < arr.length; attempt++) {
        try {
            const val = parseInt(hd_try(arr, 546)) / 1
                + parseInt(hd_try(arr, 579)) / 2
                + -parseInt(hd_try(arr, 545)) / 3
                + parseInt(hd_try(arr, 982)) / 4
                + -parseInt(hd_try(arr, 373)) / 5
                + parseInt(hd_try(arr, 939)) / 6
                + -parseInt(hd_try(arr, 524)) / 7 * (-parseInt(hd_try(arr, 588)) / 8);
            if (val === 888813) return arr;
        } catch {}
        arr.push(arr.shift());
    }
    throw new Error('Could not solve bR rotation');
}

const bR_arr_original = [...bR_arr];
rotateBR(bR_arr);

const hdTable = {};
for (let i = 0; i < bR_arr.length; i++) {
    const v = decodeBase64String(bR_arr[i]);
    if (v !== undefined) hdTable[i + 355] = v;
}
const gTable = {};
for (let i = 0; i < pW_arr.length; i++) {
    const v = decodeBase64String(pW_arr[i]);
    if (v !== undefined) gTable[i + 148] = v;
}

console.log(`Decoded ${Object.keys(hdTable).length} hd/tM strings, ${Object.keys(gTable).length} g_ strings`);

// ─── Step 2: Parse AST ───

const ast = acorn.parse(src, {
    ecmaVersion: 2022,
    sourceType: 'script',
    allowReturnOutsideFunction: true,
});

// ─── Step 3: Collect decoder aliases ───

const DECODER_NAMES = new Set(['hd', 'tM', 'g_']);

function getDecoderTable(name) {
    if (name === 'hd' || name === 'tM') return hdTable;
    if (name === 'g_') return gTable;
    return null;
}

// Global alias map: `var ss = tM` at any level
const globalAliases = new Map();
function collectAliases(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init?.type === 'Identifier') {
        if (DECODER_NAMES.has(node.init.name)) {
            globalAliases.set(node.id.name, node.init.name);
        }
    }
    for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
        const child = node[k];
        if (Array.isArray(child)) {
            for (const c of child) if (c?.type) collectAliases(c);
        } else if (child?.type) {
            collectAliases(child);
        }
    }
}
collectAliases(ast);
console.log(`Found ${globalAliases.size} decoder aliases`);

function isDecoderName(name) {
    return DECODER_NAMES.has(name) || globalAliases.has(name);
}
function resolveDecoderName(name) {
    if (DECODER_NAMES.has(name)) return name;
    if (globalAliases.has(name)) return globalAliases.get(name);
    return null;
}

// ─── Step 4: Build per-scope numeric constant maps ───
// For `var` declarations: they are function-scoped.
// We collect, per function body, all `var X = <number>` assignments.
// Since the obfuscator uses unique numeric-constant vars per function scope
// (they don't reassign them), we can safely inline them.

// Strategy: for each function/program scope, scan all var declarations for
// `var X = <literal_number>`. If X is declared multiple times with DIFFERENT
// values in the same scope, mark it as unsafe. Build a Map<varName, number>.

function isFunctionNode(node) {
    return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression' || node.type === 'Program';
}

function buildScopeConstants(funcBody) {
    const constants = new Map(); // name -> {value, conflict}
    const aliases = new Map(); // name -> decoderName (for assignment aliases like `jD = tM`)
    function addConstant(name, value) {
        if (constants.has(name)) {
            if (constants.get(name).value !== value) constants.get(name).conflict = true;
        } else {
            constants.set(name, { value, conflict: false });
        }
    }
    function scan(node) {
        if (!node || typeof node !== 'object') return;
        if (node !== funcBody && isFunctionNode(node)) return;
        // var X = <number>
        if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' &&
            node.init?.type === 'Literal' && typeof node.init.value === 'number') {
            addConstant(node.id.name, node.init.value);
        }
        // X = <number> (assignment expression)
        if (node.type === 'AssignmentExpression' && node.operator === '=' &&
            node.left?.type === 'Identifier' && node.right?.type === 'Literal' &&
            typeof node.right.value === 'number') {
            addConstant(node.left.name, node.right.value);
        }
        // var X = tM/hd/g_ (var decl alias)
        if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' &&
            node.init?.type === 'Identifier' && (DECODER_NAMES.has(node.init.name) || globalAliases.has(node.init.name))) {
            aliases.set(node.id.name, resolveDecoderName(node.init.name) || node.init.name);
        }
        // X = tM/hd/g_ (assignment expression alias)
        if (node.type === 'AssignmentExpression' && node.operator === '=' &&
            node.left?.type === 'Identifier' && node.right?.type === 'Identifier' &&
            (DECODER_NAMES.has(node.right.name) || globalAliases.has(node.right.name))) {
            aliases.set(node.left.name, resolveDecoderName(node.right.name) || node.right.name);
        }
        for (const k of Object.keys(node)) {
            if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
            const child = node[k];
            if (Array.isArray(child)) {
                for (const c of child) if (c?.type) scan(c);
            } else if (child?.type) scan(child);
        }
    }
    scan(funcBody);
    const result = new Map();
    for (const [name, info] of constants) {
        if (!info.conflict) result.set(name, info.value);
    }
    return { constants: result, aliases };
}

// ─── Step 5: Transform with scope tracking ───

let changeCount = 0;

const RESERVED = new Set([
    'break','case','catch','continue','debugger','default','delete','do','else',
    'finally','for','function','if','in','instanceof','new','return','switch',
    'this','throw','try','typeof','var','void','while','with',
    'class','const','enum','export','extends','import','super',
    'implements','interface','let','package','private','protected','public','static','yield',
    'null','true','false','undefined','NaN','Infinity'
]);

function isValidIdentifier(s) {
    return typeof s === 'string' && s.length > 0 && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s) && !RESERVED.has(s);
}

function replaceInParent(parent, key, index, replacement) {
    if (index !== null && parent && Array.isArray(parent[key])) {
        parent[key][index] = replacement;
    } else if (parent && key) {
        parent[key] = replacement;
    }
}

// Track which var declarations were used only as decoder call args, so we can remove them
const usedAsDecoderArgOnly = new Set(); // node references of VariableDeclarator nodes to remove

function transformScope(scopeNode, parentScopeConstants, parentScopeAliases) {
    let scopeConstants, scopeAliases;
    if (isFunctionNode(scopeNode)) {
        const body = scopeNode.type === 'Program' ? scopeNode : (scopeNode.body || scopeNode);
        const built = buildScopeConstants(body);
        scopeConstants = built.constants;
        scopeAliases = new Map([...parentScopeAliases, ...built.aliases]);
    } else {
        scopeConstants = parentScopeConstants;
        scopeAliases = parentScopeAliases;
    }

    function resolveLocalDecoderName(name) {
        if (DECODER_NAMES.has(name)) return name;
        if (globalAliases.has(name)) return globalAliases.get(name);
        if (scopeAliases.has(name)) return scopeAliases.get(name);
        return null;
    }

    function resolveDecoderCall(node) {
        if (node.type !== 'CallExpression' || node.arguments.length !== 1) return null;
        if (node.callee?.type !== 'Identifier') return null;
        const decoderName = resolveLocalDecoderName(node.callee.name);
        if (!decoderName) return null;
        const table = getDecoderTable(decoderName);
        if (!table) return null;

        const arg = node.arguments[0];
        let idx;
        if (arg.type === 'Literal' && typeof arg.value === 'number') {
            idx = arg.value;
        } else if (arg.type === 'Identifier' && scopeConstants.has(arg.name)) {
            idx = scopeConstants.get(arg.name);
        } else {
            return null;
        }
        return (idx in table) ? table[idx] : null;
    }

    function transform(node, parent, key, index) {
        if (!node || typeof node !== 'object') return false;
        let changed = false;

        // If this is a nested function, enter a new scope
        if (node !== scopeNode && isFunctionNode(node)) {
            transformScope(node, scopeConstants, scopeAliases);
            return false;
        }

        // Recurse children first (bottom-up)
        for (const k of Object.keys(node)) {
            if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'raw') continue;
            const child = node[k];
            if (Array.isArray(child)) {
                for (let i = 0; i < child.length; i++) {
                    if (child[i]?.type) {
                        if (transform(child[i], node, k, i)) changed = true;
                    }
                }
            } else if (child?.type) {
                if (transform(child, node, k, null)) changed = true;
            }
        }

        // T1: Inline decoder calls
        const decoded = resolveDecoderCall(node);
        if (decoded !== null) {
            replaceInParent(parent, key, index, { type: 'Literal', value: decoded, raw: JSON.stringify(decoded) });
            changeCount++;
            return true;
        }

        // T2: Computed member with string literal => dot notation
        if (node.type === 'MemberExpression' && node.computed && node.property?.type === 'Literal' &&
            typeof node.property.value === 'string' && isValidIdentifier(node.property.value)) {
            node.computed = false;
            node.property = { type: 'Identifier', name: node.property.value };
            changeCount++;
            changed = true;
        }

        // T3: Remove void 0 from sequences
        if (node.type === 'SequenceExpression' && node.expressions) {
            const filtered = node.expressions.filter(e => {
                if (e.type === 'UnaryExpression' && e.operator === 'void' &&
                    e.argument?.type === 'Literal' && e.argument.value === 0) {
                    changeCount++;
                    return false;
                }
                return true;
            });
            if (filtered.length < node.expressions.length) {
                node.expressions = filtered;
                changed = true;
                if (filtered.length === 1 && parent && key) {
                    replaceInParent(parent, key, index, filtered[0]);
                }
            }
        }

        // T4: !0 => true, !1 => false
        if (node.type === 'UnaryExpression' && node.operator === '!' &&
            node.argument?.type === 'Literal') {
            if (node.argument.value === 0) {
                replaceInParent(parent, key, index, { type: 'Literal', value: true, raw: 'true' });
                changeCount++; return true;
            }
            if (node.argument.value === 1) {
                replaceInParent(parent, key, index, { type: 'Literal', value: false, raw: 'false' });
                changeCount++; return true;
            }
        }

        // T5: Hex literals to decimal
        if (node.type === 'Literal' && typeof node.value === 'number' && node.raw && /^0x/i.test(node.raw)) {
            node.raw = String(node.value);
            changeCount++;
            changed = true;
        }

        // T6: typeof == => ===
        if (node.type === 'BinaryExpression' && (node.operator === '==' || node.operator === '!=')) {
            const isTypeof = (n) => n.type === 'UnaryExpression' && n.operator === 'typeof';
            const isStr = (n) => n.type === 'Literal' && typeof n.value === 'string';
            if ((isTypeof(node.left) && isStr(node.right)) || (isStr(node.left) && isTypeof(node.right))) {
                node.operator = node.operator === '==' ? '===' : '!==';
                changeCount++;
                changed = true;
            }
        }

        return changed;
    }

    transform(scopeNode, null, null, null);
}

transformScope(ast, new Map(), new Map());
console.log(`Applied ${changeCount} inline transformations`);

// ─── Step 6: Remove dead declarations ───
// Remove: `var ss = tM;` (decoder aliases)
// Remove: `var Ux = 740;` where the only use was as a decoder arg (now inlined)
// For the numeric constants, we need to check if they're still referenced anywhere.

// First, collect all remaining Identifier references
const remainingRefs = new Set();
function collectRefs(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Identifier') remainingRefs.add(node.name);
    for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'raw') continue;
        const child = node[k];
        if (Array.isArray(child)) {
            for (const c of child) if (c?.type) collectRefs(c);
        } else if (child?.type) collectRefs(child);
    }
}
collectRefs(ast);

function isNameStillUsed(name, root, declNode) {
    let found = false;
    function search(node) {
        if (found || !node || typeof node !== 'object') return;
        if (node === declNode) return;
        if (node.type === 'Identifier' && node.name === name) { found = true; return; }
        for (const k of Object.keys(node)) {
            if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'raw') continue;
            const child = node[k];
            if (Array.isArray(child)) {
                for (const c of child) { if (found) return; if (c?.type) search(c); }
            } else if (child?.type) search(child);
        }
    }
    search(root);
    return found;
}

function removeDeadDeclarations(node) {
    if (!node || typeof node !== 'object') return;
    for (const k of Object.keys(node)) {
        const child = node[k];
        if (Array.isArray(child)) {
            for (let i = child.length - 1; i >= 0; i--) {
                if (child[i]?.type === 'VariableDeclaration') {
                    const decl = child[i];
                    const remaining = decl.declarations.filter(d => {
                        if (!d.id || d.id.type !== 'Identifier') return true;
                        // Remove decoder alias declarations only if name is no longer used
                        if (d.init?.type === 'Identifier' && DECODER_NAMES.has(d.init.name) && globalAliases.has(d.id.name) && !isNameStillUsed(d.id.name, ast, d)) {
                            changeCount++;
                            return false;
                        }
                        return true;
                    });
                    if (remaining.length === 0) {
                        child.splice(i, 1);
                    } else {
                        decl.declarations = remaining;
                    }
                }
                if (child[i]?.type) removeDeadDeclarations(child[i]);
            }
        } else if (child?.type) {
            removeDeadDeclarations(child);
        }
    }
}

removeDeadDeclarations(ast);

// ─── Step 7: Remove dead numeric constant declarations ───
// After decoder calls are resolved, vars like `var ss = 666` may be unreferenced.
// We do this scope-aware: for each function scope, find `var X = <number>` and
// check if X is referenced anywhere else in the same scope (excluding nested function scopes
// that could have their own X, and excluding the declaration itself).

function removeDeadNumericConstants(node) {
    if (!node || typeof node !== 'object') return;

    // Process function scopes
    if (isFunctionNode(node)) {
        const body = node.type === 'Program' ? node : node.body;
        if (body) removeDeadConstantsInScope(body, node);
    }

    for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'raw') continue;
        const child = node[k];
        if (Array.isArray(child)) {
            for (const c of child) if (c?.type) removeDeadNumericConstants(c);
        } else if (child?.type) removeDeadNumericConstants(child);
    }
}

function removeDeadConstantsInScope(scopeBody, scopeNode) {
    // Find all var X = <number> declarations in this scope (not nested scopes)
    const numericDecls = new Map(); // name -> [declarator nodes]
    function findDecls(node) {
        if (!node || typeof node !== 'object') return;
        if (node !== scopeNode && isFunctionNode(node)) return;
        if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' &&
            node.init?.type === 'Literal' && typeof node.init.value === 'number') {
            if (!numericDecls.has(node.id.name)) numericDecls.set(node.id.name, []);
            numericDecls.get(node.id.name).push(node);
        }
        for (const k of Object.keys(node)) {
            if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'raw') continue;
            const child = node[k];
            if (Array.isArray(child)) {
                for (const c of child) if (c?.type) findDecls(c);
            } else if (child?.type) findDecls(child);
        }
    }
    findDecls(scopeBody);

    if (numericDecls.size === 0) return;

    // Collect all identifier references in this scope (excluding declarations themselves and nested scopes)
    const declNodes = new Set();
    for (const nodes of numericDecls.values()) for (const n of nodes) declNodes.add(n);

    const referencedNames = new Set();
    function findRefs(node) {
        if (!node || typeof node !== 'object') return;
        if (declNodes.has(node)) return;
        if (node.type === 'Identifier' && numericDecls.has(node.name)) {
            referencedNames.add(node.name);
        }
        for (const k of Object.keys(node)) {
            if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'raw') continue;
            const child = node[k];
            if (Array.isArray(child)) {
                for (const c of child) if (c?.type) findRefs(c);
            } else if (child?.type) findRefs(child);
        }
    }
    findRefs(scopeBody);

    // Names that are declared but never referenced can be removed
    const deadNames = new Set();
    for (const [name, nodes] of numericDecls) {
        if (!referencedNames.has(name)) deadNames.add(name);
    }

    if (deadNames.size === 0) return;

    // Remove the dead declarators from VariableDeclarations
    function removeDecls(node) {
        if (!node || typeof node !== 'object') return;
        if (node !== scopeNode && isFunctionNode(node)) return;
        for (const k of Object.keys(node)) {
            const child = node[k];
            if (Array.isArray(child)) {
                for (let i = child.length - 1; i >= 0; i--) {
                    if (child[i]?.type === 'VariableDeclaration') {
                        const decl = child[i];
                        const remaining = decl.declarations.filter(d => {
                            if (d.id?.type === 'Identifier' && d.init?.type === 'Literal' &&
                                typeof d.init.value === 'number' && deadNames.has(d.id.name)) {
                                changeCount++;
                                return false;
                            }
                            return true;
                        });
                        if (remaining.length === 0) {
                            child.splice(i, 1);
                        } else {
                            decl.declarations = remaining;
                        }
                    }
                    if (child[i]?.type) removeDecls(child[i]);
                }
            } else if (child?.type) removeDecls(child);
        }
    }
    removeDecls(scopeBody);
}

removeDeadNumericConstants(ast);

// ─── Step 8: Generate output ───

let output = astring.generate(ast, {
    indent: '    ',
    lineEnd: '\n',
});

// ─── Step 9: Patch bR array to pre-rotated version ───
// The rotation IIFE's decoder calls got inlined to static strings, so it always breaks
// immediately. But bR was NOT rotated in the AST. We must replace the unrotated array
// with the rotated one so hd() produces correct results.

const bR_original_first = bR_arr_original[0];
const bR_rotated_first = bR_arr[0];
if (bR_original_first !== bR_rotated_first) {
    const bR_array_str = '["' + bR_arr.join('", "') + '"]';
    // Find the bR array in output: var Ux = ["qw5H...
    const marker = '["' + bR_arr_original[0] + '"';
    const markerPos = output.indexOf(marker);
    if (markerPos !== -1) {
        const endBracket = output.indexOf(']', markerPos);
        output = output.substring(0, markerPos) + bR_array_str + output.substring(endBracket + 1);
        console.log('Patched bR array to pre-rotated version');
        changeCount++;
    } else {
        console.warn('WARNING: Could not find bR array in output to patch!');
    }
}

fs.writeFileSync('./hsw_deobfuscated.js', output, 'utf8');
console.log(`\nWrote hsw_deobfuscated.js (${output.length} bytes)`);
console.log(`Total transformations: ${changeCount}`);
