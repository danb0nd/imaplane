import type { MailBackend, MessageHeader, RuleApplyResult, RuleDef, RuleHit, RuleMatch } from "./types.js";

export function headerMatches(header: MessageHeader, match: RuleMatch): boolean {
  if (match.unseen && !header.unseen) return false;
  if (match.from) {
    const needle = match.from.replace(/^from:/i, "").trim().toLowerCase();
    const ok = header.from.some((addr) => {
      const email = (addr.address ?? "").toLowerCase();
      const name = (addr.name ?? "").toLowerCase();
      if (!needle) return false;
      if (needle.startsWith("@")) return email.endsWith(needle) || email.split("@")[1] === needle.slice(1);
      if (needle.includes("@")) return email === needle || email.includes(needle);
      return email === needle || email.endsWith(`@${needle}`) || email.includes(needle) || name.includes(needle);
    });
    if (!ok) return false;
  }
  if (match.subject) {
    const needle = match.subject.replace(/^subject:/i, "").trim().toLowerCase();
    if (!(header.subject ?? "").toLowerCase().includes(needle)) return false;
  }
  if (match.q) {
    const q = match.q.trim().toLowerCase();
    if (q === "unseen" || q === "is:unseen") {
      if (!header.unseen) return false;
    } else {
      const blob = `${header.subject ?? ""} ${header.from.map((a) => a.address ?? "").join(" ")}`.toLowerCase();
      if (!blob.includes(q.replace(/^(from|subject):/i, "").trim())) return false;
    }
  }
  return true;
}

export async function applyRules(
  backend: MailBackend,
  rules: RuleDef[],
  opts: { dryRun: boolean; account?: string; defaultAccount: string },
): Promise<RuleApplyResult> {
  const hits: RuleHit[] = [];
  let scanned = 0;
  const enabled = rules.filter((r) => r.enabled);
  for (const rule of enabled) {
    const account = opts.account || rule.account || opts.defaultAccount;
    const messages = await backend.search({
      folder: rule.folder,
      limit: rule.limit,
      from: rule.match.from,
      subject: rule.match.subject,
      q: rule.match.q,
      unseen: rule.match.unseen,
      account,
    });
    scanned += messages.length;
    for (const header of messages) {
      if (!headerMatches(header, rule.match)) continue;
      const hit: RuleHit = {
        rule: rule.name,
        account,
        uid: header.uid,
        folder: header.folder,
        from: header.from[0]?.address ?? null,
        subject: header.subject,
        actions: rule.actions,
      };
      if (!opts.dryRun) {
        try {
          if (rule.actions.move && rule.actions.move !== header.folder) {
            await backend.move(header.uid, header.folder, rule.actions.move, account);
          }
          const add = rule.actions.add_flags ?? [];
          const remove = rule.actions.remove_flags ?? [];
          if (add.length || remove.length) {
            await backend.setFlags(header.uid, {
              folder: rule.actions.move || header.folder,
              add,
              remove,
              account,
            });
          }
        } catch (err) {
          hit.error = err instanceof Error ? err.message : String(err);
        }
      }
      hits.push(hit);
    }
  }
  return { dry_run: opts.dryRun, hits, scanned };
}
