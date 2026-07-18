import React, { useState } from 'react';
import { Play, Code, Bug, Sparkles, Terminal } from 'lucide-react';

const INITIAL_CODE = `// MYRAA Pair Programming Studio
// Write or paste your code here to execute or ask MYRAA for help!

function calculateFibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    let temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}

console.log("Calculated 10th Fibonacci:", calculateFibonacci(10));
console.log("MYRAA & You are ready to build something legendary!");
`;

export default function CodingStudio({ onAskMyraaCode }) {
  const [code, setCode] = useState(INITIAL_CODE);
  const [language, setLanguage] = useState('javascript');
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [exitCode, setExitCode] = useState(null);

  const handleRunCode = async () => {
    setIsRunning(true);
    setOutput('Running code snippet...');
    setExitCode(null);

    let command = '';
    if (language === 'javascript') {
      command = `node -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
    } else if (language === 'python') {
      command = `python -c "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
    } else if (language === 'powershell') {
      command = `powershell -NoProfile -Command "${code.replace(/"/g, '`"').replace(/\n/g, ' ')}"`;
    } else {
      command = `echo "HTML/CSS Code Preview Mode"`;
    }

    try {
      const res = await fetch('http://localhost:3001/api/system/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      const data = await res.json();
      
      setExitCode(data.exitCode);
      if (data.stdout) {
        setOutput(data.stdout + (data.stderr ? `\n[STDERR]\n${data.stderr}` : ''));
      } else if (data.stderr) {
        setOutput(`[STDERR]\n${data.stderr}`);
      } else {
        setOutput(data.error || 'Execution completed with no output.');
      }
    } catch (err) {
      setOutput(`Failed to execute code locally: ${err.message}\nMake sure MYRAA backend server (server.js) is running!`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleAskMyraa = (actionType) => {
    let prompt = '';
    if (actionType === 'review') {
      prompt = `Hey MYRAA, please review my ${language} code below for clean performance & best practices:\n\n\`\`\`${language}\n${code}\n\`\`\``;
    } else if (actionType === 'fix') {
      prompt = `Hey MYRAA, I ran into an error running my code:\n\n\`\`\`${language}\n${code}\n\`\`\`\n\nLog:\n\`\`\`\n${output}\n\`\`\`\n\nPlease fix this bug for me!`;
    }
    onAskMyraaCode(prompt);
  };

  return (
    <div className="flex flex-col h-full bg-black border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
      {/* Editor Toolbar */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Code className="w-4 h-4 text-pink-500" />
            <span className="font-bold text-xs text-white uppercase tracking-wider">Coding Studio</span>
          </div>

          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-pink-500"
          >
            <option value="javascript">JavaScript (Node.js)</option>
            <option value="python">Python 3</option>
            <option value="powershell">PowerShell Script</option>
            <option value="html">HTML / CSS / JS</option>
          </select>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAskMyraa('review')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-900 text-zinc-200 border border-zinc-800 hover:border-pink-500/50 hover:text-pink-400 transition"
          >
            <Sparkles className="w-3.5 h-3.5 text-pink-400" />
            <span>Ask MYRAA</span>
          </button>

          {output && (
            <button
              onClick={() => handleAskMyraa('fix')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-900 text-pink-400 border border-pink-500/40 hover:bg-pink-500/10 transition"
            >
              <Bug className="w-3.5 h-3.5" />
              <span>Auto-Fix</span>
            </button>
          )}

          <button
            onClick={handleRunCode}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-zinc-200 text-black shadow-md transition disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isRunning ? 'Executing...' : 'Run Code'}</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 flex-1 min-h-[360px]">
        {/* Code Input Area */}
        <div className="relative border-r border-zinc-800 p-5 bg-black">
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck="false"
            className="w-full h-full bg-transparent text-zinc-100 font-mono text-xs leading-relaxed focus:outline-none resize-none"
            placeholder="// Write code here..."
          />
        </div>

        {/* Live Terminal */}
        <div className="flex flex-col bg-zinc-950 p-5 font-mono text-xs border-t lg:border-t-0 border-zinc-800">
          <div className="flex items-center justify-between text-zinc-400 border-b border-zinc-900 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-pink-500" />
              <span className="font-semibold text-white">Live Execution Output</span>
            </div>
            {exitCode !== null && (
              <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${exitCode === 0 ? 'bg-zinc-900 text-pink-400 border border-pink-500/30' : 'bg-rose-950 text-rose-300'}`}>
                Exit Code: {exitCode}
              </span>
            )}
          </div>

          <pre className="flex-1 overflow-y-auto text-zinc-300 leading-relaxed whitespace-pre-wrap font-mono text-xs">
            {output || '// Terminal ready. Click "Run Code" to execute script.'}
          </pre>
        </div>
      </div>
    </div>
  );
}
