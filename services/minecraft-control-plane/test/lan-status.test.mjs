import assert from 'node:assert/strict';
import test from 'node:test';
import { getLanStatus, inspectOwnerWithNetstat, privateLanAddresses } from '../src/lan-status.mjs';

test('keeps only RFC1918 addresses from physical-looking interfaces', () => {
  assert.deepEqual(privateLanAddresses({
    Ethernet: [
      { family: 'IPv4', internal: false, address: '192.168.1.25' },
      { family: 'IPv4', internal: false, address: '8.8.8.8' },
    ],
    'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.20.0.1' }],
    Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
  }), ['192.168.1.25']);
});

test('combines injected port and Windows inspection without exposing paths', async () => {
  let inspectedJavaPorts;
  const lan = await getLanStatus({
    javaPorts: [25567, 0, 25565, 25567],
    networkInterfaces: { Ethernet: [{ family: 'IPv4', internal: false, address: '10.10.10.39' }] },
    probe: async () => 'occupied',
    inspectWindows: async (javaPorts) => {
      inspectedJavaPorts = javaPorts;
      return {
        endpointKnown: true, occupied: true, pid: 19656, processName: 'bedrock_server',
        firewallKnown: true, firewallRulesPresent: false, localSubnetOnly: false,
        executablePath: 'C:\\private\\bedrock_server.exe',
      };
    },
  });
  assert.deepEqual(inspectedJavaPorts, [25565, 25567]);
  assert.equal(lan.portStatus, 'occupied');
  assert.deepEqual(lan.owner, { pid: 19656, processName: 'bedrock_server' });
  assert.equal(lan.firewallRulesPresent, false);
  assert.equal(lan.localSubnetOnly, false);
  assert.equal(JSON.stringify(lan).includes('private'), false);
});

test('reports firewall scope as unknown when Windows inspection cannot validate it', async () => {
  const lan = await getLanStatus({
    javaPort: 25565,
    networkInterfaces: {},
    probe: async () => 'available',
    inspectWindows: async () => ({
      endpointKnown: true, occupied: false, firewallKnown: false,
      firewallRulesPresent: true, localSubnetOnly: true,
    }),
  });
  assert.equal(lan.firewallRulesPresent, null);
  assert.equal(lan.localSubnetOnly, null);
});

test('the fixed netstat inspector identifies the live UDP 19132 owner without caller input', async () => {
  if (process.platform !== 'win32') return;
  const owner = await inspectOwnerWithNetstat();
  if (owner == null) return;
  assert.equal(Number.isInteger(owner.pid) && owner.pid > 0, true);
  assert.equal(owner.processName == null || typeof owner.processName === 'string', true);
});
