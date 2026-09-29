import "server-only";

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [network, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, bits, "ipv4");
for (const [network, bits] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16]] as const) blocked.addSubnet(network, bits, "ipv6");

export function globallyRoutable(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, "ipv6");
}

async function publicDns(hostname: string) {
  const answers = await Promise.all(["A", "AAAA"].map(async (type) => {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", hostname); url.searchParams.set("type", type);
    const response = await fetch(url, { headers: { Accept: "application/dns-json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Public DNS lookup failed.");
    const data = await response.json() as { Status?: number; Answer?: { type?: number; data?: string }[] };
    if (data.Status !== 0 && data.Status !== 3) throw new Error("Public DNS lookup failed.");
    return (data.Answer || []).filter((answer) => answer.type === (type === "A" ? 1 : 28) && typeof answer.data === "string").map((answer) => answer.data!);
  }));
  return answers.flat();
}

export async function publicAddress(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) {
    if (!globallyRoutable(host)) throw new Error("Private network addresses are not allowed.");
    return host;
  }
  if (!/^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host) || host.endsWith(".local")) throw new Error("Invalid public hostname.");
  let addresses = (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
  const fake = new BlockList(); fake.addSubnet("198.18.0.0", 15, "ipv4");
  if (addresses.length && addresses.every((address) => isIP(address) === 4 && fake.check(address, "ipv4"))) addresses = await publicDns(host);
  if (!addresses.length || addresses.some((address) => !globallyRoutable(address))) throw new Error("The hostname does not resolve only to public addresses.");
  return addresses[0];
}
