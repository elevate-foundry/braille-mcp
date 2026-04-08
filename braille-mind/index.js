#!/usr/bin/env node
import readline from 'readline';

// ── Grade 1 Braille: 6-bit dot patterns (dots 1-6, MSB=dot1) ──────────────────
// Bit layout: [d1 d2 d3 d4 d5 d6] as bits [5 4 3 2 1 0]
const CHAR_TO_BITS = {
  'a':0b100000,'b':0b110000,'c':0b100100,'d':0b100110,'e':0b100010,
  'f':0b110100,'g':0b110110,'h':0b110010,'i':0b010100,'j':0b010110,
  'k':0b101000,'l':0b111000,'m':0b101100,'n':0b101110,'o':0b101010,
  'p':0b111100,'q':0b111110,'r':0b111010,'s':0b011100,'t':0b011110,
  'u':0b101001,'v':0b111001,'w':0b010111,'x':0b101101,'y':0b101111,
  'z':0b101011,' ':0b000000,
  '1':0b100000,'2':0b110000,'3':0b100100,'4':0b100110,'5':0b100010,
  '6':0b110100,'7':0b110110,'8':0b110010,'9':0b010100,'0':0b010110,
  ',':0b010000,'.':0b010011,';':0b011000,'?':0b011001,'!':0b011010,
  '-':0b001001,':':0b010010,'"':0b001100,"'":0b001000,'(':0b111011,')':0b011111,
};

const BITS_TO_CHAR = Object.fromEntries(
  Object.entries(CHAR_TO_BITS).filter(([c]) => !'0123456789'.includes(c)).map(([c,b]) => [b,c])
);

// Number indicator (dots 3456)
const NUM_IND = 0b000111;

// Unicode braille: U+2800 + 6-bit remapped to braille standard bit order
// Braille unicode bit order: bit0=dot1, bit1=dot2, bit2=dot3, bit3=dot4, bit4=dot5, bit5=dot6, bit6=dot7, bit7=dot8
function bitsToUnicode(bits6) {
  // Our bits: [d1 d2 d3 d4 d5 d6] stored as [b5 b4 b3 b2 b1 b0]
  // Unicode braille: dot1=bit0, dot2=bit1, dot3=bit2, dot4=bit3, dot5=bit4, dot6=bit5
  const d1 = (bits6 >> 5) & 1;
  const d2 = (bits6 >> 4) & 1;
  const d3 = (bits6 >> 3) & 1;
  const d4 = (bits6 >> 2) & 1;
  const d5 = (bits6 >> 1) & 1;
  const d6 = (bits6 >> 0) & 1;
  const uniVal = d1 | (d2 << 1) | (d3 << 2) | (d4 << 3) | (d5 << 4) | (d6 << 5);
  return String.fromCodePoint(0x2800 + uniVal);
}

function unicodeToBits(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x2800 || cp > 0x28FF) return null;
  const uniVal = cp - 0x2800;
  const d1 = uniVal & 1;
  const d2 = (uniVal >> 1) & 1;
  const d3 = (uniVal >> 2) & 1;
  const d4 = (uniVal >> 3) & 1;
  const d5 = (uniVal >> 4) & 1;
  const d6 = (uniVal >> 5) & 1;
  return (d1 << 5) | (d2 << 4) | (d3 << 3) | (d4 << 2) | (d5 << 1) | d6;
}

function textToUnicode(text) {
  const chars = [...text.toLowerCase()];
  const out = [];
  let inNumber = false;
  for (const ch of chars) {
    if ('0123456789'.includes(ch)) {
      if (!inNumber) { out.push(bitsToUnicode(NUM_IND)); inNumber = true; }
      out.push(bitsToUnicode(CHAR_TO_BITS[ch] ?? 0));
    } else {
      inNumber = false;
      out.push(bitsToUnicode(CHAR_TO_BITS[ch] ?? 0));
    }
  }
  return out.join('');
}

function unicodeToText(brailleStr) {
  const chars = [...brailleStr];
  const out = [];
  let inNumber = false;
  for (const ch of chars) {
    const bits = unicodeToBits(ch);
    if (bits === null) { out.push(ch); inNumber = false; continue; }
    if (bits === NUM_IND) { inNumber = true; continue; }
    if (inNumber) {
      // find digit: bits match letters a-j -> 1-0
      const digit = Object.entries(CHAR_TO_BITS).find(([c, b]) => '0123456789'.includes(c) && b === bits);
      if (digit) { out.push(digit[0]); continue; }
      inNumber = false;
    }
    out.push(BITS_TO_CHAR[bits] ?? '?');
  }
  return out.join('');
}

function textToBitArray(text) {
  const lower = text.toLowerCase();
  const result = [];
  let inNumber = false;
  for (const ch of lower) {
    if ('0123456789'.includes(ch)) {
      if (!inNumber) { result.push(NUM_IND); inNumber = true; }
      result.push(CHAR_TO_BITS[ch] ?? 0);
    } else {
      inNumber = false;
      result.push(CHAR_TO_BITS[ch] ?? 0);
    }
  }
  return result;
}

// ── Dot density & entropy analysis ────────────────────────────────────────────
function dotStats(bits6Array) {
  if (!bits6Array.length) return { dotDensity: 0, entropy: 0, raisedDots: 0, totalCells: 0 };
  let raised = 0;
  const freq = new Array(64).fill(0);
  for (const b of bits6Array) {
    raised += popcount6(b);
    freq[b]++;
  }
  const total = bits6Array.length;
  const maxDots = total * 6;
  const dotDensity = +(raised / maxDots).toFixed(4);
  // Shannon entropy over cell values
  let entropy = 0;
  for (const f of freq) {
    if (f > 0) { const p = f / total; entropy -= p * Math.log2(p); }
  }
  return { dotDensity, entropy: +entropy.toFixed(4), raisedDots: raised, totalCells: total };
}

function popcount6(n) {
  let c = 0;
  for (let i = 0; i < 6; i++) c += (n >> i) & 1;
  return c;
}

// ── Braille fingerprint: fold bits into a 12-char braille hash ────────────────
function brailleFingerprint(text) {
  const bits = textToBitArray(text);
  if (!bits.length) return { fingerprint: '⠀'.repeat(12), hex: '0'.repeat(12) };
  // Mix via simple FNV-1a-style XOR fold into 12 buckets
  const buckets = new Array(12).fill(0);
  for (let i = 0; i < bits.length; i++) {
    buckets[i % 12] ^= bits[i];
    buckets[i % 12] = ((buckets[i % 12] * 0x27) ^ (i * 0x1f)) & 0x3F;
  }
  const fp = buckets.map(b => bitsToUnicode(b)).join('');
  const hex = buckets.map(b => b.toString(16).padStart(2,'0')).join('');
  return { fingerprint: fp, hex, buckets };
}

// ── Knowledge pack: encode text into packed 6-bit bytes (4 cells per 3 bytes) ─
function packKnowledge(text) {
  const bits = textToBitArray(text);
  const packed = [];
  for (let i = 0; i < bits.length; i += 4) {
    const chunk = bits.slice(i, i + 4);
    while (chunk.length < 4) chunk.push(0);
    let val = 0;
    for (let j = 0; j < 4; j++) val |= (chunk[j] & 0x3F) << (6 * j);
    packed.push((val & 0xFF).toString(16).padStart(2,'0'));
    packed.push(((val >> 8) & 0xFF).toString(16).padStart(2,'0'));
    packed.push(((val >> 16) & 0xFF).toString(16).padStart(2,'0'));
  }
  const stats = dotStats(bits);
  return {
    hex: packed.join(''),
    originalLength: text.length,
    cellCount: bits.length,
    packedBytes: Math.ceil(bits.length * 6 / 8),
    compressionRatio: +(text.length / Math.ceil(bits.length * 6 / 8)).toFixed(3),
    ...stats,
  };
}

// ── Dot pattern visual renderer (2-col braille grid) ─────────────────────────
function renderDotGrid(text) {
  const bits = textToBitArray(text);
  const lines = [];
  for (const b of bits) {
    const d = i => (b >> (5 - i)) & 1;
    lines.push(`[${d(0) ? '●' : '○'} ${d(3) ? '●' : '○'}]  [${d(1) ? '●' : '○'} ${d(4) ? '●' : '○'}]  [${d(2) ? '●' : '○'} ${d(5) ? '●' : '○'}]`);
  }
  return lines.join('\n');
}

// ── Diff two braille strings: highlight changed cells ─────────────────────────
function brailleDiff(textA, textB) {
  const bitsA = textToBitArray(textA);
  const bitsB = textToBitArray(textB);
  const maxLen = Math.max(bitsA.length, bitsB.length);
  let same = 0, changed = 0, added = 0, removed = 0;
  const changes = [];
  for (let i = 0; i < maxLen; i++) {
    const a = bitsA[i], b = bitsB[i];
    if (a === undefined) { added++; changes.push({ i, type: 'added', cell: bitsToUnicode(b) }); }
    else if (b === undefined) { removed++; changes.push({ i, type: 'removed', cell: bitsToUnicode(a) }); }
    else if (a !== b) { changed++; changes.push({ i, type: 'changed', from: bitsToUnicode(a), to: bitsToUnicode(b), xorBits: a ^ b }); }
    else same++;
  }
  const similarity = maxLen ? +(same / maxLen).toFixed(4) : 1;
  return { similarity, same, changed, added, removed, changes: changes.slice(0, 50) };
}

// ── GF(2)⁶ Algebra ──────────────────────────────────────────────────────────────
// Each braille cell is a vector in GF(2)⁶. Operations are component-wise over
// the 6 dot dimensions. Sequences are aligned at index 0; shorter is zero-padded.

function alignPair(bitsA, bitsB) {
  const len = Math.max(bitsA.length, bitsB.length);
  const a = [...bitsA]; while (a.length < len) a.push(0);
  const b = [...bitsB]; while (b.length < len) b.push(0);
  return [a, b, len];
}

function algebraOp(textA, textB, op) {
  const [a, b, len] = alignPair(textToBitArray(textA), textToBitArray(textB));
  const result = [];
  for (let i = 0; i < len; i++) result.push(op(a[i], b[i]));
  return result;
}

function bitsArrayToUnicode(arr) {
  return arr.map(b => bitsToUnicode(b)).join('');
}

// braille_add: vector addition in GF(2)⁶ — XOR of each cell
function brailleAdd(textA, textB) {
  const result = algebraOp(textA, textB, (a, b) => a ^ b);
  return {
    result: bitsArrayToUnicode(result),
    bits: result,
    interpretation: 'A ⊕ B: dots raised in A or B but not both',
  };
}

// braille_mul: component-wise AND — intersection of raised dots
function brailleMul(textA, textB) {
  const result = algebraOp(textA, textB, (a, b) => a & b);
  return {
    result: bitsArrayToUnicode(result),
    bits: result,
    interpretation: 'A ∧ B: only dots raised in both A and B',
  };
}

// braille_complement: additive inverse in GF(2)⁶ — flip all 6 dots
function brailleComplement(text) {
  const bits = textToBitArray(text);
  const result = bits.map(b => (~b) & 0x3F);
  return {
    result: bitsArrayToUnicode(result),
    bits: result,
    interpretation: '¬A: every raised dot lowered and vice versa (additive inverse)',
  };
}

// braille_inner_product: sum of (a_i AND b_i) popcount, mod 2 per cell, summed
// Returns a scalar in [0, len]: how many cells share at least one raised dot
function brailleInnerProduct(textA, textB) {
  const [a, b, len] = alignPair(textToBitArray(textA), textToBitArray(textB));
  let dotProdMod2 = 0, sharedCells = 0, totalSharedDots = 0;
  for (let i = 0; i < len; i++) {
    const shared = a[i] & b[i];
    const pc = popcount6(shared);
    dotProdMod2 ^= pc & 1;   // GF(2) inner product
    if (pc > 0) sharedCells++;
    totalSharedDots += pc;
  }
  return {
    dotProductGF2: dotProdMod2,
    sharedCells,
    totalSharedDots,
    cellCount: len,
    interpretation: 'GF(2) inner product (0=orthogonal, 1=non-orthogonal); sharedCells = how many positions share ≥1 dot',
  };
}

// braille_project: project A onto B — keep only dots in A that are also raised in B
function brailleProject(textA, textB) {
  const result = algebraOp(textA, textB, (a, b) => a & b);
  const original = textToBitArray(textA);
  const projected = result;
  const lostDots = original.reduce((s, v, i) => s + popcount6(v & ~projected[i]), 0);
  return {
    result: bitsArrayToUnicode(projected),
    bits: projected,
    lostDots,
    interpretation: 'proj_B(A): A restricted to the dot dimensions where B is raised',
  };
}

// braille_solve: given A and C, find B such that A ⊕ B = C  →  B = A ⊕ C
function brailleSolve(textA, textC) {
  const result = algebraOp(textA, textC, (a, c) => a ^ c);
  return {
    result: bitsArrayToUnicode(result),
    bits: result,
    equation: 'A ⊕ B = C  →  B = A ⊕ C',
    interpretation: 'The transform that maps A to C in GF(2)⁶ space',
  };
}

// braille_compose: fold-reduce a sequence of texts via XOR (algebraic composition)
// Think of it as the cumulative "sum" of knowledge fragments in GF(2)⁶
function brailleCompose(texts) {
  if (!texts.length) return { result: '', bits: [], interpretation: 'empty' };
  let acc = textToBitArray(texts[0]);
  const steps = [bitsArrayToUnicode(acc)];
  for (let i = 1; i < texts.length; i++) {
    const next = textToBitArray(texts[i]);
    const [a, b, len] = alignPair(acc, next);
    acc = [];
    for (let j = 0; j < len; j++) acc.push(a[j] ^ b[j]);
    steps.push(bitsArrayToUnicode(acc));
  }
  const stats = dotStats(acc);
  return {
    result: bitsArrayToUnicode(acc),
    bits: acc,
    steps,
    ...stats,
    interpretation: `⊕-fold over ${texts.length} fragments: cumulative GF(2)⁶ sum`,
  };
}

// ── Tools registry ─────────────────────────────────────────────────────────────
const tools = [
  {
    name: 'braille_encode',
    description: 'Encode text to Grade 1 braille. Returns unicode braille string, dot-bit array, or dot grid visualization.',
    inputSchema: { type: 'object', properties: {
      text: { type: 'string', description: 'Text to encode' },
      format: { type: 'string', enum: ['unicode', 'bits', 'grid'], description: 'Output format: unicode chars, 6-bit integers, or visual dot grid' }
    }, required: ['text'] }
  },
  {
    name: 'braille_decode',
    description: 'Decode unicode braille characters back to plain text.',
    inputSchema: { type: 'object', properties: {
      braille: { type: 'string', description: 'Unicode braille string (U+2800–U+28FF)' }
    }, required: ['braille'] }
  },
  {
    name: 'braille_analyze',
    description: 'Analyze a text\'s braille dot density and Shannon entropy. Useful for measuring information richness in the braille encoding space.',
    inputSchema: { type: 'object', properties: {
      text: { type: 'string', description: 'Text to analyze' }
    }, required: ['text'] }
  },
  {
    name: 'braille_fingerprint',
    description: 'Generate a compact 12-cell braille fingerprint (hash) of any text. Useful for semantic identity, deduplication, or tagging knowledge fragments.',
    inputSchema: { type: 'object', properties: {
      text: { type: 'string', description: 'Text to fingerprint' }
    }, required: ['text'] }
  },
  {
    name: 'braille_pack',
    description: 'Pack text into a compact 6-bit braille byte stream (4 cells per 3 bytes). Returns hex-encoded payload and compression statistics.',
    inputSchema: { type: 'object', properties: {
      text: { type: 'string', description: 'Text to pack' }
    }, required: ['text'] }
  },
  {
    name: 'braille_diff',
    description: 'Compare two texts in braille space. Returns cell-level similarity score and a list of changed/added/removed braille cells.',
    inputSchema: { type: 'object', properties: {
      textA: { type: 'string', description: 'First text' },
      textB: { type: 'string', description: 'Second text' }
    }, required: ['textA', 'textB'] }
  },
  {
    name: 'braille_add',
    description: 'Vector addition in GF(2)⁶: XOR each braille cell of two texts. Dots raised in A or B but not both survive. The fundamental algebraic operation — A ⊕ B.',
    inputSchema: { type: 'object', properties: {
      textA: { type: 'string' }, textB: { type: 'string' }
    }, required: ['textA', 'textB'] }
  },
  {
    name: 'braille_mul',
    description: 'Component-wise AND of two braille cell sequences: only dots raised in both A and B survive. Intersection product — A ∧ B.',
    inputSchema: { type: 'object', properties: {
      textA: { type: 'string' }, textB: { type: 'string' }
    }, required: ['textA', 'textB'] }
  },
  {
    name: 'braille_complement',
    description: 'Additive inverse in GF(2)⁶: flip all 6 dots of every cell. In GF(2), -A = A, so complement is its own inverse. ¬A.',
    inputSchema: { type: 'object', properties: {
      text: { type: 'string' }
    }, required: ['text'] }
  },
  {
    name: 'braille_inner_product',
    description: 'Compute the GF(2) inner product of two texts in braille space. Returns 0 if orthogonal, 1 if not, plus shared dot counts.',
    inputSchema: { type: 'object', properties: {
      textA: { type: 'string' }, textB: { type: 'string' }
    }, required: ['textA', 'textB'] }
  },
  {
    name: 'braille_project',
    description: 'Project text A onto the dot subspace defined by text B: keep only dots in A that are also raised in B. proj_B(A).',
    inputSchema: { type: 'object', properties: {
      textA: { type: 'string', description: 'Vector to project' },
      textB: { type: 'string', description: 'Subspace to project onto' }
    }, required: ['textA', 'textB'] }
  },
  {
    name: 'braille_solve',
    description: 'Solve A ⊕ B = C for B. Returns the transform that maps text A to text C in GF(2)⁶ space. Useful for finding what "separates" two knowledge states.',
    inputSchema: { type: 'object', properties: {
      textA: { type: 'string', description: 'Known input state' },
      textC: { type: 'string', description: 'Target output state' }
    }, required: ['textA', 'textC'] }
  },
  {
    name: 'braille_compose',
    description: 'Fold-reduce an array of texts via ⊕ (GF(2)⁶ addition). Returns the cumulative algebraic sum of all fragments — the "total knowledge state" of a sequence.',
    inputSchema: { type: 'object', properties: {
      texts: { type: 'array', items: { type: 'string' }, description: 'Ordered list of text fragments to compose' }
    }, required: ['texts'] }
  },
  {
    name: 'braille_status',
    description: 'Check server health and report available tools.',
    inputSchema: { type: 'object', properties: {} }
  }
];

// ── MCP transport ──────────────────────────────────────────────────────────────
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'braille-mind', version: '2.0.0' } } });
    } else if (msg.method === 'notifications/initialized') {
      // no response needed
    } else if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
    } else if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      try {
        let result;
        if (name === 'braille_encode') {
          const fmt = args.format || 'unicode';
          if (fmt === 'bits') {
            const bits = textToBitArray(args.text);
            result = { content: [{ type: 'text', text: JSON.stringify(bits) }] };
          } else if (fmt === 'grid') {
            result = { content: [{ type: 'text', text: renderDotGrid(args.text) }] };
          } else {
            result = { content: [{ type: 'text', text: textToUnicode(args.text) }] };
          }
        } else if (name === 'braille_decode') {
          result = { content: [{ type: 'text', text: unicodeToText(args.braille) }] };
        } else if (name === 'braille_analyze') {
          const bits = textToBitArray(args.text);
          const stats = dotStats(bits);
          result = { content: [{ type: 'text', text: JSON.stringify({ text: args.text, ...stats }, null, 2) }] };
        } else if (name === 'braille_fingerprint') {
          result = { content: [{ type: 'text', text: JSON.stringify(brailleFingerprint(args.text), null, 2) }] };
        } else if (name === 'braille_pack') {
          result = { content: [{ type: 'text', text: JSON.stringify(packKnowledge(args.text), null, 2) }] };
        } else if (name === 'braille_diff') {
          result = { content: [{ type: 'text', text: JSON.stringify(brailleDiff(args.textA, args.textB), null, 2) }] };
        } else if (name === 'braille_add') {
          result = { content: [{ type: 'text', text: JSON.stringify(brailleAdd(args.textA, args.textB), null, 2) }] };
        } else if (name === 'braille_mul') {
          result = { content: [{ type: 'text', text: JSON.stringify(brailleMul(args.textA, args.textB), null, 2) }] };
        } else if (name === 'braille_complement') {
          result = { content: [{ type: 'text', text: JSON.stringify(brailleComplement(args.text), null, 2) }] };
        } else if (name === 'braille_inner_product') {
          result = { content: [{ type: 'text', text: JSON.stringify(brailleInnerProduct(args.textA, args.textB), null, 2) }] };
        } else if (name === 'braille_project') {
          result = { content: [{ type: 'text', text: JSON.stringify(brailleProject(args.textA, args.textB), null, 2) }] };
        } else if (name === 'braille_solve') {
          result = { content: [{ type: 'text', text: JSON.stringify(brailleSolve(args.textA, args.textC), null, 2) }] };
        } else if (name === 'braille_compose') {
          result = { content: [{ type: 'text', text: JSON.stringify(brailleCompose(args.texts), null, 2) }] };
        } else if (name === 'braille_status') {
          result = { content: [{ type: 'text', text: `✅ BrailleMind MCP v2.1 ready — ${tools.length} tools: ${tools.map(t => t.name).join(', ')}` }] };
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }
        send({ jsonrpc: '2.0', id: msg.id, result });
      } catch (e) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } });
      }
    } else {
      if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: null });
    }
  } catch (e) {}
});

process.stderr.write('BrailleMind MCP v2.1 (algebra) running...\n');