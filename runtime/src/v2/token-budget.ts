import {
  TokenBudget,
  TokenAllocation,
  TokenUsage,
} from "./types.js";

interface InternalAllocation extends TokenAllocation {
  spent: number;
  released: boolean;
}

interface HistoryEntry {
  type: "allocate" | "release" | "spend" | "clear" | "resize";
  timestamp: number;
  allocationId?: string;
  amount?: number;
  label?: string;
  previousTotal?: number;
}

export class DefaultTokenBudget implements TokenBudget {
  private totalBudget: number;
  private allocations: Map<string, InternalAllocation>;
  private history: HistoryEntry[];
  private warningThreshold: number;
  private warningCallbacks: Array<(usage: TokenUsage) => void>;
  private idCounter: number;
  private warningFired: boolean;

  constructor(totalBudget: number) {
    if (totalBudget < 0) {
      throw new Error("Token budget must be non-negative");
    }
    this.totalBudget = totalBudget;
    this.allocations = new Map();
    this.history = [];
    this.warningThreshold = 0.8;
    this.warningCallbacks = [];
    this.idCounter = 0;
    this.warningFired = false;
  }

  allocate(amount: number, label?: string): TokenAllocation {
    if (amount < 0) {
      throw new Error("Allocation amount must be non-negative");
    }
    if (amount === 0) {
      throw new Error("Allocation amount must be positive");
    }
    const currentRemaining = this.remaining();
    if (amount > currentRemaining) {
      throw new Error(
        `Insufficient tokens: requested ${amount}, remaining ${currentRemaining}`
      );
    }
    const id = this.generateId();
    const allocation: InternalAllocation = {
      id,
      amount,
      label,
      allocatedAt: Date.now(),
      spent: 0,
      released: false,
    };
    this.allocations.set(id, allocation);
    this.history.push({
      type: "allocate",
      timestamp: Date.now(),
      allocationId: id,
      amount,
      label,
    });
    this.checkWarning();
    return {
      id: allocation.id,
      amount: allocation.amount,
      label: allocation.label,
      allocatedAt: allocation.allocatedAt,
    };
  }

  spend(allocationId: string, amount: number): void {
    if (amount < 0) {
      throw new Error("Spend amount must be non-negative");
    }
    if (amount === 0) {
      throw new Error("Spend amount must be positive");
    }
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      throw new Error(`Allocation ${allocationId} not found`);
    }
    if (allocation.released) {
      throw new Error(`Allocation ${allocationId} has been released`);
    }
    const available = allocation.amount - allocation.spent;
    if (amount > available) {
      throw new Error(
        `Insufficient allocation tokens: requested ${amount}, available ${available}`
      );
    }
    allocation.spent += amount;
    this.history.push({
      type: "spend",
      timestamp: Date.now(),
      allocationId,
      amount,
    });
    this.checkWarning();
  }

  remaining(): number {
    let totalSpent = 0;
    for (const allocation of this.allocations.values()) {
      if (!allocation.released) {
        totalSpent += allocation.spent;
      }
    }
    return this.totalBudget - totalSpent;
  }

  getUsage(): TokenUsage {
    let totalAllocated = 0;
    let totalSpent = 0;
    const activeAllocations: TokenAllocation[] = [];

    for (const allocation of this.allocations.values()) {
      if (!allocation.released) {
        totalAllocated += allocation.amount;
        totalSpent += allocation.spent;
        activeAllocations.push({
          id: allocation.id,
          amount: allocation.amount,
          label: allocation.label,
          allocatedAt: allocation.allocatedAt,
        });
      }
    }

    return {
      totalAllocated,
      totalSpent,
      totalRemaining: this.totalBudget - totalSpent,
      allocations: activeAllocations,
    };
  }

  release(allocationId: string): void {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      throw new Error(`Allocation ${allocationId} not found`);
    }
    if (allocation.released) {
      throw new Error(`Allocation ${allocationId} is already released`);
    }
    allocation.released = true;
    this.history.push({
      type: "release",
      timestamp: Date.now(),
      allocationId,
      amount: allocation.amount - allocation.spent,
      label: allocation.label,
    });
    this.checkWarning();
  }

  getAllocation(id: string): TokenAllocation | undefined {
    const allocation = this.allocations.get(id);
    if (!allocation || allocation.released) {
      return undefined;
    }
    return {
      id: allocation.id,
      amount: allocation.amount,
      label: allocation.label,
      allocatedAt: allocation.allocatedAt,
    };
  }

  getAllocationsByLabel(label: string): TokenAllocation[] {
    const results: TokenAllocation[] = [];
    for (const allocation of this.allocations.values()) {
      if (!allocation.released && allocation.label === label) {
        results.push({
          id: allocation.id,
          amount: allocation.amount,
          label: allocation.label,
          allocatedAt: allocation.allocatedAt,
        });
      }
    }
    return results;
  }

  clear(): void {
    const previousTotal = this.totalAllocatedTokens();
    this.allocations.clear();
    this.history.push({
      type: "clear",
      timestamp: Date.now(),
      previousTotal,
    });
    this.warningFired = false;
  }

  setBudget(total: number): void {
    if (total < 0) {
      throw new Error("Token budget must be non-negative");
    }
    const previousTotal = this.totalBudget;
    this.totalBudget = total;
    this.history.push({
      type: "resize",
      timestamp: Date.now(),
      previousTotal,
      amount: total,
    });
    this.checkWarning();
  }

  getOverallocated(): boolean {
    return this.totalAllocatedTokens() > this.totalBudget;
  }

  defragment(): TokenAllocation[] {
    const released: TokenAllocation[] = [];
    const labelBuckets = new Map<string, InternalAllocation[]>();
    const noLabelBuckets: InternalAllocation[] = [];

    for (const allocation of this.allocations.values()) {
      if (allocation.released) {
        continue;
      }
      if (allocation.spent > 0) {
        continue;
      }
      const key = allocation.label ?? "";
      if (allocation.label === undefined) {
        noLabelBuckets.push(allocation);
      } else {
        const bucket = labelBuckets.get(key);
        if (bucket) {
          bucket.push(allocation);
        } else {
          labelBuckets.set(key, [allocation]);
        }
      }
    }

    for (const bucket of labelBuckets.values()) {
      if (bucket.length <= 1) {
        continue;
      }
      let mergedAmount = 0;
      const mergedLabel = bucket[0].label;
      const mergedAllocatedAt = bucket[0].allocatedAt;
      const keepId = bucket[0].id;
      const removeIds: string[] = [];

      for (const entry of bucket) {
        mergedAmount += entry.amount;
        removeIds.push(entry.id);
      }

      removeIds.shift();

      for (const id of removeIds) {
        const alloc = this.allocations.get(id);
        if (alloc) {
          alloc.released = true;
          this.history.push({
            type: "release",
            timestamp: Date.now(),
            allocationId: id,
            amount: alloc.amount,
            label: alloc.label,
          });
        }
      }

      const kept = this.allocations.get(keepId);
      if (kept) {
        kept.amount = mergedAmount;
        released.push({
          id: kept.id,
          amount: kept.amount,
          label: kept.label,
          allocatedAt: kept.allocatedAt,
        });
      }
    }

    if (noLabelBuckets.length > 1) {
      let mergedAmount = 0;
      const mergedAllocatedAt = noLabelBuckets[0].allocatedAt;
      const keepId = noLabelBuckets[0].id;
      const removeIds: string[] = [];

      for (const entry of noLabelBuckets) {
        mergedAmount += entry.amount;
        removeIds.push(entry.id);
      }

      removeIds.shift();

      for (const id of removeIds) {
        const alloc = this.allocations.get(id);
        if (alloc) {
          alloc.released = true;
          this.history.push({
            type: "release",
            timestamp: Date.now(),
            allocationId: id,
            amount: alloc.amount,
            label: alloc.label,
          });
        }
      }

      const kept = this.allocations.get(keepId);
      if (kept) {
        kept.amount = mergedAmount;
        released.push({
          id: kept.id,
          amount: kept.amount,
          label: kept.label,
          allocatedAt: kept.allocatedAt,
        });
      }
    }

    this.checkWarning();
    return released;
  }

  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  setWarningThreshold(ratio: number): void {
    if (ratio < 0 || ratio > 1) {
      throw new Error("Warning threshold must be between 0 and 1");
    }
    this.warningThreshold = ratio;
    this.warningFired = false;
    this.checkWarning();
  }

  onWarning(callback: (usage: TokenUsage) => void): () => void {
    this.warningCallbacks.push(callback);
    return () => {
      const idx = this.warningCallbacks.indexOf(callback);
      if (idx !== -1) {
        this.warningCallbacks.splice(idx, 1);
      }
    };
  }

  private generateId(): string {
    this.idCounter += 1;
    const timestamp = Date.now().toString(36);
    const counter = this.idCounter.toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `tok_${timestamp}_${counter}_${random}`;
  }

  private totalAllocatedTokens(): number {
    let total = 0;
    for (const allocation of this.allocations.values()) {
      if (!allocation.released) {
        total += allocation.amount;
      }
    }
    return total;
  }

  private totalSpentTokens(): number {
    let total = 0;
    for (const allocation of this.allocations.values()) {
      if (!allocation.released) {
        total += allocation.spent;
      }
    }
    return total;
  }

  private checkWarning(): void {
    if (this.warningCallbacks.length === 0) {
      return;
    }
    const usage = this.getUsage();
    if (this.totalBudget === 0) {
      return;
    }
    const usageRatio = usage.totalSpent / this.totalBudget;
    if (usageRatio >= this.warningThreshold) {
      if (!this.warningFired) {
        this.warningFired = true;
        for (const cb of this.warningCallbacks) {
          cb(usage);
        }
      }
    } else {
      this.warningFired = false;
    }
  }
}
