import React, { useState, useEffect, useRef } from 'react';
import { Reward, HistoryEntry, Reason } from '../types.ts';
import PointsControl from './PointsControl.tsx';

interface DashboardProps {
  points: number | null;
  rewards: Reward[];
  reasons: Reason[];
  history: HistoryEntry[];
  onPointsChange: (change: number, description: string) => void;
  onSetPoints: (value: number, description: string) => void;
}

const formatReward = (reward: Reward): string => {
  const parts = [
    reward.name,
    reward.value || '',
    reward.unit || '',
    reward.period || '',
  ];
  return parts.filter(p => String(p).trim() !== '').join(' ');
};


const Dashboard: React.FC<DashboardProps> = ({ points, rewards, reasons, history, onPointsChange, onSetPoints }) => {
  const [animationClass, setAnimationClass] = useState('');
  const prevPointsRef = useRef<number | null>(points);
  
  useEffect(() => {
    if (prevPointsRef.current !== null && points !== null) {
      if (points > prevPointsRef.current) {
        setAnimationClass('animate-pointPulsePositive');
      } else if (points < prevPointsRef.current) {
        setAnimationClass('animate-pointPulseNegative');
      }
      
      const timer = setTimeout(() => setAnimationClass(''), 600);
      return () => clearTimeout(timer);
    }
    prevPointsRef.current = points;
  }, [points]);

  const sortedRewards = [...rewards].sort((a, b) => a.threshold - b.threshold);
  
  // 1. Získání odemčených odměn s logikou "vyšší stupeň vítězí"
  const getUnlockedRewards = (currentPoints: number | null, allRewards: Reward[]): Reward[] => {
      if (currentPoints === null) return [];

      const unlocked = allRewards.filter(r => r.threshold <= currentPoints);
      const groupedRewards: { [key: string]: Reward } = {};

      for (const reward of unlocked) {
          const groupName = reward.name.trim();
          if (!groupedRewards[groupName] || reward.threshold > groupedRewards[groupName].threshold) {
              groupedRewards[groupName] = reward;
          }
      }
      return Object.values(groupedRewards).sort((a, b) => a.name.localeCompare(b.name));
  };

  const unlockedRewards = getUnlockedRewards(points, rewards);

  // 2. Nalezení dalšího cíle (nejbližší vyšší odměna)
  const nextReward = points !== null ? sortedRewards.find(r => r.threshold > points) : undefined;
  
  const progress = (nextReward && points !== null)
    ? (nextReward.threshold > 0 ? (points / nextReward.threshold) * 100 : 100)
    : 0;

  const recentHistory = [...history].slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Points Display */}
        <div className="lg:col-span-2 bg-gray-800 rounded-xl shadow-lg p-6 text-center flex flex-col justify-center items-center">
          <h2 className="text-2xl font-bold text-gray-400 mb-2">Aktuální skóre</h2>
          <p className={`text-7xl font-mono font-bold text-white transition-colors duration-300 ${animationClass}`}>
            {points === null ? '...' : points}
          </p>
        </div>

        {/* Points Control */}
        <div className="lg:row-span-3">
            <PointsControl reasons={reasons} onPointsChange={onPointsChange} onSetPoints={onSetPoints} disabled={points === null} />
        </div>

        {/* Unlocked Rewards */}
        <div className="bg-gray-800 rounded-xl shadow-lg p-6">
            <h3 className="text-xl font-bold mb-4">Odemčené odměny</h3>
            <ul className="space-y-2">
                {unlockedRewards.length > 0 ? unlockedRewards.map(reward => (
                    <li key={reward.id} className="flex justify-between items-center bg-teal-900/50 p-2 rounded-md">
                        <span className="font-semibold text-teal-300">{formatReward(reward)}</span>
                    </li>
                )) : (
                    <p className="text-gray-400">Žádné odměny nejsou odemčeny.</p>
                )}
            </ul>
        </div>

        {/* Progress to Next Reward */}
        <div className="bg-gray-800 rounded-xl shadow-lg p-6">
          <h3 className="text-xl font-bold mb-4">Postup k další odměně</h3>
          {points === null ? <p className="text-gray-400">Načítání...</p> : nextReward ? (
            <div>
              <div className="flex justify-between items-baseline mb-2">
                <span className="font-semibold">{formatReward(nextReward)}</span>
                <span className="text-sm font-mono text-gray-400">{points} / {nextReward.threshold} (zbývá {nextReward.threshold - points})</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-teal-500 h-4 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                ></div>
              </div>
            </div>
          ) : (
            <p className="text-gray-400">{rewards.length > 0 ? "Všechny odměny jsou odemčeny! Gratulujeme!" : "Zatím nebyly nastaveny žádné odměny."}</p>
          )}
        </div>
        
        {/* Recent History */}
        <div className="bg-gray-800 rounded-xl shadow-lg p-6">
            <h3 className="text-xl font-bold mb-4">Poslední aktivita</h3>
            <ul className="space-y-2">
                {recentHistory.length > 0 ? recentHistory.map(entry => (
                    <li key={entry.id} className="flex justify-between items-center text-sm">
                        <span>{entry.description}</span>
                        <span className={`font-mono font-bold ${entry.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {entry.change >= 0 ? '+' : ''}{entry.change}
                        </span>
                    </li>
                )) : <p className="text-gray-400">Žádná aktivita.</p>}
            </ul>
        </div>

      </div>
    </div>
  );
};

export default Dashboard;