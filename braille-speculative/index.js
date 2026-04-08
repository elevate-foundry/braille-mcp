#!/usr/bin/env node
import readline from 'readline';

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

const tools = [
  { name:'text_to_dots',  description:'Convert text to braille dot arrays (0-63 per cell)',                                          inputSchema:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } },
  { name:'dots_to_text',  description:'Convert dot arrays back to text',                                                               inputSchema:{ type:'object', properties:{ dots:{type:'array',items:{type:'number'}} }, required:['dots'] } },
  { name:'find_nearby',   description:'Find valid braille words within Hamming distance of input text (1-bit flips per cell)',          inputSchema:{ type:'object', properties:{ text:{type:'string'}, maxDist:{type:'number'} }, required:['text'] } },
  { name:'fuzzy_decode',  description:'Ranked candidates by braille proximity score — useful after algebraic ops that leave valid space', inputSchema:{ type:'object', properties:{ text:{type:'string'}, maxDist:{type:'number'} }, required:['text'] } },
  { name:'project',       description:'Project textA onto textB dot subspace (AND per cell)',                                          inputSchema:{ type:'object', properties:{ textA:{type:'string'}, textB:{type:'string'} }, required:['textA','textB'] } },
  { name:'solve',         description:'Find XOR transform that maps textA to targetC in braille dot space',                            inputSchema:{ type:'object', properties:{ textA:{type:'string'}, targetC:{type:'string'} }, required:['textA','targetC'] } },
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      send({ jsonrpc:'2.0', id:msg.id, result:{ protocolVersion:'2024-11-05', capabilities:{ tools:{} }, serverInfo:{ name:'braille-speculative', version:'1.0.0' } } });
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

process.stderr.write('braille-speculative MCP v1.0 ready\n');