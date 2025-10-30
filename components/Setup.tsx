import React, { useState } from 'react';

interface SetupProps {
  onSetupComplete: (prefix: string) => void;
}

const Setup: React.FC<SetupProps> = ({ onSetupComplete }) => {
  const [prefix, setPrefix] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sanitizedPrefix = prefix.trim().replace(/[^a-z0-9_]/gi, '').toLowerCase();
    
    if (!sanitizedPrefix) {
        setError('Prefix je povinný a může obsahovat pouze písmena, čísla a podtržítka.');
        return;
    }
    
    setError(null);
    setIsLoading(true);
    
    try {
        await onSetupComplete(sanitizedPrefix);
        // On success, the App component will switch the view.
    } catch (err: any) {
        setError(err.message || 'Nepodařilo se inicializovat systém. Zkontrolujte logy v Home Assistant.');
        setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
      <div className="bg-gray-800 rounded-xl shadow-lg p-8 max-w-md w-full">
        <h2 className="text-3xl font-bold mb-2">Vítejte v Bodíkovi!</h2>
        <p className="text-gray-400 mb-6">
          Pro začátek je potřeba systém inicializovat v Home Assistant.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="prefix" className="block text-sm font-medium text-gray-400 mb-1 text-left">
              Prefix pro entity
            </label>
            <input
              id="prefix"
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="např. jmeno_ditete"
              className="w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 focus:ring-teal-500 focus:border-teal-500"
              required
              disabled={isLoading}
            />
             <p className="text-xs text-gray-500 mt-1 text-left">Unikátní identifikátor pro tuto instanci (např. jméno dítěte).</p>
          </div>
          <button
            type="submit"
            className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 px-4 rounded-md transition-colors flex items-center justify-center disabled:bg-gray-500 disabled:cursor-wait"
            disabled={isLoading}
          >
            {isLoading ? (
                <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Inicializace...
                </>
            ) : "Inicializovat a pokračovat"}
          </button>
        </form>
        {error && <p className="text-red-400 mt-4">{error}</p>}
      </div>
    </div>
  );
};

export default Setup;