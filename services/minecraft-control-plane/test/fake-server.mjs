const hasSecret = Object.keys(process.env).some((key) => key.toUpperCase() === 'MASTERMIND_TEST_SECRET');
const hasPath = Object.keys(process.env).some((key) => key.toUpperCase() === 'PATH');
console.log(`Fake Minecraft server ready; secret=${hasSecret ? 'present' : 'absent'}; path=${hasPath ? 'present' : 'absent'}`);
console.log('[Geyser/INFO]: Started Geyser on 0.0.0.0:19132');
console.log('[Server thread/INFO]: Done (1.234s)! For help, type "help"');
process.stdin.setEncoding('utf8');
let stopRequests = 0;
process.stdin.on('data', (value) => {
  if (value.split(/\r?\n/).includes('stop')) {
    stopRequests += 1;
    if (process.argv.includes('--ignore-first-stop') && stopRequests === 1) {
      console.log('Fake Minecraft server ignored first stop request');
      return;
    }
    console.log('Fake Minecraft server stopping');
    process.exit(0);
  }
});
setInterval(() => {}, 1_000);
