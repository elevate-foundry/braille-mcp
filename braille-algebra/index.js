#!/usr/bin/env node
/**
 * braille-algebra MCP server
 *
 * Exposes six named algebras so an AI can reason about algebraic structure:
 *
 *   zn        — integers mod n  (commutative ring)
 *   gf2_6     — GF(2)^6 braille dot field  (vector space, XOR/AND)
 *   boolean   — Boolean lattice  (meet, join, complement, implication)
 *   tropical  — (min,+) tropical semiring  (no division, path-optimal)
 *   sym       — symmetric group S_n  (permutations: compose, invert, cycle)
 *   poly      — polynomials over GF(p)  (add, mul, mod, evaluate)
 *
 * Each tool name is prefixed with its algebra: zn_, gf2_, bool_, trop_, sym_, poly_
 * plus algebra_list / algebra_status at the top level.
 */
import readline from 'readline';

// ── helpers ───────────────────────────────────────────────────────────────────
const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
function modN(x, n) { return ((x % n) + n) % n; }
function extGcd(a, b) {
  if (b === 0) return [a, 1, 0];
  const [g, x, y] = extGcd(b, a % b);
  return [g, y, x - Math.floor(a / b) * y];
}
function modInv(a, n) {
  const [g, x] = extGcd(modN(a, n), n);
  return g === 1 ? modN(x, n) : null;
}

// ── ZN: integers mod n ────────────────────────────────────────────────────────
const zn = {
  add: (a, b, n) => ({ result: modN(a + b, n), algebra: `Z_${n}`, op: `${a} + ${b} ≡ ${modN(a+b,n)} (mod ${n})` }),
  mul: (a, b, n) => ({ result: modN(a * b, n), algebra: `Z_${n}`, op: `${a} × ${b} ≡ ${modN(a*b,n)} (mod ${n})` }),
  inv: (a, n) => {
    const r = modInv(a, n);
    return { result: r, algebra: `Z_${n}`, op: r !== null ? `${a}⁻¹ ≡ ${r} (mod ${n})` : `${a} has no inverse mod ${n} (gcd=${gcd(a,n)})`, invertible: r !== null };
  },
  pow: (a, k, n) => {
    let r = 1, base = modN(a, n);
    let exp = k;
    while (exp > 0) { if (exp & 1) r = modN(r * base, n); base = modN(base * base, n); exp >>= 1; }
    return { result: r, algebra: `Z_${n}`, op: `${a}^${k} ≡ ${r} (mod ${n})` };
  },
  order: (a, n) => {
    const a0 = modN(a, n);
    if (gcd(a0, n) !== 1) return { result: null, msg: `${a} not coprime to ${n}, infinite order in multiplicative sense` };
    let cur = a0, ord = 1;
    while (cur !== 1) { cur = modN(cur * a0, n); ord++; }
    return { result: ord, algebra: `Z_${n}`, op: `ord(${a}) = ${ord}` };
  },
  phi: (n) => {
    let c = 0;
    for (let i = 1; i < n; i++) if (gcd(i, n) === 1) c++;
    return { result: c, algebra: `Z_${n}`, op: `φ(${n}) = ${c}` };
  },
  solve: (a, b, n) => {
    const g = gcd(a, n);
    if (b % g !== 0) return { solutions: [], msg: `ax ≡ b (mod n) has no solution: gcd(${a},${n})=${g} ∤ ${b}` };
    const a1 = a/g, b1 = b/g, n1 = n/g;
    const x0 = modN(b1 * modInv(a1, n1), n1);
    const sols = Array.from({length: g}, (_, i) => modN(x0 + i * n1, n));
    return { solutions: sols, algebra: `Z_${n}`, op: `${a}x ≡ ${b} (mod ${n})  →  x ∈ {${sols.join(', ')}}` };
  },
};

// ── GF(2)^6: braille dot vector space ─────────────────────────────────────────
// Each element is an integer 0–63 representing 6 dot bits.
// This is the canonical algebraic home of the braille cell.
// Bit layout matches braille-mind: [d1 d2 d3 d4 d5 d6] as bits [5 4 3 2 1 0]
const GF2_CHAR_TO_BITS = {
  'a':0b100000,'b':0b110000,'c':0b100100,'d':0b100110,'e':0b100010,
  'f':0b110100,'g':0b110110,'h':0b110010,'i':0b010100,'j':0b010110,
  'k':0b101000,'l':0b111000,'m':0b101100,'n':0b101110,'o':0b101010,
  'p':0b111100,'q':0b111110,'r':0b111010,'s':0b011100,'t':0b011110,
  'u':0b101001,'v':0b111001,'w':0b010111,'x':0b101101,'y':0b101111,
  'z':0b101011,' ':0b000000,
  ',':0b010000,'.':0b010011,';':0b011000,'?':0b011001,'!':0b011010,
  '-':0b001001,':':0b010010,"'":0b001000,'(':0b111011,')':0b011111,
};
const GF2_BITS_TO_CHAR = Object.fromEntries(
  Object.entries(GF2_CHAR_TO_BITS).map(([c,b]) => [b, c])
);
const gf2 = {
  add: (a, b) => ({ result: a ^ b, op: `${a} ⊕ ${b} = ${a^b}`, note: 'XOR: vector addition in GF(2)^6' }),
  mul: (a, b) => ({ result: a & b, op: `${a} ∧ ${b} = ${a&b}`, note: 'AND: component-wise product (not a field mul, but useful)' }),
  neg: (a) => ({ result: a, note: 'In GF(2), -a = a (characteristic 2, every element is its own additive inverse)' }),
  complement: (a) => ({ result: (~a) & 0x3F, op: `¬${a} = ${(~a)&0x3F}`, note: 'Flip all 6 dots (additive complement to 0x3F)' }),
  popcount: (a) => ({ result: [...Array(6)].reduce((c,_,i) => c + ((a>>i)&1), 0), op: `popcount(${a})`, note: 'Number of raised dots' }),
  inner: (a, b) => {
    const shared = a & b;
    const pc = [...Array(6)].reduce((c,_,i) => c + ((shared>>i)&1), 0);
    return { result: pc & 1, sharedDots: pc, note: 'GF(2) inner product: parity of shared raised dots. 0 = orthogonal.' };
  },
  span: (elements) => {
    // Gaussian elimination over GF(2) to find basis
    const basis = [];
    for (let v of elements) {
      let cur = v & 0x3F;
      for (const b of basis) cur = Math.min(cur, cur ^ b);
      if (cur !== 0) basis.push(cur);
    }
    return { basis, dimension: basis.length, spanSize: 1 << basis.length, note: 'Basis of subspace spanned by input vectors via GF(2) Gaussian elimination' };
  },
  dot_to_bits: (n) => {
    const bits = [];
    for (let i = 5; i >= 0; i--) bits.push((n >> i) & 1);
    return { bits, dotLabels: bits.map((b,i) => b ? `d${i+1}` : null).filter(Boolean), value: n };
  },
  decode: (a, mode = 'exact') => {
    const exact = GF2_BITS_TO_CHAR[a & 0x3F];
    if (mode === 'exact') {
      return { value: a, char: exact ?? null, valid: exact !== undefined, note: exact ? `'${exact}' (bits=${a})` : `bits=${a} is not a mapped braille character` };
    }
    // nearest: find valid cell(s) with minimum Hamming distance
    let bestDist = 7, bestChars = [];
    for (const [bits, ch] of Object.entries(GF2_BITS_TO_CHAR)) {
      const b = Number(bits);
      const dist = [...Array(6)].reduce((c,_,i) => c + (((a ^ b) >> i) & 1), 0);
      if (dist < bestDist) { bestDist = dist; bestChars = [{char: ch, bits: b, distance: dist}]; }
      else if (dist === bestDist) bestChars.push({char: ch, bits: b, distance: dist});
    }
    return { value: a, exact: exact ?? null, nearest: bestChars, hammingDistance: bestDist, note: bestDist === 0 ? 'Exact match' : `${bestDist} bit flip(s) from nearest valid cell(s)` };
  },
  valid_cells: () => {
    const cells = Object.entries(GF2_BITS_TO_CHAR).map(([bits, ch]) => ({ char: ch, bits: Number(bits), popcount: [...Array(6)].reduce((c,_,i) => c + ((Number(bits)>>i)&1), 0) }));
    cells.sort((a,b) => a.bits - b.bits);
    return { cells, count: cells.length, note: 'All valid Grade-1 braille characters as GF(2)^6 bit values' };
  },
};

// ── Boolean lattice ───────────────────────────────────────────────────────────
// Elements are subsets of {1..n} represented as bitmasks.
// ∧ = meet (AND = intersection), ∨ = join (OR = union), ¬ = complement
const bool = {
  meet: (a, b, n=32) => { const r = a & b; return { result: r, op: `${a} ∧ ${b} = ${r}`, note: 'Greatest lower bound (intersection)' }; },
  join: (a, b, n=32) => { const r = a | b; return { result: r, op: `${a} ∨ ${b} = ${r}`, note: 'Least upper bound (union)' }; },
  complement: (a, n) => { const r = ((1<<n)-1) ^ a; return { result: r, op: `¬${a} (n=${n}) = ${r}`, note: 'Boolean complement in 2^n lattice' }; },
  implies: (a, b, n) => { const r = (((1<<n)-1) ^ a) | b; return { result: r, op: `${a} → ${b} = ${r}`, note: '¬a ∨ b (material implication)' }; },
  absorb_check: (a, b) => ({
    'a∧(a∨b)=a': (a & (a|b)) === a,
    'a∨(a∧b)=a': (a | (a&b)) === a,
    note: 'Absorption laws — both should be true in any Boolean algebra',
  }),
  demorgan: (a, b, n) => {
    const top = ((1<<n)-1);
    const lhs_and = top ^ (a & b);
    const rhs_and = (top^a) | (top^b);
    const lhs_or  = top ^ (a | b);
    const rhs_or  = (top^a) & (top^b);
    return { 'de_morgan_and': { lhs: lhs_and, rhs: rhs_and, holds: lhs_and===rhs_and }, 'de_morgan_or': { lhs: lhs_or, rhs: rhs_or, holds: lhs_or===rhs_or } };
  },
};

// ── Tropical semiring (min, +) ─────────────────────────────────────────────────
// ⊕ = min (addition), ⊗ = + (multiplication). Zero = ∞, One = 0.
// No subtraction, no division. Models shortest-path distances.
const INF = Infinity;
const trop = {
  add: (a, b) => ({ result: Math.min(a,b), op: `${a} ⊕ ${b} = ${Math.min(a,b)}`, note: 'Tropical addition = min' }),
  mul: (a, b) => {
    const r = (a === INF || b === INF) ? INF : a + b;
    return { result: r, op: `${a} ⊗ ${b} = ${r}`, note: 'Tropical multiplication = ordinary addition' };
  },
  pow: (a, k) => {
    if (a === INF) return { result: INF };
    return { result: a * k, op: `${a}^${k} = ${a*k}`, note: 'Tropical power = ordinary scalar multiplication' };
  },
  matrix_mul: (A, B) => {
    // A, B are n×n matrices as flat arrays, row-major
    const n = Math.round(Math.sqrt(A.length));
    const C = Array(n*n).fill(INF);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < n; k++) {
          const v = (A[i*n+k] === INF || B[k*n+j] === INF) ? INF : A[i*n+k] + B[k*n+j];
          if (v < C[i*n+j]) C[i*n+j] = v;
        }
    return { result: C, n, note: 'Tropical matrix product: shortest path composition (one step of Floyd-Warshall)' };
  },
  shortest_path: (adj, src, dst) => {
    // adj: n×n flat distance matrix (INF = no edge), Dijkstra-like via tropical powers
    const n = Math.round(Math.sqrt(adj.length));
    const dist = Array(n).fill(INF);
    dist[src] = 0;
    const visited = new Set();
    for (let iter = 0; iter < n; iter++) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!visited.has(i) && (u === -1 || dist[i] < dist[u])) u = i;
      if (u === -1 || dist[u] === INF) break;
      visited.add(u);
      for (let v = 0; v < n; v++) {
        const w = adj[u*n+v];
        if (w !== INF && dist[u] + w < dist[v]) dist[v] = dist[u] + w;
      }
    }
    return { distances: dist, from: src, to: dst, shortest: dist[dst], note: 'Dijkstra in tropical semiring: dist[v] = ⊕-sum of edge weights' };
  },
};

// ── Symmetric group S_n ────────────────────────────────────────────────────────
// Permutations as 0-indexed arrays of length n. p[i] = where position i maps to.
const sym = {
  compose: (p, q) => {
    if (p.length !== q.length) throw new Error('Permutations must have same length');
    const r = p.map((_, i) => q[p[i]]);
    return { result: r, op: `q∘p: first apply p, then q`, note: 'Function composition (right-to-left)' };
  },
  inverse: (p) => {
    const r = Array(p.length);
    p.forEach((v, i) => r[v] = i);
    return { result: r, note: 'p⁻¹: p∘p⁻¹ = identity' };
  },
  order: (p) => {
    const id = p.map((_, i) => i);
    const compose1 = (a, b) => a.map((_, i) => b[a[i]]);
    let cur = [...p], ord = 1;
    while (JSON.stringify(cur) !== JSON.stringify(id)) {
      cur = compose1(cur, p);
      ord++;
      if (ord > 100000) return { result: null, note: 'Order exceeded 100000, aborting' };
    }
    return { result: ord, note: 'Smallest k such that p^k = identity' };
  },
  cycles: (p) => {
    const visited = new Set();
    const cycles = [];
    for (let i = 0; i < p.length; i++) {
      if (visited.has(i)) continue;
      const cycle = [];
      let cur = i;
      while (!visited.has(cur)) { visited.add(cur); cycle.push(cur); cur = p[cur]; }
      if (cycle.length > 1) cycles.push(cycle);
    }
    const sign = cycles.reduce((s, c) => s * (c.length % 2 === 0 ? -1 : 1), 1);
    return { cycles, sign, isEven: sign === 1, note: 'Cycle decomposition; sign = (-1)^(number of even-length cycles)' };
  },
  identity: (n) => ({ result: Array.from({length:n},(_,i)=>i), note: 'Identity permutation of S_'+n }),
  random: (n) => {
    const p = Array.from({length:n},(_,i)=>i);
    for (let i = n-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [p[i],p[j]]=[p[j],p[i]]; }
    return { result: p, note: 'Fisher-Yates random permutation' };
  },
};

// ── Polynomials over GF(p) ─────────────────────────────────────────────────────
// Polynomials as coefficient arrays [a0, a1, a2, ...] where a0 is constant term.
const poly = {
  add: (f, g, p) => {
    const len = Math.max(f.length, g.length);
    const r = Array(len).fill(0);
    for (let i = 0; i < len; i++) r[i] = modN((f[i]||0) + (g[i]||0), p);
    while (r.length > 1 && r[r.length-1] === 0) r.pop();
    return { result: r, field: `GF(${p})`, note: 'Polynomial addition in GF(p)[x]' };
  },
  mul: (f, g, p) => {
    const r = Array(f.length + g.length - 1).fill(0);
    for (let i = 0; i < f.length; i++)
      for (let j = 0; j < g.length; j++)
        r[i+j] = modN(r[i+j] + f[i]*g[j], p);
    return { result: r, field: `GF(${p})`, note: 'Polynomial multiplication in GF(p)[x]' };
  },
  divmod: (f, g, p) => {
    let rem = [...f];
    const q = Array(Math.max(0, f.length - g.length + 1)).fill(0);
    const lead = g[g.length-1];
    const leadInv = modInv(lead, p);
    if (leadInv === null) throw new Error(`Leading coefficient ${lead} not invertible mod ${p}`);
    for (let i = rem.length - 1; i >= g.length - 1; i--) {
      const coef = modN(rem[i] * leadInv, p);
      q[i - g.length + 1] = coef;
      for (let j = 0; j < g.length; j++) rem[i-g.length+1+j] = modN(rem[i-g.length+1+j] - coef*g[j], p);
    }
    while (rem.length > 1 && rem[rem.length-1] === 0) rem.pop();
    return { quotient: q, remainder: rem, field: `GF(${p})`, note: 'Euclidean division: f = q·g + r' };
  },
  eval: (f, x, p) => {
    let r = 0, xp = 1;
    for (const c of f) { r = modN(r + c * xp, p); xp = modN(xp * x, p); }
    return { result: r, field: `GF(${p})`, note: `f(${x}) mod ${p}` };
  },
  degree: (f) => ({ result: f.length - 1, leading: f[f.length-1] }),
  format: (f, varName='x') => {
    const terms = f.map((c,i) => c === 0 ? null : i === 0 ? `${c}` : `${c === 1 ? '' : c}${varName}${i > 1 ? `^${i}` : ''}`).filter(Boolean).reverse();
    return { string: terms.length ? terms.join(' + ') : '0' };
  },
};

// ── Tools ─────────────────────────────────────────────────────────────────────
const tools = [
  // meta
  { name: 'algebra_list', description: 'List all available algebras with their axioms and intended use', inputSchema: { type: 'object', properties: {} } },
  { name: 'algebra_status', description: 'Server health check', inputSchema: { type: 'object', properties: {} } },

  // ZN
  { name: 'zn_add', description: 'Add two integers in Z_n (mod n ring)', inputSchema: { type:'object', properties:{ a:{type:'number'}, b:{type:'number'}, n:{type:'number',description:'modulus'} }, required:['a','b','n'] } },
  { name: 'zn_mul', description: 'Multiply two integers in Z_n', inputSchema: { type:'object', properties:{ a:{type:'number'}, b:{type:'number'}, n:{type:'number'} }, required:['a','b','n'] } },
  { name: 'zn_inv', description: 'Multiplicative inverse of a in Z_n (exists iff gcd(a,n)=1)', inputSchema: { type:'object', properties:{ a:{type:'number'}, n:{type:'number'} }, required:['a','n'] } },
  { name: 'zn_pow', description: 'Fast modular exponentiation: a^k mod n', inputSchema: { type:'object', properties:{ a:{type:'number'}, k:{type:'number'}, n:{type:'number'} }, required:['a','k','n'] } },
  { name: 'zn_order', description: 'Multiplicative order of a in Z_n (smallest k: a^k ≡ 1)', inputSchema: { type:'object', properties:{ a:{type:'number'}, n:{type:'number'} }, required:['a','n'] } },
  { name: 'zn_phi', description: 'Euler totient φ(n): count of integers < n coprime to n', inputSchema: { type:'object', properties:{ n:{type:'number'} }, required:['n'] } },
  { name: 'zn_solve', description: 'Solve ax ≡ b (mod n) for x; returns all solutions', inputSchema: { type:'object', properties:{ a:{type:'number'}, b:{type:'number'}, n:{type:'number'} }, required:['a','b','n'] } },

  // GF(2)^6
  { name: 'gf2_add', description: 'Vector addition in GF(2)^6: a XOR b (the braille dot field)', inputSchema: { type:'object', properties:{ a:{type:'number',description:'integer 0-63'}, b:{type:'number'} }, required:['a','b'] } },
  { name: 'gf2_mul', description: 'Component-wise AND in GF(2)^6: dot intersection', inputSchema: { type:'object', properties:{ a:{type:'number'}, b:{type:'number'} }, required:['a','b'] } },
  { name: 'gf2_complement', description: 'Flip all 6 dot bits: additive complement in GF(2)^6', inputSchema: { type:'object', properties:{ a:{type:'number'} }, required:['a'] } },
  { name: 'gf2_inner', description: 'GF(2) inner product of two dot vectors: parity of shared raised dots. 0=orthogonal.', inputSchema: { type:'object', properties:{ a:{type:'number'}, b:{type:'number'} }, required:['a','b'] } },
  { name: 'gf2_span', description: 'Find basis of subspace spanned by a set of GF(2)^6 vectors (Gaussian elimination)', inputSchema: { type:'object', properties:{ elements:{type:'array',items:{type:'number'}} }, required:['elements'] } },
  { name: 'gf2_bits', description: 'Show dot decomposition of a GF(2)^6 element (which dots are raised)', inputSchema: { type:'object', properties:{ a:{type:'number'} }, required:['a'] } },
  { name: 'gf2_decode', description: 'Decode a GF(2)^6 bit value back to a braille character. mode=exact returns null if not a valid cell; mode=nearest finds the closest valid character by Hamming distance. Use this after any algebraic op to get a meaningful interpretation.', inputSchema: { type:'object', properties:{ a:{type:'number',description:'integer 0-63'}, mode:{type:'string',enum:['exact','nearest'],description:'exact or nearest-neighbor'} }, required:['a'] } },
  { name: 'gf2_valid_cells', description: 'List all valid Grade-1 braille characters as GF(2)^6 bit values. Shows the full alphabet in the dot field.', inputSchema: { type:'object', properties:{} } },

  // Boolean lattice
  { name: 'bool_meet', description: 'Boolean meet (AND/intersection): greatest lower bound in the lattice', inputSchema: { type:'object', properties:{ a:{type:'number'}, b:{type:'number'} }, required:['a','b'] } },
  { name: 'bool_join', description: 'Boolean join (OR/union): least upper bound in the lattice', inputSchema: { type:'object', properties:{ a:{type:'number'}, b:{type:'number'} }, required:['a','b'] } },
  { name: 'bool_complement', description: 'Boolean complement of a in a 2^n lattice (flip all n bits)', inputSchema: { type:'object', properties:{ a:{type:'number'}, n:{type:'number',description:'number of elements in the base set'} }, required:['a','n'] } },
  { name: 'bool_implies', description: 'Boolean implication a→b = ¬a∨b in the lattice', inputSchema: { type:'object', properties:{ a:{type:'number'}, b:{type:'number'}, n:{type:'number'} }, required:['a','b','n'] } },
  { name: 'bool_demorgan', description: "Verify De Morgan's laws for a pair of elements", inputSchema: { type:'object', properties:{ a:{type:'number'}, b:{type:'number'}, n:{type:'number'} }, required:['a','b','n'] } },

  // Tropical semiring
  { name: 'trop_add', description: 'Tropical addition: min(a,b). Identity element is +∞.', inputSchema: { type:'object', properties:{ a:{type:'number'}, b:{type:'number'} }, required:['a','b'] } },
  { name: 'trop_mul', description: 'Tropical multiplication: a+b (ordinary sum). Identity element is 0.', inputSchema: { type:'object', properties:{ a:{type:'number'}, b:{type:'number'} }, required:['a','b'] } },
  { name: 'trop_pow', description: 'Tropical power: a^k = k·a (ordinary scalar mul)', inputSchema: { type:'object', properties:{ a:{type:'number'}, k:{type:'number'} }, required:['a','k'] } },
  { name: 'trop_matmul', description: 'Tropical matrix multiplication (n×n flat row-major arrays): one step of all-pairs shortest paths', inputSchema: { type:'object', properties:{ A:{type:'array',items:{type:'number'}}, B:{type:'array',items:{type:'number'}} }, required:['A','B'] } },
  { name: 'trop_shortest', description: 'Dijkstra shortest path in a weighted graph given as flat n×n adjacency matrix (use 1e9 for no edge)', inputSchema: { type:'object', properties:{ adj:{type:'array',items:{type:'number'}}, src:{type:'number'}, dst:{type:'number'} }, required:['adj','src','dst'] } },

  // Symmetric group
  { name: 'sym_compose', description: 'Compose two permutations q∘p (apply p first, then q)', inputSchema: { type:'object', properties:{ p:{type:'array',items:{type:'number'}}, q:{type:'array',items:{type:'number'}} }, required:['p','q'] } },
  { name: 'sym_inverse', description: 'Invert a permutation', inputSchema: { type:'object', properties:{ p:{type:'array',items:{type:'number'}} }, required:['p'] } },
  { name: 'sym_order', description: 'Order of a permutation in S_n (smallest k: p^k = identity)', inputSchema: { type:'object', properties:{ p:{type:'array',items:{type:'number'}} }, required:['p'] } },
  { name: 'sym_cycles', description: 'Cycle decomposition of a permutation and its sign (even/odd)', inputSchema: { type:'object', properties:{ p:{type:'array',items:{type:'number'}} }, required:['p'] } },
  { name: 'sym_identity', description: 'Return the identity permutation of S_n', inputSchema: { type:'object', properties:{ n:{type:'number'} }, required:['n'] } },
  { name: 'sym_random', description: 'Generate a uniformly random permutation of S_n', inputSchema: { type:'object', properties:{ n:{type:'number'} }, required:['n'] } },

  // Polynomial over GF(p)
  { name: 'poly_add', description: 'Add two polynomials in GF(p)[x] (coefficients as arrays, index=degree)', inputSchema: { type:'object', properties:{ f:{type:'array',items:{type:'number'}}, g:{type:'array',items:{type:'number'}}, p:{type:'number',description:'prime modulus'} }, required:['f','g','p'] } },
  { name: 'poly_mul', description: 'Multiply two polynomials in GF(p)[x]', inputSchema: { type:'object', properties:{ f:{type:'array',items:{type:'number'}}, g:{type:'array',items:{type:'number'}}, p:{type:'number'} }, required:['f','g','p'] } },
  { name: 'poly_divmod', description: 'Euclidean division of polynomials in GF(p)[x]: f = q·g + r', inputSchema: { type:'object', properties:{ f:{type:'array',items:{type:'number'}}, g:{type:'array',items:{type:'number'}}, p:{type:'number'} }, required:['f','g','p'] } },
  { name: 'poly_eval', description: 'Evaluate polynomial f at point x in GF(p)', inputSchema: { type:'object', properties:{ f:{type:'array',items:{type:'number'}}, x:{type:'number'}, p:{type:'number'} }, required:['f','x','p'] } },
  { name: 'poly_format', description: 'Format a coefficient array as a human-readable polynomial string', inputSchema: { type:'object', properties:{ f:{type:'array',items:{type:'number'}}, var:{type:'string',description:'variable name, default x'} }, required:['f'] } },
];

const ALGEBRA_DESCRIPTIONS = {
  zn: { name: 'Z_n (integers mod n)', type: 'commutative ring', axioms: ['closure under + and ×','associativity','commutativity of +','distributivity','additive identity 0','additive inverse −a','multiplicative identity 1','multiplicative inverse exists iff gcd(a,n)=1'], tools: tools.filter(t=>t.name.startsWith('zn_')).map(t=>t.name), use: 'Cryptography, modular arithmetic, clock arithmetic, cyclic groups' },
  gf2_6: { name: 'GF(2)^6 braille dot field', type: 'vector space over GF(2)', axioms: ['XOR = vector addition (characteristic 2: a⊕a=0)','AND = component product','every element is its own additive inverse','6-dimensional, 64 elements','inner product detects orthogonality'], tools: tools.filter(t=>t.name.startsWith('gf2_')).map(t=>t.name), use: 'Braille cell algebra, knowledge encoding, distillation, error detection' },
  boolean: { name: 'Boolean lattice 2^n', type: 'complemented distributive lattice (Boolean algebra)', axioms: ['commutativity of ∧ and ∨','associativity','absorption: a∧(a∨b)=a','distributivity of ∧ over ∨','identity elements: ⊤ and ⊥','complement: a∧¬a=⊥, a∨¬a=⊤','De Morgan: ¬(a∧b)=¬a∨¬b'], tools: tools.filter(t=>t.name.startsWith('bool_')).map(t=>t.name), use: 'Logic, set theory, circuit design, knowledge filters' },
  tropical: { name: 'Tropical (min,+) semiring', type: 'idempotent semiring (no subtraction/division)', axioms: ['⊕ = min (idempotent: a⊕a=a)','⊗ = ordinary addition','identity for ⊕: +∞','identity for ⊗: 0','distributive: a⊗(b⊕c)=(a⊗b)⊕(a⊗c)','NO additive inverse (semiring, not ring)'], tools: tools.filter(t=>t.name.startsWith('trop_')).map(t=>t.name), use: 'Shortest paths, scheduling, optimization, dynamic programming' },
  sym: { name: 'Symmetric group S_n', type: 'non-abelian group (for n≥3)', axioms: ['closure under composition','associativity','identity = [0,1,...,n-1]','every permutation has an inverse','NOT commutative for n≥3'], tools: tools.filter(t=>t.name.startsWith('sym_')).map(t=>t.name), use: 'Shuffles, transformations, symmetry detection, Rubik\'s cube, sorting networks' },
  poly: { name: 'GF(p)[x] polynomial ring', type: 'Euclidean domain (PID)', axioms: ['addition and multiplication of polynomials mod p','Euclidean division: f=qg+r, deg(r)<deg(g)','GCD exists (Euclidean algorithm applies)','irreducible polynomials generate field extensions GF(p^n)'], tools: tools.filter(t=>t.name.startsWith('poly_')).map(t=>t.name), use: 'Error-correcting codes, AES (GF(2^8)), hashing, algebraic geometry' },
};

// ── MCP transport ─────────────────────────────────────────────────────────────
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

function dispatch(name, args) {
  // meta
  if (name === 'algebra_list') return ALGEBRA_DESCRIPTIONS;
  if (name === 'algebra_status') return { status: 'ok', version: '1.0.0', algebras: Object.keys(ALGEBRA_DESCRIPTIONS), toolCount: tools.length };

  // zn
  if (name === 'zn_add') return zn.add(args.a, args.b, args.n);
  if (name === 'zn_mul') return zn.mul(args.a, args.b, args.n);
  if (name === 'zn_inv') return zn.inv(args.a, args.n);
  if (name === 'zn_pow') return zn.pow(args.a, args.k, args.n);
  if (name === 'zn_order') return zn.order(args.a, args.n);
  if (name === 'zn_phi') return zn.phi(args.n);
  if (name === 'zn_solve') return zn.solve(args.a, args.b, args.n);

  // gf2
  if (name === 'gf2_add') return gf2.add(args.a, args.b);
  if (name === 'gf2_mul') return gf2.mul(args.a, args.b);
  if (name === 'gf2_complement') return gf2.complement(args.a);
  if (name === 'gf2_inner') return gf2.inner(args.a, args.b);
  if (name === 'gf2_span') return gf2.span(args.elements);
  if (name === 'gf2_bits') return gf2.dot_to_bits(args.a);
  if (name === 'gf2_decode') return gf2.decode(args.a, args.mode || 'exact');
  if (name === 'gf2_valid_cells') return gf2.valid_cells();

  // bool
  if (name === 'bool_meet') return bool.meet(args.a, args.b);
  if (name === 'bool_join') return bool.join(args.a, args.b);
  if (name === 'bool_complement') return bool.complement(args.a, args.n);
  if (name === 'bool_implies') return bool.implies(args.a, args.b, args.n);
  if (name === 'bool_demorgan') return bool.demorgan(args.a, args.b, args.n);

  // trop
  if (name === 'trop_add') return trop.add(args.a, args.b);
  if (name === 'trop_mul') return trop.mul(args.a, args.b);
  if (name === 'trop_pow') return trop.pow(args.a, args.k);
  if (name === 'trop_matmul') return trop.matrix_mul(args.A, args.B);
  if (name === 'trop_shortest') return trop.shortest_path(args.adj, args.src, args.dst);

  // sym
  if (name === 'sym_compose') return sym.compose(args.p, args.q);
  if (name === 'sym_inverse') return sym.inverse(args.p);
  if (name === 'sym_order') return sym.order(args.p);
  if (name === 'sym_cycles') return sym.cycles(args.p);
  if (name === 'sym_identity') return sym.identity(args.n);
  if (name === 'sym_random') return sym.random(args.n);

  // poly
  if (name === 'poly_add') return poly.add(args.f, args.g, args.p);
  if (name === 'poly_mul') return poly.mul(args.f, args.g, args.p);
  if (name === 'poly_divmod') return poly.divmod(args.f, args.g, args.p);
  if (name === 'poly_eval') return poly.eval(args.f, args.x, args.p);
  if (name === 'poly_format') return poly.format(args.f, args.var || 'x');

  throw new Error(`Unknown tool: ${name}`);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      send({ jsonrpc:'2.0', id:msg.id, result:{ protocolVersion:'2024-11-05', capabilities:{ tools:{} }, serverInfo:{ name:'braille-algebra', version:'1.0.0' } } });
    } else if (msg.method === 'notifications/initialized') {
      // no response
    } else if (msg.method === 'tools/list') {
      send({ jsonrpc:'2.0', id:msg.id, result:{ tools } });
    } else if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      try {
        const data = dispatch(name, args);
        send({ jsonrpc:'2.0', id:msg.id, result:{ content:[{ type:'text', text: JSON.stringify(data, null, 2) }] } });
      } catch(e) {
        send({ jsonrpc:'2.0', id:msg.id, error:{ code:-32603, message: e.message } });
      }
    } else {
      if (msg.id !== undefined) send({ jsonrpc:'2.0', id:msg.id, result:null });
    }
  } catch(e) {}
});

process.stderr.write('braille-algebra MCP v1.0 — 6 algebras, ' + tools.length + ' tools\n');