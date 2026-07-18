import React, { useState } from 'react';
import { Eye, Monitor, Terminal, RefreshCw, Cpu, Play } from 'lucide-react';

export default function ComputerControlPanel({ onSendVisionToMyraa }) {
  const [screenshot, setScreenshot] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [customCommand, setCustomCommand] = useState('');
  const [commandLogs, setCommandLogs] = useState([]);
  const [customUrl, setCustomUrl] = useState('');

  const handleCaptureScreen = async () => {
    setIsCapturing(true);
    try {
      const res = await fetch('http://localhost:3001/api/screen/capture');
      const data = await res.json();
      if (data.success) {
        setScreenshot(data.data);
        addLog('Captured desktop screenshot.', 'success');
      } else {
        addLog(`Screen capture error: ${data.details || data.error}`, 'error');
      }
    } catch (err) {
      addLog(`Failed to connect to backend: ${err.message}`, 'error');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleSystemControl = async (action, target) => {
    try {
      const res = await fetch('http://localhost:3001/api/system/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, target })
      });
      const data = await res.json();
      if (data.success) {
        addLog(data.message || `Executed ${action} on ${target}`, 'success');
      } else {
        addLog(`System control failed: ${data.error}`, 'error');
      }
    } catch (err) {
      addLog(`Error executing OS control: ${err.message}`, 'error');
    }
  };

  const handleExecuteCommand = async (e) => {
    e.preventDefault();
    if (!customCommand.trim()) return;

    const cmdToRun = customCommand;
    addLog(`Running command: ${cmdToRun}`, 'info');

    try {
      const res = await fetch('http://localhost:3001/api/system/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmdToRun })
      });
      const data = await res.json();
      if (data.success) {
        addLog(`Output:\n${data.stdout || '(No output)'}`, 'success');
      } else {
        addLog(`Error:\n${data.stderr || data.error}`, 'error');
      }
    } catch (err) {
      addLog(`Execution error: ${err.message}`, 'error');
    }
    setCustomCommand('');
  };

  const addLog = (msg, type = 'info') => {
    setCommandLogs(prev => [
      { text: msg, type, timestamp: new Date().toLocaleTimeString() },
      ...prev.slice(0, 49)
    ]);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
      {/* Left Column: Screen Vision & Snapshot */}
      <div className="flex flex-col bg-black border border-zinc-800 rounded-3xl p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-pink-500" />
            <h3 className="font-bold text-xs text-white uppercase tracking-wider">Screen Vision Engine</h3>
          </div>

          <button
            onClick={handleCaptureScreen}
            disabled={isCapturing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-900 text-zinc-100 border border-zinc-800 hover:border-pink-500/50 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCapturing ? 'animate-spin' : ''}`} />
            <span>{isCapturing ? 'Capturing...' : 'Capture Desktop'}</span>
          </button>
        </div>

        <div className="relative flex-1 min-h-[260px] bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden flex items-center justify-center">
          {screenshot ? (
            <img src={screenshot} alt="Desktop Capture" className="w-full h-full object-contain rounded-2xl" />
          ) : (
            <div className="flex flex-col items-center text-center p-6 text-zinc-500">
              <Monitor className="w-10 h-10 text-zinc-700 mb-2" />
              <p className="text-xs font-medium text-zinc-300">No Desktop Snapshot Captured</p>
              <p className="text-[11px] text-zinc-500 mt-1">Click "Capture Desktop" above so MYRAA can inspect your screen!</p>
            </div>
          )}
        </div>

        {screenshot && (
          <button
            onClick={() => onSendVisionToMyraa(screenshot)}
            className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold bg-pink-600 hover:bg-pink-500 text-white shadow-lg shadow-pink-600/20 transition"
          >
            <Cpu className="w-4 h-4" />
            <span>Ask MYRAA to Inspect Screen & Fix Errors</span>
          </button>
        )}
      </div>

      {/* Right Column: Computer OS Automation */}
      <div className="flex flex-col bg-black border border-zinc-800 rounded-3xl p-5 shadow-2xl">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-zinc-800">
          <Terminal className="w-4 h-4 text-pink-500" />
          <h3 className="font-bold text-xs text-white uppercase tracking-wider">OS Control & App Launcher</h3>
        </div>

        {/* Quick App Launcher */}
        <div className="mb-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-2">
            Quick Launch Desktop Apps
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Notepad', target: 'notepad.exe', icon: '📝' },
              { label: 'Calculator', target: 'calc.exe', icon: '🔢' },
              { label: 'VS Code', target: 'code', icon: '💻' },
              { label: 'Chrome', target: 'chrome.exe', icon: '🌐' },
            ].map(app => (
              <button
                key={app.label}
                onClick={() => handleSystemControl('launch_app', app.target)}
                className="flex items-center gap-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-pink-500/40 text-xs font-medium text-zinc-200 transition text-left"
              >
                <span>{app.icon}</span>
                <span className="truncate">{app.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Custom URL Launcher */}
        <div className="mb-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-2">
            Open URL in Default Browser
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://github.com"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-pink-500 font-mono"
            />
            <button
              onClick={() => customUrl && handleSystemControl('open_url', customUrl)}
              className="px-3 py-2 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 text-xs rounded-xl font-semibold transition"
            >
              Open URL
            </button>
          </div>
        </div>

        {/* PowerShell / Command Executor */}
        <form onSubmit={handleExecuteCommand} className="mb-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-2">
            Execute PowerShell / System Command
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              value={customCommand}
              onChange={(e) => setCustomCommand(e.target.value)}
              placeholder="e.g. dir, git status, code ."
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none focus:border-pink-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-white text-black font-bold text-xs rounded-xl transition flex items-center gap-1 hover:bg-zinc-200"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Run</span>
            </button>
          </div>
        </form>

        {/* Action Logs */}
        <div className="flex-1 flex flex-col bg-zinc-950 border border-zinc-900 rounded-2xl p-3 overflow-hidden">
          <span className="text-[9px] uppercase font-bold text-zinc-500 mb-2">System Action History</span>
          <div className="flex-1 overflow-y-auto space-y-2 font-mono text-[11px]">
            {commandLogs.length === 0 ? (
              <span className="text-zinc-600 italic">No OS actions recorded.</span>
            ) : (
              commandLogs.map((log, idx) => (
                <div key={idx} className="p-2 rounded-lg border bg-zinc-900 border-zinc-800 text-zinc-300">
                  <span className="text-[9px] text-zinc-500 mr-2">[{log.timestamp}]</span>
                  <span className="whitespace-pre-wrap">{log.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
