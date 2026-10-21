import { uuid, now, stateOf } from "./schema.js";
import { assert, safeAdd } from "./validation.js";
import { isChild } from "./share-state.js";
import { poolBalance } from "./budget.js";
import { today } from "./domain.js";
export function goalAt(s, periodId) {
  const p = s.periods.find((p) => p.id === periodId);
  if (!p) return null;
  const starts = new Map(s.periods.map((p) => [p.id, p.startDate]));
  return (
    s.goalHistory
      .filter((g) => starts.get(g.effectivePeriodId) <= p.startDate)
      .sort(
        (a, b) =>
          starts
            .get(a.effectivePeriodId)
            .localeCompare(starts.get(b.effectivePeriodId)) ||
          a.sequence - b.sequence,
      )
      .at(-1) || null
  );
}
export function goalFigures(s, periodId, balance = poolBalance(s)) {
  const goal = goalAt(s, periodId);
  if (!goal || goal.targetAmount === null)
    return { goal, target: null, rate: null, shortfall: null };
  return {
    goal,
    target: goal.targetAmount,
    rate: (balance / goal.targetAmount) * 100,
    // Derived only: BigInt keeps a large target minus a negative balance exact.
    shortfall:
      BigInt(goal.targetAmount) > BigInt(balance)
        ? BigInt(goal.targetAmount) - BigInt(balance)
        : 0n,
  };
}
export function pendingGoal(s, date = today()) {
  if (isChild(s)) return null;
  const p = s.periods.find((p) => p.startDate <= date && date <= p.endDate);
  const g = p && goalAt(s, p.id);
  return g &&
    g.targetAmount !== null &&
    poolBalance(s) >= g.targetAmount &&
    !s.goalNotifications.some((n) => n.goalRevisionId === g.id)
    ? { goal: g, period: p }
    : null;
}
export function recordGoalAchievement(s) {
  const hit = pendingGoal(s);
  if (hit)
    s.goalNotifications.push({
      goalRevisionId: hit.goal.id,
      periodId: hit.period.id,
      firstReachedAt: now(),
    });
}
export class Goals {
  constructor(db) {
    this.db = db;
  }
  set(periodId, targetAmount, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "set-goal",
      { periodId, targetAmount },
      (s) => {
        assert(
          s.periods.some((p) => p.id === periodId),
          "目標の適用開始期間を選んでください",
        );
        assert(
          targetAmount === null ||
            (Number.isSafeInteger(targetAmount) && targetAmount >= 1),
          "目標は1円以上の安全な整数で入力してください。解除は別のボタンを使用してください",
        );
        const id = uuid(),
          sequence = s.goalHistory.reduce((n, g) => Math.max(n, g.sequence), 0);
        s.goalHistory.push({
          id,
          effectivePeriodId: periodId,
          targetAmount,
          sequence: safeAdd(sequence, 1),
          createdAt: now(),
        });
        return [id];
      },
      { expectedRevision, operationId },
    );
  }
  async check() {
    const s = await this.db.snapshot();
    if (!pendingGoal(s)) return false;
    await this.db.command("check-goal", {}, () => [], {
      expectedRevision: stateOf(s).datasetRevision,
    });
    return true;
  }
}
