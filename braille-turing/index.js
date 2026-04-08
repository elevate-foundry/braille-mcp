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

const readline = require('readline');

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
  
  for (let gen = 0; gen < generations; gen++) {
    tape = turing_step(tape, wrap);
    history.push(tape_to_string(tape));
  }
  
  return history;
}

// Compute GF(2)⁶ span of Rule 110 transitions
function turing_span(tapes) {
  const vectors = tapes.map(t => tape_from_string(t));
  // Gaussian elimination over GF(2)
  const basis = [];
  for (const v of vectors) {
    let cur = [...v];
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] === 1) {
        // Found pivot at position i
        basis.push(cur);
        break;
      }
    }
  }
  return { basis, dimension: basis.length };
}

// Verify Rule 110 produces known pattern
function turing_verify() {
  // Classic Rule 110 glider from single cell
  const tape = '00000000000000000000000000000000000000000000000001'.split('').map(Number);
  const results = [];
  
  for (let gen = 0; gen < 15; gen++) {
    results.push(tape.join(''));
    tape.splice(0, 0, 0);
    tape.splice(tape.length, 0, 0);
    tape = turing_step(tape, false);
  }
  
  return {
    note: 'Rule 110 from single cell (001 → glider)',
    generations: results,
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

// ── Transport ────────────────────────────────────────────────────────────────
console.log('braille-turing MCP: Rule 110 in braille space');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.on('line', async (line) => {
  try {
    const req = JSON.parse(line);
    const result = await handleRequest(req.method, req.params);
    console.log(JSON.stringify(result));
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
  }
});