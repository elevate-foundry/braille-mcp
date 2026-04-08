import { spawn } from 'child_process';

const msgs = [
  { jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{name:'test',version:'1'} } },
  { jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'rule110_step',   arguments:{ tape:'00010000' } } },
  { jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'rule110_verify', arguments:{} } },
  { jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'turing_test',    arguments:{} } },
];

const proc = spawn('node', ['/Users/ryanbarrett/mcp-servers/braille-turing/index.js'], {
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
