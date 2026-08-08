import assert from "node:assert/strict";
import test from "node:test";
import { NETWORK_BOUNDARY, classifyBindAddress, validateBindAddress } from "../src/index.js";

/**
 * Away-from-home readiness. Every address below is a documented range rather than this machine's,
 * and nothing here opens a socket, installs anything, or reads a network configuration.
 */

test("an overlay address is recognised as reaching beyond this building", () => {
  const tailnet = classifyBindAddress("100.101.102.103");
  assert.equal(tailnet.scope, "overlay");
  assert.equal(tailnet.worksAwayFromHome, true);
  assert.match(tailnet.likelyProvider, /Tailscale/u);
  assert.match(tailnet.detail, /AION did not create it, does not manage it, and will not sign in to it/u);
  assert.match(tailnet.detail, /a paired session is still required/u);

  const wireguard = classifyBindAddress("fd7a:115c:a1e0::1");
  assert.equal(wireguard.scope, "overlay");
  assert.equal(wireguard.worksAwayFromHome, true);
  assert.match(wireguard.likelyProvider, /WireGuard/u);
});

test("an ordinary home address is not pretended to reach further than it does", () => {
  for (const address of ["192.168.1.223", "10.0.0.5", "172.20.4.9"]) {
    const classified = classifyBindAddress(address);
    assert.equal(classified.scope, "local-network", `${address} is a local network address`);
    assert.equal(classified.worksAwayFromHome, false);
    assert.match(classified.detail, /will not open a router port or create a public tunnel/u);
  }
});

test("loopback and link-local are described for what they are", () => {
  const loopback = classifyBindAddress("127.0.0.1");
  assert.equal(loopback.scope, "loopback");
  assert.equal(loopback.worksAwayFromHome, false);
  assert.match(loopback.detail, /Only this computer can reach AION/u);

  for (const address of ["169.254.10.20", "fe80::1"]) {
    const classified = classifyBindAddress(address);
    assert.equal(classified.scope, "link-local");
    assert.equal(classified.worksAwayFromHome, false);
    assert.match(classified.detail, /will usually stop working without warning/u);
  }
});

test("classification refuses exactly what binding refuses, and for the same reasons", () => {
  for (const address of ["0.0.0.0", "::", "*", "::0"]) {
    assert.throws(() => classifyBindAddress(address), /never binds a wildcard/iu, `${address} is a wildcard`);
  }
  for (const address of ["8.8.8.8", "203.0.113.4", "2001:db8::1"]) {
    assert.throws(() => classifyBindAddress(address), /loopback or private-network/iu, `${address} is public`);
    assert.throws(() => validateBindAddress(address), /loopback or private-network/iu);
  }
  assert.throws(() => classifyBindAddress(""), /required/iu);
});

test("the network boundary is stated once, as refusals rather than missing features", () => {
  for (const phrase of ["install or configure", "sign in to an overlay", "open a port on your router", "create a public tunnel", "bind a wildcard address", "treat being on the network as authentication"]) {
    assert.ok(NETWORK_BOUNDARY.willNot.some((entry) => entry.includes(phrase)), `the boundary refuses to ${phrase}`);
  }
  assert.ok(NETWORK_BOUNDARY.will.includes("bind loopback always"));
  assert.ok(NETWORK_BOUNDARY.will.some((entry) => entry.includes("one exact private address you name")));
  assert.match(NETWORK_BOUNDARY.statement, /Reaching AION over any network is not authentication/u);
});

test("every address AION will bind classifies, and nothing it refuses does", () => {
  // The two functions must agree exactly: an address that binds but cannot be described would
  // leave the owner with a working listener and no idea what kind of network it is on.
  const accepted = ["127.0.0.1", "::1", "192.168.0.2", "10.1.2.3", "172.16.0.1", "100.64.0.1", "169.254.1.1", "fd00::1", "fe80::abcd"];
  for (const address of accepted) {
    assert.equal(validateBindAddress(address), address);
    assert.equal(classifyBindAddress(address).address, address, `${address} classifies`);
  }
  const refused = ["0.0.0.0", "::", "1.2.3.4", "172.32.0.1", "100.128.0.1", "not-an-address"];
  for (const address of refused) {
    assert.throws(() => validateBindAddress(address), /wildcard|loopback or private-network/iu, `${address} is refused`);
    assert.throws(() => classifyBindAddress(address), /wildcard|loopback or private-network/iu, `${address} is refused by both`);
  }
});
