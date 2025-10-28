
import React, { useMemo } from 'react';
import { Reward } from '../types';

interface DashboardProps {
  points: number;
  rewards: Reward[];
}

const UnlockedIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-400" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
);

const NextGoalIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
    </svg>
);


const Dashboard: React.FC<DashboardProps> = ({ points, rewards }) => {
    const { unlockedRewards, nextGoal } = useMemo(() => {
        const sortedRewards = [...rewards].sort((a, b) => a.threshold - b.threshold);
        const currentUnlocked = sortedRewards.filter(r => points >= r.threshold);

        const rewardGroups = new Map<string, Reward>();
        currentUnlocked.forEach(reward => {
            const baseName = reward.name.split(' :: ')[0];
            const existing = rewardGroups.get(baseName);
            if (!existing || reward.threshold > existing.threshold) {
                rewardGroups.set(baseName, reward);
            }
        });

        const finalUnlocked = Array.from(rewardGroups.values());
        
        const currentNextGoal = sortedRewards.find(r => r.threshold > points) || null;

        return { unlockedRewards: finalUnlocked, nextGoal: currentNextGoal };
    }, [points, rewards]);

  return (
    <div className="space-y-8">
        <div className="bg-gray-800 rounded-xl shadow-lg p-6 text-center">
            <h2 className="text-lg font-medium text-gray-400">Aktuální počet bodů</h2>
            <p className="text-7xl font-bold font-mono text-white my-2">{points}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-800 rounded-xl shadow-lg p-6">
                <h3 className="text-xl font-bold mb-4 flex items-center"><UnlockedIcon />Odemčené odměny</h3>
                {unlockedRewards.length > 0 ? (
                    <ul className="space-y-3">
                        {unlockedRewards.map(reward => (
                            <li key={reward.id} className="bg-gray-700/50 p-3 rounded-lg flex justify-between items-center">
                                <span className="font-medium">{reward.name}</span>
                                <span className="text-sm font-mono text-green-400">{reward.threshold} b.</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-gray-400">Žádné odměny nejsou odemčeny.</p>
                )}
            </div>

            <div className="bg-gray-800 rounded-xl shadow-lg p-6">
                <h3 className="text-xl font-bold mb-4 flex items-center"><NextGoalIcon />Další cíl</h3>
                {nextGoal ? (
                    <div>
                        <div className="bg-gray-700/50 p-3 rounded-lg flex justify-between items-center">
                            <span className="font-medium">{nextGoal.name}</span>
                            <span className="text-sm font-mono text-yellow-400">{nextGoal.threshold} b.</span>
                        </div>
                        <p className="mt-4 text-center text-gray-300">
                            Zbývá <span className="font-bold text-yellow-400 font-mono text-lg">{nextGoal.threshold - points}</span> bodů.
                        </p>
                    </div>
                ) : (
                    <p className="text-gray-400">Všechny odměny jsou odemčeny!</p>
                )}
            </div>
        </div>
    </div>
  );
};

export default Dashboard;
