import React, { useState, useEffect, useCallback } from 'react';
import { Reward, Reason, HistoryEntry, AppState } from './types.ts';
import { initialize, loadApplicationState, updateState, IApplicationData } from './services/homeAssistantService.ts';
import Dashboard from './components/Dashboard.tsx';
import Management from './components/Management.tsx';
import Setup from './components/Setup.tsx';
import DebugPanel from './components/DebugPanel.tsx';

type View = 'dashboard' | 'management' | 'debug';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('initializing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [view, setView] = useState<View>('dashboard');

  // Full application data state
  const [data, setData] = useState<IApplicationData>({
    points: 0,
    rewards: [],
    reasons: [],
    history: [],
    appName: 'Bodík',
    profilePicture: '',
    entityPrefix: '',
  });

  const { points, rewards, reasons, history, appName, profilePicture, entityPrefix } = data;

  // Initialization logic
  useEffect(() => {
    const init = async () => {
      try {
        const initState = await initialize();
        if (initState.isInitialized) {
          setAppState('loading');
          const loadedData = await loadApplicationState(initState.prefix!);
          setData(loadedData);
          setAppState('ready');
        } else {
          setAppState('setup');
        }
      } catch (error: any) {
        console.error("Initialization failed:", error);
        setErrorMessage(error.message || 'An unknown error occurred during initialization.');
        setAppState('error');
      }
    };
    init();
  }, []);

  const handleSetupComplete = async (prefix: string) => {
     try {
        setAppState('loading'); // Show loading screen while entities are created
        await initialize(prefix); // This will now create all entities
        const loadedData = await loadApplicationState(prefix);
        setData(loadedData);
        setAppState('ready');
    } catch (error: any) {
        console.error("Setup completion failed:", error);
        setErrorMessage(error.message || 'Failed to complete setup.');
        setAppState('error');
    }
  };
  
  const handleReset = useCallback(async () => {
     if (window.confirm('Opravdu chcete resetovat prefix? Aplikace se vrátí na úvodní obrazovku.')) {
        try {
            await updateState(entityPrefix, 'entityPrefix', null); // Clear the prefix in HA
            // We don't need to manually set the app state to 'setup'.
            // A page reload will re-trigger the initialization logic which will naturally lead to the setup screen.
            window.location.reload();
        } catch (error: any) {
            console.error("Failed to reset prefix:", error);
            setErrorMessage(error.message || 'Could not reset prefix.');
            setAppState('error');
        }
     }
  }, [entityPrefix]);

  const updateAndPersist = useCallback(<K extends Exclude<keyof IApplicationData, 'entityPrefix'>>(key: K, value: IApplicationData[K]) => {
    if (!entityPrefix) return;
    setData(prevData => ({ ...prevData, [key]: value }));
    // FIX: Explicitly passing the generic parameter <K> helps TypeScript correctly resolve the conditional type in the `updateState` function signature.
    updateState<K>(entityPrefix, key, value).catch(error => {
        console.error(`Failed to persist ${key}:`, error);
        setErrorMessage(`Nepodařilo se uložit data pro: ${key}. Zkuste obnovit stránku.`);
        setAppState('error');
    });
  }, [entityPrefix]);


  const handlePointsChange = (change: number, description: string) => {
    const newTotal = (points ?? 0) + change;
    const newHistoryEntry: HistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        description,
        change,
        newTotal,
    };
    const newHistory = [newHistoryEntry, ...history];
    updateAndPersist('history', newHistory);
    updateAndPersist('points', newTotal);
  };

  const handleSetPoints = (value: number, description: string) => {
    const change = value - (points ?? 0);
    const newHistoryEntry: HistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        description,
        change,
        newTotal: value,
    };
    const newHistory = [newHistoryEntry, ...history];
    updateAndPersist('history', newHistory);
    updateAndPersist('points', value);
  };
  
  if (appState === 'initializing' || appState === 'loading') {
    return <div className="flex items-center justify-center h-screen"><p className="text-xl animate-pulse">Připojování k Home Assistant a načítání dat...</p></div>;
  }
  
  if (appState === 'setup') {
    return <Setup onSetupComplete={handleSetupComplete} />;
  }
  
  if (appState === 'error') {
     return (
        <div className="flex items-center justify-center h-screen">
             <div className="bg-red-900/50 border border-red-700 rounded-xl p-8 text-center max-w-lg">
                <h2 className="text-3xl font-bold text-red-300 mb-4">Chyba aplikace</h2>
                <p className="text-red-200">{errorMessage}</p>
             </div>
        </div>
    );
  }

  const profileImageUrl = profilePicture.startsWith('http') || profilePicture.startsWith('/')
    ? profilePicture
    : `/local/${entityPrefix}/${profilePicture}`;

  return (
    <div className="p-4 bg-gray-900 text-white min-h-screen font-sans">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
            {profilePicture && (
                 <img src={profileImageUrl} alt="Profil" className="w-12 h-12 rounded-full object-cover" />
            )}
            <h1 className="text-3xl font-bold text-teal-400">{appName}</h1>
        </div>
        <div className="text-right">
             <nav className="flex items-center gap-2">
                <button onClick={() => setView('dashboard')} className={`px-4 py-2 rounded-md transition-colors ${view === 'dashboard' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>Panel</button>
                <button onClick={() => setView('management')} className={`px-4 py-2 rounded-md transition-colors ${view === 'management' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>Správa</button>
                <button onClick={() => setView('debug')} className={`px-4 py-2 rounded-md transition-colors ${view === 'debug' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>Debug</button>
            </nav>
            <p className="text-xs text-gray-500 mt-1">
                Připojeno k HA
                <span className="inline-block w-2 h-2 rounded-full bg-green-500 ml-2"></span>
            </p>
        </div>
      </header>

      <main>
        {view === 'dashboard' && (
          <Dashboard 
            points={points} 
            rewards={rewards} 
            reasons={reasons} 
            history={history} 
            onPointsChange={handlePointsChange} 
            onSetPoints={handleSetPoints} 
          />
        )}
        {view === 'management' && (
          <Management 
            rewards={rewards} 
            setRewards={(val) => updateAndPersist('rewards', val)}
            reasons={reasons}
            setReasons={(val) => updateAndPersist('reasons', val)}
            history={history}
            setHistory={(val) => updateAndPersist('history', val)}
            appName={appName}
            setAppName={(val) => updateAndPersist('appName', val)}
            profilePicture={profilePicture}
            setProfilePicture={(val) => updateAndPersist('profilePicture', val)}
            entityPrefix={entityPrefix}
            onReset={handleReset}
          />
        )}
        {view === 'debug' && <DebugPanel allState={data} />}
      </main>
      <footer className="text-center mt-8 text-xs text-gray-600">
        Bodík verze 2.1.0
      </footer>
    </div>
  );
};

export default App;