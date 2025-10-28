
import React, { useCallback } from 'react';
import useLocalStorage from './hooks/useLocalStorage';
import { Reward, Reason, HistoryEntry } from './types';
import Dashboard from './components/Dashboard';
import PointsControl from './components/PointsControl';
import Management from './components/Management';

const initialRewards: Reward[] = [
    {id: crypto.randomUUID(), name: "Televize :: 1 film", threshold: 20},
    {id: crypto.randomUUID(), name: "iPad :: 2 hodiny týdně", threshold: 60},
    {id: crypto.randomUUID(), name: "iPad :: 5 hodin týdně", threshold: 150},
    {id: crypto.randomUUID(), name: "iPhone :: 2 hodiny týdně", threshold: 100},
    {id: crypto.randomUUID(), name: "iPhone :: 5 hodin týdně", threshold: 120},
    {id: crypto.randomUUID(), name: "iPhone :: 12 hodin týdně", threshold: 500},
    {id: crypto.randomUUID(), name: "Televize dle pravidel!", threshold: 150}
];

const initialReasons: Reason[] = [
    {id: crypto.randomUUID(), name: "Kázeňský postih", value: -100},
    {id: crypto.randomUUID(), name: "Poznámka", value: -50},
    {id: crypto.randomUUID(), name: "Jednička", value: 10},
    {id: crypto.randomUUID(), name: "Dvojka", value: 5},
    {id: crypto.randomUUID(), name: "Trojka", value: -5},
    {id: crypto.randomUUID(), name: "Čtyřka", value: -10},
    {id: crypto.randomUUID(), name: "Pětka", value: -20},
    {id: crypto.randomUUID(), name: "Sprosté slovo", value: -30},
    {id: crypto.randomUUID(), name: "Nesplněný úkol", value: -15},
    {id: crypto.randomUUID(), name: "Pomoc rodičům", value: 10}
];


function App() {
  const [points, setPoints] = useLocalStorage<number>('bodik-points', 0);
  const [rewards, setRewards] = useLocalStorage<Reward[]>('bodik-rewards', initialRewards);
  const [reasons, setReasons] = useLocalStorage<Reason[]>('bodik-reasons', initialReasons);
  const [history, setHistory] = useLocalStorage<HistoryEntry[]>('bodik-history', []);

  const addHistoryEntry = useCallback((description: string, change: number) => {
    if (change === 0) return;
    const newEntry: HistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      description,
      change,
    };
    setHistory(prev => [newEntry, ...prev].slice(0, 50));
  }, [setHistory]);

  const handlePointsChange = useCallback((change: number, description: string) => {
    setPoints(prev => prev + change);
    addHistoryEntry(description, change);
  }, [setPoints, addHistoryEntry]);

  const handleSetPoints = useCallback((value: number, description: string) => {
    const change = value - points;
    setPoints(value);
    addHistoryEntry(description, change);
  }, [points, setPoints, addHistoryEntry]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-teal-400">Bodík</h1>
            <p className="text-gray-400 mt-2 text-lg">Bodovací systém pro Tomáška</p>
        </header>
        
        <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <Dashboard points={points} rewards={rewards} />
            <PointsControl reasons={reasons} onPointsChange={handlePointsChange} onSetPoints={handleSetPoints} />
          </div>
          <div className="lg:col-span-1">
            <Management
              rewards={rewards}
              setRewards={setRewards}
              reasons={reasons}
              setReasons={setReasons}
              history={history}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
