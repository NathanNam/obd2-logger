import type { Profile } from "../profiles/types";
import type { Elm327 } from "./elm327";
import { buildCommand, decodePidResponse } from "./pid-codec";

export type ProbeResult = {
  supportedIds: string[];
  failures: { id: string; reason: string }[];
};

export async function probeProfilePids(
  elm: Elm327,
  profile: Profile,
): Promise<ProbeResult> {
  const supportedIds: string[] = [];
  const failures: { id: string; reason: string }[] = [];

  const byEcu = new Map<string, typeof profile.pids>();
  for (const pid of profile.pids) {
    const list = byEcu.get(pid.ecu) ?? [];
    list.push(pid);
    byEcu.set(pid.ecu, list);
  }

  for (const [ecuName, pids] of byEcu) {
    const ecu = profile.ecus[ecuName];
    if (!ecu) {
      for (const p of pids) failures.push({ id: p.id, reason: `ECU '${ecuName}' not in profile` });
      continue;
    }
    await elm.send(`ATSH${ecu.request_header}`).catch(() => null);
    for (const def of pids) {
      const cmd = buildCommand(def);
      const resp = await elm.send(cmd, { timeoutMs: 1500 });
      if (resp.errors.length) {
        failures.push({ id: def.id, reason: resp.errors.join(",") });
        continue;
      }
      const outcome = decodePidResponse(def, resp.lines);
      if (outcome.ok) {
        supportedIds.push(def.id);
      } else {
        failures.push({ id: def.id, reason: outcome.reason });
      }
    }
  }

  await elm.send("ATSH7E0").catch(() => null);
  return { supportedIds, failures };
}
