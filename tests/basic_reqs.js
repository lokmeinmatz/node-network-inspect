const netInspect = require('node-network-inspect');

const session = netInspect.start({
  logger: {
    debug: () => {},
    log: console.log,
    warn: console.warn,
    error: console.error,
  },
  //emitModes: [netInspect.EmitMode.LogFull]
  emitModes: [netInspect.EmitMode.LogSummary]
});


async function main() {
  // make http request to google.com
  const http = require('http');
  console.log('http request to google.com');
  await new Promise((resolve, reject) => {
    http.get('http://google.com', (res) => {
      console.log('statusCode:', res.statusCode);
      res.on('data', (d) => {
        console.log('data len', d.length);
      });
      resolve();
    }).on('error', (e) => {
      console.error(e);
      reject(e);
    });
  });
  // make https request to google.com
  const https = require('https');
  console.log('https request to google.com');
  await new Promise((resolve, reject) => {
    https.get('https://google.com', (res) => {
      console.log('statusCode:', res.statusCode);
      res.on('data', (d) => {
        console.log('data len', d.length);
      });
      resolve();
    }).on('error', (e) => {
      console.error(e);
      reject(e);
    });
  });

  // make fetch request to google.com
  console.log('fetch request to google.com');
  const res = await fetch('https://google.com');
  console.log('res:', res.status, res.statusText);
  const text = await res.text();

  session.stop();
}

main();