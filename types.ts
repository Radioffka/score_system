// types.ts

// Defines the possible states the application can be in.
export type AppState = 'initializing' | 'setup' | 'loading' | 'ready' | 'error';

// Defines the structure of the Home Assistant connection object.
export interface Hass {
  callService: (domain: string, service: string, serviceData?: object) => Promise<any>;
  states: { [entity_id: string]: HassEntity };
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: { [key: string]: any };
  last_changed: string;
  last_updated: string;
  context: {
    id: string;
    parent_id: string | null;
    user_id: string | null;
  };
}

// Data structures for the application
export interface Reward {
  id: string;
  name: string;
  threshold: number;
  value?: string;
  unit?: string;
  period?: string;
}

export interface Reason {
  id: string;
  name: string;
  value: number;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  description: string;
  change: number;
  newTotal: number;
}