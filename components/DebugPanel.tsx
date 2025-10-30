import React from 'react';

interface DebugPanelProps {
  allState: object;
}

const DebugPanel: React.FC<DebugPanelProps> = ({ allState }) => {
  return (
    <div className="bg-gray-800 rounded-xl shadow-lg p-6">
      <h3 className="text-xl font-bold mb-4">Debug Panel</h3>
      <p className="text-sm text-gray-400 mb-4">
        Zobrazuje aktuální stav aplikace načtený z Home Assistant.
      </p>
      <pre className="bg-gray-900 p-4 rounded-md text-sm text-green-300 overflow-x-auto whitespace-pre-wrap break-all">
        {JSON.stringify(allState, null, 2)}
      </pre>
    </div>
  );
};

export default DebugPanel;