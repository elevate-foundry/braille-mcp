import { spawn } from 'child_process';

// 'a'=0b100000=32, 'c'=0b100100=36
// AND(32,36) = 32 = 'a' (exact), XOR(32,36) = 4 (invalid — test nearest)
const msgs = [
  { jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{name:'test',version:'1'} } },
  { jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'gf2_mul',    arguments:{ a:32, b:36 } } },        // AND(a,c) = 32
  { jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'gf2_decode', arguments:{ a:32, mode:'exact' } } }, // should be 'a'
  { jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'gf2_add',    arguments:{ a:32, b:36 } } },        // XOR(a,c) = 4
  { jsonrpc:'2.0', id:5, method:'tools/call', params:{ name:'gf2_decode', arguments:{ a:4,  mode:'exact' } } }, // invalid
  { jsonrpc:'2.0', id:6, method:'tools/call', params:{ name:'gf2_decode', arguments:{ a:4,  mode:'nearest' } } }, // nearest neighbor
  { jsonrpc:'2.0', id:7, method:'tools/call', params:{ name:'gf2_valid_cells', arguments:{} } },
];

const proc = spawn('node', ['/Users/ryanbarrett/mcp-servers/braille-algebra/index.js'], {
  stdio: ['pipe','pipe','pipe']
});

let buf = '';
proc.stdout.on('data', d => {
  buf += d;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const id = msg.id;
      const content = msg.result?.content?.[0]?.text;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          // for algebra_list just show keys
          if (id === 8) {
            console.log(`[${id}] algebra_list → algebras: ${Object.keys(parsed).join(', ')}`);
          } else {
            console.log(`[${id}] ${JSON.stringify(parsed, null, 2).slice(0,300)}`);
          }
        } catch { console.log(`[${id}] ${content.slice(0,300)}`); }
      } else if (msg.result) {
        console.log(`[${id}] initialize OK`);
      } else if (msg.error) {
        console.log(`[${id}] ERROR: ${msg.error.message}`);
      }
    } catch { console.log('parse error:', line); }
  }
});

proc.stderr.on('data', d => process.stderr.write(d));

proc.on('close', () => console.log('\ndone.'));

// send all messages with a small gap so readline sees each line
let i = 0;
const next = () => {
  if (i >= msgs.length) { proc.stdin.end(); return; }
  proc.stdin.write(JSON.stringify(msgs[i++]) + '\n');
  setTimeout(next, 30);
};
next();

setTimeout(() => { console.error('timeout'); proc.kill(); process.exit(1); }, 8000);
