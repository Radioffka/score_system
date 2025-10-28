
import React, { useState } from 'react';
import { Reward, Reason, HistoryEntry } from '../types';

type ManagementProps = {
  rewards: Reward[];
  setRewards: React.Dispatch<React.SetStateAction<Reward[]>>;
  reasons: Reason[];
  setReasons: React.Dispatch<React.SetStateAction<Reason[]>>;
  history: HistoryEntry[];
};

type ActiveTab = 'rewards' | 'reasons' | 'history';

const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg>;
const DeleteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>;

const Management: React.FC<ManagementProps> = ({ rewards, setRewards, reasons, setReasons, history }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('rewards');

  return (
    <div className="bg-gray-800 rounded-xl shadow-lg h-full">
      <div className="border-b border-gray-700">
        <nav className="-mb-px flex space-x-1" aria-label="Tabs">
          <button onClick={() => setActiveTab('rewards')} className={`${activeTab === 'rewards' ? 'border-teal-400 text-teal-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'} w-1/3 py-4 px-1 text-center border-b-2 font-medium text-sm transition-colors`}>Odměny</button>
          <button onClick={() => setActiveTab('reasons')} className={`${activeTab === 'reasons' ? 'border-teal-400 text-teal-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'} w-1/3 py-4 px-1 text-center border-b-2 font-medium text-sm transition-colors`}>Důvody</button>
          <button onClick={() => setActiveTab('history')} className={`${activeTab === 'history' ? 'border-teal-400 text-teal-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'} w-1/3 py-4 px-1 text-center border-b-2 font-medium text-sm transition-colors`}>Historie</button>
        </nav>
      </div>

      <div className="p-6">
        {activeTab === 'rewards' && <RewardsManager items={rewards} setItems={setRewards} />}
        {activeTab === 'reasons' && <ReasonsManager items={reasons} setItems={setReasons} />}
        {activeTab === 'history' && <HistoryLog items={history} />}
      </div>
    </div>
  );
};

// Rewards Manager
const RewardsManager: React.FC<{ items: Reward[], setItems: React.Dispatch<React.SetStateAction<Reward[]>> }> = ({ items, setItems }) => {
  const handleAdd = (item: Omit<Reward, 'id'>) => setItems(prev => [{...item, id: crypto.randomUUID()}, ...prev]);
  const handleUpdate = (updatedItem: Reward) => setItems(prev => prev.map(item => item.id === updatedItem.id ? updatedItem : item));
  const handleDelete = (id: string) => setItems(prev => prev.filter(item => item.id !== id));
  // For simplicity, form is inlined. A modal would be better for complex forms.
  const [name, setName] = useState('');
  const [threshold, setThreshold] = useState('');
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name && threshold) {
        handleAdd({ name, threshold: parseInt(threshold) });
        setName('');
        setThreshold('');
    }
  }

  return <div>
    <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Název odměny" className="flex-grow bg-gray-700 p-2 rounded-md"/>
        <input value={threshold} onChange={e => setThreshold(e.target.value)} type="number" placeholder="Práh" className="w-24 bg-gray-700 p-2 rounded-md"/>
        <button type="submit" className="bg-teal-600 hover:bg-teal-700 p-2 rounded-md">Přidat</button>
    </form>
    <ul className="space-y-2 max-h-96 overflow-y-auto">
        {items.map(item => (
            <li key={item.id} className="bg-gray-700 p-2 rounded-md flex justify-between items-center">
                <span>{item.name} ({item.threshold}b)</span>
                <button onClick={() => handleDelete(item.id)} className="text-red-400 hover:text-red-300"><DeleteIcon /></button>
            </li>
        ))}
    </ul>
  </div>;
};

// Reasons Manager
const ReasonsManager: React.FC<{ items: Reason[], setItems: React.Dispatch<React.SetStateAction<Reason[]>> }> = ({ items, setItems }) => {
  const handleAdd = (item: Omit<Reason, 'id'>) => setItems(prev => [{...item, id: crypto.randomUUID()}, ...prev]);
  const handleDelete = (id: string) => setItems(prev => prev.filter(item => item.id !== id));
  const [name, setName] = useState('');
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name && value) {
        handleAdd({ name, value: parseInt(value) });
        setName('');
        setValue('');
    }
  }
  
  return <div>
    <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Název důvodu" className="flex-grow bg-gray-700 p-2 rounded-md"/>
        <input value={value} onChange={e => setValue(e.target.value)} type="number" placeholder="Hodnota" className="w-24 bg-gray-700 p-2 rounded-md"/>
        <button type="submit" className="bg-teal-600 hover:bg-teal-700 p-2 rounded-md">Přidat</button>
    </form>
    <ul className="space-y-2 max-h-96 overflow-y-auto">
        {items.map(item => (
            <li key={item.id} className="bg-gray-700 p-2 rounded-md flex justify-between items-center">
                <span>{item.name} ({item.value > 0 ? '+' : ''}{item.value}b)</span>
                <button onClick={() => handleDelete(item.id)} className="text-red-400 hover:text-red-300"><DeleteIcon /></button>
            </li>
        ))}
    </ul>
  </div>;
};

// History Log
const HistoryLog: React.FC<{ items: HistoryEntry[] }> = ({ items }) => (
  <ul className="space-y-2 max-h-[28rem] overflow-y-auto pr-2">
    {items.length > 0 ? items.map(item => (
      <li key={item.id} className="bg-gray-700 p-3 rounded-md flex justify-between items-center text-sm">
        <div>
          <p className="font-medium">{item.description}</p>
          <p className="text-xs text-gray-400">{new Date(item.timestamp).toLocaleString('cs-CZ')}</p>
        </div>
        <span className={`font-bold font-mono ${item.change > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {item.change > 0 ? '+' : ''}{item.change}
        </span>
      </li>
    )) : <p className="text-gray-400 text-center">Historie je prázdná.</p>}
  </ul>
);

export default Management;
