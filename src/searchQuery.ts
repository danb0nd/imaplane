import type { SearchObject } from "imapflow";
import type { SearchOpts } from "./types.js";

export function buildSearchQuery(opts: SearchOpts): SearchObject {
  const query: SearchObject = {};

  if (opts.unseen) query.seen = false;
  if (opts.from?.trim()) query.from = opts.from.trim();
  if (opts.subject?.trim()) query.subject = opts.subject.trim();

  const q = opts.q?.trim();
  if (q) {
    const lowered = q.toLowerCase();
    if (lowered === "unseen" || lowered === "is:unseen") {
      query.seen = false;
    } else if (lowered.startsWith("from:")) {
      query.from = q.slice(5).trim();
    } else if (lowered.startsWith("subject:")) {
      query.subject = q.slice(8).trim();
    } else {
      query.or = [{ subject: q }, { from: q }, { body: q }];
    }
  }

  if (Object.keys(query).length === 0) {
    return { all: true };
  }
  return query;
}
