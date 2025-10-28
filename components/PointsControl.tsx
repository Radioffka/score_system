
import React, { useState } from 'react';
import { Reason } from '../types';

interface PointsControlProps {
  reasons: Reason[];
  onPointsChange: (change: number, description: string) => void;
  onSetPoints: (value: number, description: string) => void;
}

const PointsControl: React.FC<PointsControlProps> = ({ reasons, onPointsChange, onSetPoints }) => {
  const [customAmount, setCustomAmount] = useState<string>('');
  const [setAmount, setSetAmount] = useState<string>('');
  const [selectedReason, setSelectedReason] = useState<string>('');

  const handleCustomAdd = () => {
    const amount = parseInt(customAmount, 10);
    if (!isNaN(amount)) {
      onPointsChange(amount, `Manuální přidání`);
      setCustomAmount('');
    }
  };

  const handleCustomSubtract = () => {
    const amount = parseInt(customAmount, 10);
    if (!isNaN(amount)) {
      onPointsChange(-amount, `Manuální odebrání`);
      setCustomAmount('');
    }
  };

  const handleReasonApply = () => {
    if (selectedReason) {
      const reason = reasons.find(r => r.id === selectedReason);
      if (reason) {
        onPointsChange(reason.value, reason.name);
        setSelectedReason('');
      }
    }
  };

  const handleSet = () => {
    const amount = parseInt(setAmount, 10);
    if (!isNaN(amount)) {
      onSetPoints(amount, `Manuální nastavení na ${amount}`);
      setSetAmount('');
    }
  };

  const handleReset = () => {
    onSetPoints(0, "Reset bodů");
  };

  return (
    <div className="bg-gray-800 rounded-xl shadow-lg p-6">
      <h3 className="text-xl font-bold mb-4">Změna bodů</h3>
      <div className="space-y-6">
        {/* Quick Change */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">Rychlá úprava</label>
          <div className="flex flex-wrap gap-2">
            {[5, 1, -1, -5].map(val => (
              <button
                key={val}
                onClick={() => onPointsChange(val, `Manuální úprava (${val > 0 ? '+':''}${val})`)}
                className={`px-4 py-2 rounded-md font-semibold transition-colors ${val > 0 ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {val > 0 ? '+':''}{val}
              </button>
            ))}
          </div>
        </div>

        {/* By Reason */}
        <div>
            <label htmlFor="reason-select" className="block text-sm font-medium text-gray-400 mb-2">Podle důvodu</label>
            <div className="flex gap-2">
                <select
                    id="reason-select"
                    value={selectedReason}
                    onChange={(e) => setSelectedReason(e.target.value)}
                    className="flex-grow bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500"
                >
                    <option value="">Vyberte důvod...</option>
                    {reasons.map(reason => (
                        <option key={reason.id} value={reason.id}>{reason.name} ({reason.value > 0 ? '+':''}{reason.value})</option>
                    ))}
                </select>
                <button onClick={handleReasonApply} disabled={!selectedReason} className="bg-teal-600 hover:bg-teal-700 disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition-colors">
                    Použít
                </button>
            </div>
        </div>

        {/* Custom Amount */}
        <div>
            <label htmlFor="custom-amount" className="block text-sm font-medium text-gray-400 mb-2">Vlastní hodnota</label>
            <div className="flex gap-2">
                <input
                    id="custom-amount"
                    type="number"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="Počet bodů"
                    className="w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500"
                />
                <button onClick={handleCustomAdd} disabled={!customAmount} className="bg-green-600 hover:bg-green-700 disabled:bg-gray-500 disabled:cursor-not-allowed font-bold py-2 px-4 rounded-md transition-colors">+</button>
                <button onClick={handleCustomSubtract} disabled={!customAmount} className="bg-red-600 hover:bg-red-700 disabled:bg-gray-500 disabled:cursor-not-allowed font-bold py-2 px-4 rounded-md transition-colors">-</button>
            </div>
        </div>
        
        {/* Set / Reset */}
        <div>
            <label htmlFor="set-amount" className="block text-sm font-medium text-gray-400 mb-2">Přímé nastavení / Reset</label>
            <div className="flex gap-2">
                <input
                    id="set-amount"
                    type="number"
                    value={setAmount}
                    onChange={(e) => setSetAmount(e.target.value)}
                    placeholder="Nová hodnota"
                    className="flex-grow bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500"
                />
                <button onClick={handleSet} disabled={!setAmount} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed font-bold py-2 px-4 rounded-md transition-colors">
                    Nastavit
                </button>
                <button onClick={handleReset} className="bg-yellow-600 hover:bg-yellow-700 font-bold py-2 px-4 rounded-md transition-colors">
                    Reset (0)
                </button>
            </div>
        </div>

      </div>
    </div>
  );
};

export default PointsControl;
