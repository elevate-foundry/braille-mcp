#!/usr/bin/env node

const BRAILLE_UNICODE_START = 0x2800;
const ENCODING = {
  'a': '⠁', 'b': '⠃', 'c': '⠉', 'd': '⠙', 'e': '⠑', 'f': '⠋', 'g': '⠛', 'h': '⠓',
  'i': '⠊', 'j': '⠒', 'k': '⠅', 'l': '⠇', 'm': '⠍', 'n': '⠝', 'o': '⠕', 'p': '⠏',
  'q': '⠟', 'r': '⠗', 's': '⠎', 't': '⠞', 'u': '⠥', 'v': '⠧', 'w': '⠺', 'x': '⠭',
  'y': '⠽', 'z': '⠵', ' ': ' ',
  '1': '⠼', '2': '⠼', '3': '⠼', '4': '⠼', '5': '⠼', '6': '⠼', '7': '⠼', '8': '⠼', '9': '⠼', '0': '⠼'
};

const DECODING = Object.fromEntries(Object.entries(ENCODING).map(([k, v]) => [v, k]));

function charToDots(ch) {
  const braille = ENCODING[ch.toLowerCase()];
  if (!braille) return null;
  return braille.charCodeAt(0) - BRAILLE_UNICODE_START;
}

function dotsToChar(dots) {
  if (dots < 0x2800 || dots > 0x28FF) return '?';
  const braille = String.fromCharCode(dots);
  return DECODING[braille] || '?';
}

function textToDots(text) {
  return text.split('').map(charToDots).filter(d => d !== null);
}

function dotsToText(dots) {
  return dots.map(dotsToChar).join('');
}

function hammingDistance(a, b) {
  let count = 0;
  for (let i = 0; i < 6; i++) {
    if (((a >> i) & 1) !== ((b >> i) & 1)) count++;
  }
  return count;
}

function findNearby(text, maxDist = 2) {
  const inputDots = textToDots(text);
  if (inputDots.length === 0) return [];
  
  const results = [];
  
  // For each character position, generate nearby characters by bit-flipping
  for (let pos = 0; pos < inputDots.length; pos++) {
    const original = inputDots[pos];
    
    // Try flipping each bit
    for (let bit = 0; bit < 6; bit++) {
      const flipped = original ^ (1 << bit);
      const c = dotsToChar(flipped);
      if (c !== '?') {
        // Build candidate with this change
        const candidateDots = [...inputDots];
        candidateDots[pos] = flipped;
        const candidateText = dotsToText(candidateDots);
        if (candidateText && !candidateText.includes('?')) {
          results.push({ 
            dots: candidateDots, 
            text: candidateText, 
            dist: 1,
            changedPos: pos,
            fromChar: text[pos],
            toChar: candidateText[pos]
          });
        }
      }
    }
  }
  
  // Also include original
  results.push({ dots: [...inputDots], text: text, dist: 0 });
  
  // Dedupe and sort
  const seen = new Map();
  for (const r of results) {
    const key = r.text;
    if (!seen.has(key) || seen.get(key).dist > r.dist) {
      seen.set(key, r);
    }
  }
  
  return Array.from(seen.values())
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 10);
}

function project(textA, textB) {
  const dotsA = textToDots(textA);
  const dotsB = textToDots(textB);
  
  if (dotsA.length !== dotsB.length) {
    return { error: 'Text lengths must match' };
  }
  
  const projected = dotsA.map((a, i) => a & dotsB[i]);
  return { dots: projected, text: dotsToText(projected) };
}

function solve(textA, targetC) {
  const inputDots = textToDots(textA);
  const targetDots = textToDots(targetC);
  
  if (inputDots.length !== targetDots.length) {
    return { error: 'Text lengths must match for A→C transform' };
  }
  
  const transform = inputDots.map((a, i) => a ^ targetDots[i]);
  return { transform: transform, note: 'XOR bits needed to go from A to C' };
}

async function handleRequest(method, params) {
  switch (method) {
    case 'text_to_dots':
      return { dots: textToDots(params.text), note: 'Convert text to dot arrays (0-63 per cell)' };
    
    case 'dots_to_text':
      return { text: dotsToText(params.dots), note: 'Convert dot arrays back to text' };
    
    case 'find_nearby':
      const nearby = findNearby(params.text, params.maxDist || 2);
      return { results: nearby, note: 'Nearby braille patterns within Hamming distance' };
    
    case 'project':
      return project(params.textA, params.textB);
    
    case 'solve':
      return solve(params.textA, params.targetC);
    
    case 'fuzzy_decode':
      const candidates = findNearby(params.text, params.maxDist || 2);
      return { 
        input: params.text, 
        candidates: candidates.map(c => ({
          text: c.text,
          distance: c.dist,
          score: 1 / (c.dist + 1)
        })).sort((a, b) => b.score - a.score),
        note: 'Ranked candidates by proximity'
      };
    
    default:
      return { error: `Unknown method: ${method}` };
  }
}

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('Speculative decoder ready');

rl.on('line', async (line) => {
  try {
    const req = JSON.parse(line);
    const result = await handleRequest(req.method, req.params);
    console.log(JSON.stringify(result));
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
  }
});