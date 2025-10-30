import React, { useState } from 'react';
import { Reward, Reason, HistoryEntry } from '../types.ts';

interface ManagementProps {
  rewards: Reward[];
  setRewards: (rewards: Reward[]) => void;
  reasons: Reason[];
  setReasons: (reasons: Reason[]) => void;
  history: HistoryEntry[];
  setHistory: (history: HistoryEntry[]) => void;
  appName: string;
  setAppName: (name: string) => void;
  profilePicture: string;
  setProfilePicture: (picture: string) => void;
  entityPrefix: string;
  onReset: () => void;
}

const Management: React.FC<ManagementProps> = ({
  rewards, setRewards, reasons, setReasons, history, setHistory,
  appName, setAppName, profilePicture, setProfilePicture,
  entityPrefix, onReset
}) => {
  const [newRewardName, setNewRewardName] = useState('');
  const [newRewardThreshold, setNewRewardThreshold] = useState('');
  const [newRewardValue, setNewRewardValue] = useState('');
  const [newRewardUnit, setNewRewardUnit] = useState('');
  const [newRewardPeriod, setNewRewardPeriod] = useState('');

  const [newReasonName, setNewReasonName] = useState('');
  const [newReasonValue, setNewReasonValue] = useState('');

  const handleAddReward = (e: React.FormEvent) => {
    e.preventDefault();
    const threshold = parseInt(newRewardThreshold, 10);
    if (newRewardName.trim() && !isNaN(threshold)) {
      const newReward: Reward = {
        id: crypto.randomUUID(),
        name: newRewardName.trim(),
        threshold,
        value: newRewardValue.trim(),
        unit: newRewardUnit.trim(),
        period: newRewardPeriod.trim(),
      };
      setRewards([...rewards, newReward]);
      setNewRewardName('');
      setNewRewardThreshold('');
      setNewRewardValue('');
      setNewRewardUnit('');
      setNewRewardPeriod('');
    }
  };

  const handleRemoveReward = (id: string) => {
    setRewards(rewards.filter(r => r.id !== id));
  };
  
  const handleAddReason = (e: React.FormEvent) => {
    e.preventDefault();
    const value = parseInt(newReasonValue, 10);
    if (newReasonName.trim() && !isNaN(value)) {
      setReasons([...reasons, { id: crypto.randomUUID(), name: newReasonName.trim(), value }]);
      setNewReasonName('');
      setNewReasonValue('');
    }
  };
  
  const handleRemoveReason = (id: string) => {
    setReasons(reasons.filter(r => r.id !== id));
  };
  
  const handleClearHistory = () => {
    if (window.confirm('Opravdu chcete smazat celou historii? Tato akce je nevratná.')) {
        setHistory([]);
    }
  };

  const downloadCsv = () => {
    const header = "timestamp,description,change,newTotal\n";
    const csv = history.map(row => 
        `"${new Date(row.timestamp).toLocaleString()}","${row.description.replace(/"/g, '""')}","${row.change}","${row.newTotal}"`
    ).join("\n");

    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]); // BOM for UTF-8
    const blob = new Blob([bom, header, csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `bodik_historie_${entityPrefix}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="space-y-8">
        {/* General Settings */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-gray-800 rounded-xl shadow-lg p-6">
                <h3 className="text-xl font-bold mb-4">Obecné nastavení</h3>
                <div className="space-y-4">
                     <div>
                        <label htmlFor="appName" className="block text-sm font-medium text-gray-400 mb-1">Název aplikace</label>
                        <input
                            id="appName"
                            type="text"
                            value={appName}
                            onChange={(e) => setAppName(e.target.value)}
                            className="w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500"
                        />
                    </div>
                     <div>
                        <label htmlFor="profilePicture" className="block text-sm font-medium text-gray-400 mb-1">Profilový obrázek (název souboru)</label>
                        <input
                            id="profilePicture"
                            type="text"
                            value={profilePicture}
                            onChange={(e) => setProfilePicture(e.target.value)}
                            placeholder="např. tom.jpg"
                            className="w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500"
                        />
                         <p className="text-xs text-gray-500 mt-1">Obrázek nahrajte do složky `/config/www/{entityPrefix}/`.</p>
                    </div>
                </div>
            </div>
             {/* Data Export */}
            <div className="bg-gray-800 rounded-xl shadow-lg p-6">
                <h3 className="text-xl font-bold mb-4">Export a správa dat</h3>
                <div className="space-y-4">
                    <button onClick={downloadCsv} disabled={history.length === 0} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition-colors w-full">
                        Stáhnout historii (.csv)
                    </button>
                    <button onClick={handleClearHistory} disabled={history.length === 0} className="bg-yellow-800 hover:bg-yellow-700 disabled:bg-gray-600 disabled:cursor-not-allowed font-bold py-2 px-4 rounded-md transition-colors w-full">
                        Vymazat historii
                    </button>
                </div>
            </div>
        </div>

      {/* Rewards Management */}
      <div className="bg-gray-800 rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-bold mb-4">Správa odměn</h3>
        <ul className="space-y-2 mb-4 max-h-60 overflow-y-auto pr-2">
          {rewards.sort((a,b) => a.threshold - b.threshold).map(reward => (
            <li key={reward.id} className="flex justify-between items-center bg-gray-700 p-2 rounded-md">
              <span>{reward.name} ({reward.threshold} b.)</span>
              <button onClick={() => handleRemoveReward(reward.id)} className="text-red-400 hover:text-red-300 font-bold text-lg">🗑️</button>
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddReward} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" value={newRewardName} onChange={(e) => setNewRewardName(e.target.value)} placeholder="Název (např. iPad)" className="md:col-span-2 bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500" required />
            <input type="number" value={newRewardThreshold} onChange={(e) => setNewRewardThreshold(e.target.value)} placeholder="Potřebné body" className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500" required />
            <input type="text" value={newRewardValue} onChange={(e) => setNewRewardValue(e.target.value)} placeholder="Počet (např. 2)" className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500" />
            <input type="text" value={newRewardUnit} onChange={(e) => setNewRewardUnit(e.target.value)} placeholder="Jednotka (např. hodiny)" className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500" />
            <select value={newRewardPeriod} onChange={(e) => setNewRewardPeriod(e.target.value)} className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500">
                <option value="">Žádné období</option>
                <option value="denně">denně</option>
                <option value="týdně">týdně</option>
                <option value="měsíčně">měsíčně</option>
            </select>
            <button type="submit" className="md:col-span-2 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-md transition-colors">Přidat odměnu</button>
        </form>
      </div>

      {/* Reasons Management */}
      <div className="bg-gray-800 rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-bold mb-4">Správa důvodů</h3>
        <ul className="space-y-2 mb-4 max-h-60 overflow-y-auto pr-2">
          {reasons.sort((a,b) => a.name.localeCompare(b.name)).map(reason => (
            <li key={reason.id} className="flex justify-between items-center bg-gray-700 p-2 rounded-md">
              <span>{reason.name} (<span className={`font-mono font-bold ${reason.value >= 0 ? 'text-green-400' : 'text-red-400'}`}>{reason.value > 0 ? '+':''}{reason.value}</span>)</span>
              <button onClick={() => handleRemoveReason(reason.id)} className="text-red-400 hover:text-red-300 font-bold text-lg">🗑️</button>
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddReason} className="flex flex-wrap gap-2">
          <input type="text" value={newReasonName} onChange={(e) => setNewReasonName(e.target.value)} placeholder="Název důvodu" className="flex-grow bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500" required />
          <input type="number" value={newReasonValue} onChange={(e) => setNewReasonValue(e.target.value)} placeholder="Hodnota (+/-)" className="w-32 bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500" required />
          <button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-md transition-colors">Přidat důvod</button>
        </form>
      </div>

      {/* Danger Zone */}
       <div className="bg-gray-800 rounded-xl shadow-lg p-6">
          <h3 className="text-xl font-bold mb-4">Konfigurace</h3>
           <p className="text-sm text-gray-400 mb-2">
              Tato instance aplikace používá entity s prefixem: <strong className="font-mono text-teal-400">{entityPrefix}</strong>
          </p>
          <button onClick={onReset} className="bg-red-800 hover:bg-red-700 font-bold py-2 px-4 rounded-md transition-colors w-full">
              Resetovat a nastavit nový prefix
          </button>
      </div>
    </div>
  );
};

export default Management;