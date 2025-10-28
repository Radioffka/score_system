
export interface Reward {
  id: string;
  name: string;
  threshold: number;
}

export interface Reason {
  id: string;
  name: string;
  value: number;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  description: string;
  change: number;
}
