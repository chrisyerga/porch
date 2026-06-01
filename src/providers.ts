import type { HostConfig, ProviderConfig, ServiceConfig } from "./schemas.js";

export type DnsChange = {
  domain: string;
  record: string;
  type: "A";
  value: string;
  action: "create" | "update" | "unchanged" | "delete";
};

export interface DnsProvider {
  planServiceRecords(service: ServiceConfig, host: HostConfig): Promise<DnsChange[]>;
  applyServiceRecords(service: ServiceConfig, host: HostConfig): Promise<DnsChange[]>;
  deleteServiceRecords(service: ServiceConfig, host: HostConfig): Promise<DnsChange[]>;
}

export function createDnsProvider(config: ProviderConfig | undefined): DnsProvider | undefined {
  if (!config) return undefined;
  if (config.type === "digitalocean") return new DigitalOceanDnsProvider(config);
}

type DigitalOceanDomain = { name: string };
type DigitalOceanRecord = {
  id: number;
  type: string;
  name: string;
  data: string;
  ttl: number;
};

class DigitalOceanDnsProvider implements DnsProvider {
  constructor(private readonly config: Extract<ProviderConfig, { type: "digitalocean" }>) {}

  async planServiceRecords(service: ServiceConfig, host: HostConfig): Promise<DnsChange[]> {
    return this.describeChanges(service, host, false);
  }

  async applyServiceRecords(service: ServiceConfig, host: HostConfig): Promise<DnsChange[]> {
    return this.describeChanges(service, host, true);
  }

  async deleteServiceRecords(service: ServiceConfig, host: HostConfig): Promise<DnsChange[]> {
    const hostIp = requireHostIp(host);
    const zones = await this.listDomains();
    const changes: DnsChange[] = [];

    for (const hostname of service.domains) {
      const target = resolveZone(hostname, zones);
      const existing = await this.findARecord(target.zone, target.record);
      if (!existing) {
        changes.push({ domain: target.zone, record: target.record, type: "A", value: hostIp, action: "unchanged" });
        continue;
      }
      await this.request(`/v2/domains/${target.zone}/records/${existing.id}`, { method: "DELETE" });
      changes.push({ domain: target.zone, record: target.record, type: "A", value: existing.data, action: "delete" });
    }

    return changes;
  }

  private async describeChanges(
    service: ServiceConfig,
    host: HostConfig,
    apply: boolean,
  ): Promise<DnsChange[]> {
    const hostIp = requireHostIp(host);
    const zones = await this.listDomains();
    const changes: DnsChange[] = [];

    for (const hostname of service.domains) {
      const target = resolveZone(hostname, zones);
      const existing = await this.findARecord(target.zone, target.record);
      if (!existing) {
        if (apply) {
          await this.request(`/v2/domains/${target.zone}/records`, {
            method: "POST",
            body: JSON.stringify({
              type: "A",
              name: target.record,
              data: hostIp,
              ttl: this.config.ttl,
            }),
          });
        }
        changes.push({ domain: target.zone, record: target.record, type: "A", value: hostIp, action: "create" });
        continue;
      }

      if (existing.data === hostIp) {
        changes.push({ domain: target.zone, record: target.record, type: "A", value: hostIp, action: "unchanged" });
        continue;
      }

      if (apply) {
        await this.request(`/v2/domains/${target.zone}/records/${existing.id}`, {
          method: "PUT",
          body: JSON.stringify({
            type: "A",
            name: target.record,
            data: hostIp,
            ttl: this.config.ttl,
          }),
        });
      }
      changes.push({ domain: target.zone, record: target.record, type: "A", value: hostIp, action: "update" });
    }

    return changes;
  }

  private async listDomains(): Promise<DigitalOceanDomain[]> {
    const response = await this.request<{ domains: DigitalOceanDomain[] }>("/v2/domains");
    return response.domains;
  }

  private async findARecord(domain: string, name: string): Promise<DigitalOceanRecord | undefined> {
    const response = await this.request<{ domain_records: DigitalOceanRecord[] }>(
      `/v2/domains/${domain}/records?type=A&name=${encodeURIComponent(name)}`,
    );
    return response.domain_records.find((record) => record.type === "A" && record.name === name);
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const token = process.env[this.config.tokenEnv];
    if (!token) throw new Error(`Missing DigitalOcean token in ${this.config.tokenEnv}`);

    const response = await fetch(`https://api.digitalocean.com${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`DigitalOcean API ${response.status}: ${body}`);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

function requireHostIp(host: HostConfig): string {
  if (!host.hostIp) throw new Error("hostIp is required for DNS changes");
  return host.hostIp;
}

function resolveZone(hostname: string, zones: DigitalOceanDomain[]): { zone: string; record: string } {
  const zone = zones
    .map((domain) => domain.name)
    .filter((name) => hostname === name || hostname.endsWith(`.${name}`))
    .sort((a, b) => b.length - a.length)[0];

  if (!zone) throw new Error(`No DigitalOcean domain zone found for ${hostname}`);
  if (hostname === zone) return { zone, record: "@" };
  return { zone, record: hostname.slice(0, -(zone.length + 1)) };
}
