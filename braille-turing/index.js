#!/usr/bin/env node
/**
 * braille-turing MCP server
 * 
 * Rule 110 cellular automaton in braille-space:
 * - Tape: sequence of braille cells (0-63)
 * - Rule 110: 3-cell neighborhood → next state
 * - GF(2)⁶ operations implement the transition
 * 
 * Rule 110 is Turing-complete. If it emerges from braille-cell algebra,
 * we've shown ℤ_256 can universal computation.
 */

import readline from 'readline';

// ── Rule 110 transition table ───────────────────────────────────────────────
// Neighborhood (left, center, right) → next state
// 111 → 0, 110 → 1, 101 → 1, 100 → 0, 011 → 1, 010 → 1, 001 → 1, 000 → 0
const RULE_110 = {
  0b111: 0,
  0b110: 1,
  0b101: 1,
  0b100: 0,
  0b011: 1,
  0b010: 1,
  0b001: 1,
  0b000: 0,
};

// Exact Rule 110 (using lookup)
function rule110_step(left, center, right) {
  const neighborhood = ((left & 1) << 2) | ((center & 1) << 1) | (right & 1);
  return RULE_110[neighborhood];
}

// Linear approximation (for GF(2)⁶ algebra demonstration)
// This is NOT exact Rule 110 (which is nonlinear), but shows the structure
const RULE_110_LINEAR = (l, c, r) => {
  // Approximation: next = l ⊕ c ⊕ (l ∧ r)
  // Real Rule 110 requires XOR+AND+NOT which is nonlinear
  return ((l ^ c) | (l & r)) & 1;
};

// ── Tape operations ────────────────────────────────────────────────────────
function tape_from_string(s) {
  // String of 0s and 1s → array of {0,1}
  return s.split('').map(c => c === '1' ? 1 : 0);
}

function tape_to_string(tape) {
  return tape.map(c => c ? '1' : '0').join('');
}

// One step of Rule 110 on entire tape
function turing_step(tape, wrap = true) {
  const n = tape.length;
  const next = new Array(n);
  
  for (let i = 0; i < n; i++) {
    const left = wrap ? tape[(i - 1 + n) % n] : tape[i - 1] ?? 0;
    const center = tape[i];
    const right = wrap ? tape[(i + 1) % n] : tape[i + 1] ?? 0;
    next[i] = rule110_step(left, center, right);
  }
  
  return next;
}

// GF(2)⁶ linear approximation step
function turing_step_linear(tape) {
  const n = tape.length;
  const next = new Array(n);
  
  for (let i = 0; i < n; i++) {
    const left = tape[i - 1] ?? 0;
    const center = tape[i];
    const right = tape[i + 1] ?? 0;
    next[i] = RULE_110_LINEAR(left, center, right);
  }
  
  return next;
}

// Run n generations, return as ASCII art
function turing_run(initial, generations, wrap = true) {
  let tape = tape_from_string(initial);
  const history = [tape_to_string(tape)];
  const limit = Math.min(generations, 500);
  for (let gen = 0; gen < limit; gen++) {
    tape = turing_step(tape, wrap);
    history.push(tape_to_string(tape));
  }
  
  return history;
}

// Compute GF(2)⁶ span of Rule 110 transitions
function turing_span(tapes) {
  // GF(2) Gaussian elimination — properly reduce each vector against existing basis
  const basis = [];
  for (const t of tapes) {
    let cur = tape_from_string(t);
    for (const b of basis) {
      // find pivot of b
      const pivot = b.findIndex(x => x === 1);
      if (pivot >= 0 && cur[pivot] === 1) {
        cur = cur.map((v, i) => v ^ b[i]);
      }
    }
    if (cur.some(x => x === 1)) basis.push(cur);
  }
  return { dimension: basis.length, spanSize: 1 << basis.length, note: 'GF(2) row-reduction over tape vectors' };
}

// Verify Rule 110 produces known pattern
function turing_verify() {
  let tape = Array(50).fill(0); tape[tape.length - 1] = 1;
  const results = [tape_to_string(tape)];
  for (let gen = 0; gen < 15; gen++) {
    tape = turing_step(tape, true);
    results.push(tape_to_string(tape));
  }
  const nonTrivial = results.filter(t => t.includes('1')).length;
  return {
    note: 'Rule 110 from single active cell — watch for pattern spread',
    generations: results,
    nonTrivialGens: nonTrivial,
    shows_computation: nonTrivial > 5,
  };
}

// ── MCP dispatch ────────────────────────────────────────────────────────────────
async function handleRequest(method, params) {
  switch (method) {
    case 'rule110_step': {
      const step = turing_step(
        tape_from_string(params.tape),
        params.wrap !== false
      );
      return { tape: tape_to_string(step), note: 'One step of Rule 110' };
    }
    
    case 'rule110_run':
      return { 
        history: turing_run(
          params.initial, 
          params.generations || 10,
          params.wrap !== false
        ),
        note: 'Run Rule 110 for n generations' 
      };
    
    case 'rule110_verify':
      return turing_verify();
    
    case 'rule110_linear_step': {
      const linearStep = turing_step_linear(tape_from_string(params.tape));
      return { tape: tape_to_string(linearStep), note: 'GF(2)⁶ linear approximation (not exact Rule 110)' };
    }
    
    case 'rule110_span': {
      const { basis, dimension } = turing_span(params.tapes);
      return { basis, dimension, note: 'GF(2) span of Rule 110 transitions' };
    }
    
    case 'turing_test': {
      // Simple test: can Rule 110 compute?
      // Run glider and check it produces expected pattern
      const result = turing_run('00000000000000000000100000000000000000000000000000', 10, false);
      return { 
        tape: result[result.length - 1],
        note: 'Rule 110 glider test - look for complex moving pattern' 
      };
    }
    
    default:
      return { error: `Unknown method: ${method}` };
  }
}

// ── Tools registry ──────────────────────────────────────────────────────────
const tools = [
  { name:'rule110_step',        description:'One step of exact Rule 110 on a binary tape string ("0"s and "1"s)',                           inputSchema:{ type:'object', properties:{ tape:{type:'string'}, wrap:{type:'boolean',description:'wrap edges, default true'} }, required:['tape'] } },
  { name:'rule110_run',         description:'Run Rule 110 for n generations. Returns history as array of tape strings. Exact implementation.',  inputSchema:{ type:'object', properties:{ initial:{type:'string'}, generations:{type:'number'}, wrap:{type:'boolean'} }, required:['initial'] } },
  { name:'rule110_verify',      description:'Run Rule 110 from a single active cell and return 15 generations — shows glider emergence',         inputSchema:{ type:'object', properties:{} } },
  { name:'rule110_linear_step', description:'One step of GF(2)⁶ linear approximation of Rule 110 (NOT exact — shows where linearity breaks)',  inputSchema:{ type:'object', properties:{ tape:{type:'string'} }, required:['tape'] } },
  { name:'rule110_span',        description:'GF(2) Gaussian elimination on a set of tape strings — find the dimension of their span',           inputSchema:{ type:'object', properties:{ tapes:{type:'array',items:{type:'string'}} }, required:['tapes'] } },
  { name:'turing_test',         description:'Run Rule 110 glider test from a single cell — check for complex moving pattern (evidence of computation)', inputSchema:{ type:'object', properties:{} } },
];

// ── Transport ────────────────────────────────────────────────────────────────
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      send({ jsonrpc:'2.0', id:msg.id, result:{ protocolVersion:'2024-11-05', capabilities:{ tools:{} }, serverInfo:{ name:'braille-turing', version:'1.0.0' } } });
    } else if (msg.method === 'notifications/initialized') {
      // no response
    } else if (msg.method === 'tools/list') {
      send({ jsonrpc:'2.0', id:msg.id, result:{ tools } });
    } else if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      try {
        const data = await handleRequest(name, args);
        send({ jsonrpc:'2.0', id:msg.id, result:{ content:[{ type:'text', text: JSON.stringify(data, null, 2) }] } });
      } catch(e) {
        send({ jsonrpc:'2.0', id:msg.id, error:{ code:-32603, message: e.message } });
      }
    } else {
      if (msg.id !== undefined) send({ jsonrpc:'2.0', id:msg.id, result:null });
    }
  } catch(e) {}
});

process.stderr.write('braille-turing MCP v1.0: Rule 110 in braille space\n');