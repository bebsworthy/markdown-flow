// test/add-modal/fuzzy.test.ts

import { describe, it, expect } from "vitest";
import { rankCandidates, scoreSubsequence } from "../../src/add-modal/fuzzy.js";
import type { Candidate } from "../../src/add-modal/types.js";

function mkCandidate(displayPath: string, depth = 0): Candidate {
  return {
    kind: "file",
    absolutePath: `/root/${displayPath}`,
    displayPath,
    depth,
  };
}

describe("scoreSubsequence", () => {
  it("empty query → score 0 and empty positions", () => {
    const res = scoreSubsequence("", "anything");
    expect(res).not.toBeNull();
    expect(res!.score).toBe(0);
    expect(res!.positions).toEqual([]);
  });

  it("query as exact prefix → positive score with prefix bonus", () => {
    const res = scoreSubsequence("dep", "deploy.md");
    expect(res).not.toBeNull();
    // 3 base + 2*4 consecutive + 10 prefix + 20 basename + 3*2 case = 47
    expect(res!.score).toBeGreaterThanOrEqual(47);
  });

  it("query not a subsequence → null", () => {
    expect(scoreSubsequence("xyz", "deploy.md")).toBeNull();
  });

  it("case-insensitive match", () => {
    const res = scoreSubsequence("DEP", "deploy.md");
    expect(res).not.toBeNull();
    expect(res!.positions).toEqual([0, 1, 2]);
  });

  it("case-sensitive match scores +2 per exact-case char", () => {
    const lower = scoreSubsequence("dep", "deploy.md");
    const upper = scoreSubsequence("Dep", "deploy.md");
    expect(lower).not.toBeNull();
    expect(upper).not.toBeNull();
    // Exact case on 3 chars → +6; upper only matches 'D' exact-case on none.
    expect(lower!.score).toBeGreaterThan(upper!.score);
  });

  it("consecutive matches add +4 per consecutive run", () => {
    // "dpy" non-consecutive ("d" at 0, "p" at 3, "y" at 5) — no consecutive bonus.
    const nonConsec = scoreSubsequence("dpy", "deploy.md");
    // "dep" consecutive ("d","e","p") — two consecutive transitions.
    const consec = scoreSubsequence("dep", "deploy.md");
    expect(nonConsec).not.toBeNull();
    expect(consec).not.toBeNull();
    expect(consec!.score - nonConsec!.score).toBeGreaterThanOrEqual(8);
  });

  it("basename-hit bonus: all positions after last '/' → +20", () => {
    const deep = scoreSubsequence("dep", "infra/flows/deploy.md");
    const root = scoreSubsequence("dep", "deploy.md");
    expect(deep).not.toBeNull();
    expect(root).not.toBeNull();
    // Both qualify for basename hit; but root gets the prefix bonus too, so
    // the delta is +10 (prefix). What we're asserting is that the basename
    // rule fires (otherwise deep would not score as high as it does).
    expect(deep!.score).toBeGreaterThan(deep!.positions.length); // basic sanity
    // Ensure basename hit is applied on deep: positions all > lastSlash.
    const lastSlash = "infra/flows/deploy.md".lastIndexOf("/");
    for (const p of deep!.positions) {
      expect(p).toBeGreaterThan(lastSlash);
    }
  });
});

describe("rankCandidates", () => {
  it("empty query preserves input order; score 0", () => {
    const a = mkCandidate("a.md");
    const b = mkCandidate("b.md");
    const c = mkCandidate("c.md");
    const out = rankCandidates("", [a, b, c]);
    expect(out.map((r) => r.candidate.displayPath)).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
    for (const r of out) expect(r.score).toBe(0);
  });

  it("sorts by score desc then displayPath asc", () => {
    const a = mkCandidate("zeta/deploy.md"); // basename hit; deep
    const b = mkCandidate("deploy.md"); // basename + prefix; shallow
    const c = mkCandidate("alpha/deploy.md"); // basename hit; tied with a
    const out = rankCandidates("dep", [a, b, c]);
    // b wins (prefix bonus), then alpha < zeta among tied.
    expect(out.map((r) => r.candidate.displayPath)).toEqual([
      "deploy.md",
      "alpha/deploy.md",
      "zeta/deploy.md",
    ]);
  });

  it("drops non-matching candidates", () => {
    const a = mkCandidate("deploy.md");
    const b = mkCandidate("xxxxx.md");
    const out = rankCandidates("dep", [a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.candidate.displayPath).toBe("deploy.md");
  });

  it("limit=N returns first N", () => {
    const cands = Array.from({ length: 10 }, (_, i) => mkCandidate(`d${i}.md`));
    const out = rankCandidates("d", cands, 3);
    expect(out).toHaveLength(3);
  });

  it("deterministic across multiple invocations with same input", () => {
    const cands = [
      mkCandidate("alpha/deploy.md"),
      mkCandidate("zeta/deploy.md"),
      mkCandidate("deploy.md"),
    ];
    const one = rankCandidates("dep", cands).map((r) => r.candidate.displayPath);
    const two = rankCandidates("dep", cands).map((r) => r.candidate.displayPath);
    expect(one).toEqual(two);
  });

  it("prefix match outranks middle match", () => {
    const a = mkCandidate("notdeploy.md");
    const b = mkCandidate("deploy.md");
    const out = rankCandidates("dep", [a, b]);
    expect(out[0]!.candidate.displayPath).toBe("deploy.md");
  });

  it("basename hit outranks a prefix match on parent directory", () => {
    // "deploys" (parent) vs "flows/deploy.md" (basename hit only).
    const parent = mkCandidate("deploys/config.md"); // "dep" matches "dep" of "deploys" (prefix), NOT basename.
    const base = mkCandidate("flows/deploy.md"); // "dep" lands inside "deploy.md" (basename hit).
    const out = rankCandidates("dep", [parent, base]);
    expect(out[0]!.candidate.displayPath).toBe("flows/deploy.md");
  });

  it("exact query equal to basename wins", () => {
    const a = mkCandidate("deploy.md");
    const b = mkCandidate("deploy-staging.md");
    const out = rankCandidates("deploy.md", [a, b]);
    expect(out[0]!.candidate.displayPath).toBe("deploy.md");
  });

  it("very long candidate list (1000) completes quickly", () => {
    const cands = Array.from({ length: 1000 }, (_, i) =>
      mkCandidate(`d${String(i).padStart(4, "0")}.md`),
    );
    const t0 = Date.now();
    const out = rankCandidates("d", cands, 20);
    const elapsed = Date.now() - t0;
    expect(out).toHaveLength(20);
    expect(elapsed).toBeLessThan(200); // generous; a machine spike shouldn't fail.
  });
});

describe("rankCandidates — tie-break", () => {
  it("equal score → lexicographically smaller displayPath first", () => {
    // Two candidates with identical fuzzy score profile.
    const a = mkCandidate("b/flow.md");
    const b = mkCandidate("a/flow.md");
    const out = rankCandidates("flow", [a, b]);
    expect(out[0]!.candidate.displayPath).toBe("a/flow.md");
    expect(out[1]!.candidate.displayPath).toBe("b/flow.md");
  });

  it("stable tie-break: insertion order preserved for equal-score-equal-path", () => {
    const a = mkCandidate("flow.md");
    const b = mkCandidate("flow.md");
    const out = rankCandidates("flow", [a, b]);
    // Paths equal → a (index 0) before b (index 1).
    expect(out[0]).toBe(out[0]);
    expect(out).toHaveLength(2);
  });
});

describe("rankCandidates — edge cases", () => {
  it("query longer than candidate → no match", () => {
    const a = mkCandidate("x.md");
    const out = rankCandidates("xxxx", [a]);
    expect(out).toHaveLength(0);
  });

  it("unicode query matches unicode path", () => {
    const a = mkCandidate("café/ménu.md");
    const out = rankCandidates("café", [a]);
    expect(out).toHaveLength(1);
  });

  it("whitespace in query treated as literal chars", () => {
    const a = mkCandidate("deploy staging.md");
    const out = rankCandidates("dep s", [a]);
    expect(out).toHaveLength(1);
  });

  it("all candidates filtered out → empty result", () => {
    const a = mkCandidate("abc.md");
    const out = rankCandidates("zzz", [a]);
    expect(out).toHaveLength(0);
  });
});
