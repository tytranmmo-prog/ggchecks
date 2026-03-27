const { Server } = require('proxy-chain');

const localPort = parseInt(process.argv[2], 10);
const upstreamHost = process.env.OXYLABS_PROXY_HOST || 'isp.oxylabs.io';
const upstreamPort = parseInt(process.argv[3], 10);
const upstreamUser = process.env.OXYLABS_PROXY_USER || 'proxyvip_VV7Fk';
const upstreamPass = process.env.OXYLABS_PROXY_PASS || 'Lungtung1_23';

if (!localPort || !upstreamPort) {
  console.error("Usage: bun src/lib/run-proxy.ts <localPort> <upstreamPort>");
  process.exit(1);
}

const server = new Server({
  // Listen strictly on localhost
  port: localPort,
  host: '127.0.0.1',
  prepareRequestFunction: () => {
    return {
      requestAuthentication: false,
      upstreamProxyUrl: `http://${upstreamUser}:${upstreamPass}@${upstreamHost}:${upstreamPort}`,
    };
  },
});

server.listen(() => {
  console.log(`Proxy running on 127.0.0.1:${localPort} forwarding to ${upstreamHost}:${upstreamPort}`);
});

process.on('SIGINT', () => server.close(true));
process.on('SIGTERM', () => server.close(true));
