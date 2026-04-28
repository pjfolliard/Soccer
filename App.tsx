/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  UserPlus, 
  Trash2, 
  Lock, 
  Unlock, 
  Users, 
  Settings as SettingsIcon, 
  Timer as TimerIcon,
  ChevronRight,
  Check,
  X,
  FileDown,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

interface Player {
  id: string;
  name: string;
  onField: boolean;
  lockedOn: boolean;  // Always on field
  lockedOff: boolean; // Always on bench
  totalMinutes: number;
  shifts: number;
  currentShiftStartTime: number | null; // ms timestamp or null
}

interface GameSettings {
  halfLength: number; // minutes
  numHalves: number;
  subInterval: number; // minutes
  playersOnField: number;
}

enum GameState {
  SETUP = 'SETUP',
  ROSTER = 'ROSTER',
  ACTIVE = 'ACTIVE',
  SUMMARY = 'SUMMARY'
}

// --- Defaults ---

const DEFAULT_SETTINGS: GameSettings = {
  halfLength: 20,
  numHalves: 2,
  subInterval: 5,
  playersOnField: 7,
};

// --- Utilities ---

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function App() {
  // --- State ---
  const [gameState, setGameState] = useState<GameState>(GameState.SETUP);
  const [players, setPlayers] = useState<Player[]>([]);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  
  // Game Timer State
  const [timeRemaining, setTimeRemaining] = useState(DEFAULT_SETTINGS.halfLength * 60);
  const [currentHalf, setCurrentHalf] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [lastTick, setLastTick] = useState<number | null>(null);
  
  // Sub Suggestion State
  const [showSubModal, setShowSubModal] = useState(false);
  const [suggestedSubs, setSuggestedSubs] = useState<{ out: string[]; in: string[] }>({ out: [], in: [] });
  const [nextSubTime, setNextSubTime] = useState(DEFAULT_SETTINGS.subInterval * 60);

  // Persistence Refs
  const didLoad = useRef(false);

  // --- Initialization & Local Storage ---

  useEffect(() => {
    const savedRoster = localStorage.getItem('soccer_roster');
    const savedSettings = localStorage.getItem('soccer_settings');
    if (savedRoster) setPlayers(JSON.parse(savedRoster));
    if (savedSettings) setSettings(JSON.parse(savedSettings));
    didLoad.current = true;
  }, []);

  useEffect(() => {
    if (!didLoad.current) return;
    localStorage.setItem('soccer_roster', JSON.stringify(players));
  }, [players]);

  useEffect(() => {
    if (!didLoad.current) return;
    localStorage.setItem('soccer_settings', JSON.stringify(settings));
    // Update timer if in setup
    if (gameState === GameState.SETUP) {
      setTimeRemaining(settings.halfLength * 60);
      setNextSubTime(settings.halfLength * 60 - settings.subInterval * 60);
    }
  }, [settings, gameState]);

  // --- Game Timer Loop ---

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isRunning) {
      interval = setInterval(() => {
        const now = Date.now();
        const delta = lastTick ? (now - lastTick) / 1000 : 0;
        setLastTick(now);

        setTimeRemaining(prev => {
          const next = Math.max(0, prev - delta);
          
          // Check for sub interval
          if (next <= nextSubTime && next > 0) {
            triggerSubSuggestion();
            setNextSubTime(prevSub => Math.max(0, prevSub - settings.subInterval * 60));
          }

          if (next === 0) {
            setIsRunning(false);
            setLastTick(null);
          }
          return next;
        });

        // Update player playing time
        setPlayers(prev => prev.map(p => {
          if (p.onField) {
            return { ...p, totalMinutes: p.totalMinutes + (delta / 60) };
          }
          return p;
        }));
      }, 100);
    } else {
      setLastTick(null);
    }
    return () => clearInterval(interval);
  }, [isRunning, lastTick, nextSubTime, settings.subInterval]);

  // --- Core Logic Functions ---

  const triggerSubSuggestion = useCallback(() => {
    // Determine who should come off
    const fieldPlayers = players.filter(p => p.onField);
    const benchPlayers = players.filter(p => !p.onField);

    // Filter by locks
    const eligibleOff = fieldPlayers.filter(p => !p.lockedOn);
    const eligibleOn = benchPlayers.filter(p => !p.lockedOff);

    if (eligibleOff.length === 0 || eligibleOn.length === 0) return;

    // Sorting:
    // To come OFF: Those who have played the most total time or longest current shift (keeping it simple: totalMinutes)
    const sortedOff = [...eligibleOff].sort((a, b) => b.totalMinutes - a.totalMinutes);
    // To come ON: Those who have played the least time
    const sortedOn = [...eligibleOn].sort((a, b) => a.totalMinutes - b.totalMinutes);

    // Number of subs = min(bench size, empty field slots if we were to sub everyone off, or just a fixed amount?)
    // Usually in youth soccer, we want to rotate as many as possible or a reasonable amount.
    // Let's suggest subbing as many as available on bench, up to the number of eligible field players.
    const numToSub = Math.min(sortedOff.length, sortedOn.length);
    
    setSuggestedSubs({
      out: sortedOff.slice(0, numToSub).map(p => p.id),
      in: sortedOn.slice(0, numToSub).map(p => p.id)
    });
    setShowSubModal(true);
  }, [players]);

  const confirmSubs = (outIds: string[], inIds: string[]) => {
    setPlayers(prev => prev.map(p => {
      if (outIds.includes(p.id)) return { ...p, onField: false, shifts: p.shifts + 1 };
      if (inIds.includes(p.id)) return { ...p, onField: true, shifts: p.shifts + 1 };
      return p;
    }));
    setShowSubModal(false);
  };

  const handleManualSub = (playerId: string) => {
    setPlayers(prev => prev.map(p => {
      if (p.id === playerId) {
        return { ...p, onField: !p.onField, shifts: p.onField ? p.shifts : p.shifts + 1 };
      }
      return p;
    }));
  };

  const toggleLock = (playerId: string, type: 'on' | 'off') => {
    setPlayers(prev => prev.map(p => {
      if (p.id === playerId) {
        if (type === 'on') return { ...p, lockedOn: !p.lockedOn, lockedOff: false };
        if (type === 'off') return { ...p, lockedOff: !p.lockedOff, lockedOn: false };
      }
      return p;
    }));
  };

  const addPlayer = (name: string) => {
    if (!name.trim()) return;
    const newPlayer: Player = {
      id: Math.random().toString(36).substr(2, 9),
      name: name.trim(),
      onField: false,
      lockedOn: false,
      lockedOff: false,
      totalMinutes: 0,
      shifts: 0,
      currentShiftStartTime: null,
    };
    setPlayers(prev => [...prev, newPlayer]);
  };

  const removePlayer = (id: string) => {
    setPlayers(prev => prev.filter(p => p.id !== id));
  };

  const resetGame = () => {
    setIsRunning(false);
    setTimeRemaining(settings.halfLength * 60);
    setNextSubTime(settings.halfLength * 60 - settings.subInterval * 60);
    setCurrentHalf(1);
    setPlayers(prev => prev.map(p => ({
      ...p,
      onField: false,
      totalMinutes: 0,
      shifts: 0,
      currentShiftStartTime: null
    })));
    setGameState(GameState.SETUP);
  };

  const startMatch = () => {
    // Automatically assign first N players to field
    setPlayers(prev => {
      const fieldPlayers = prev.slice(0, settings.playersOnField);
      return prev.map((p, idx) => ({
        ...p,
        onField: idx < settings.playersOnField,
        shifts: idx < settings.playersOnField ? 1 : 0
      }));
    });
    setGameState(GameState.ACTIVE);
    setNextSubTime(settings.halfLength * 60 - settings.subInterval * 60);
  };

  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  // --- Render Views ---

  const renderSetup = () => (
    <div className="space-y-8 p-4 max-w-lg mx-auto pb-32">
      <section className="bg-white rounded-3xl p-6 shadow-sm border border-zinc-100 relative overflow-hidden">
        {/* Soccer field decoration */}
        <div className="absolute top-0 right-0 w-32 h-32 border-8 border-emerald-500/5 rounded-full -mr-16 -mt-16 pointer-events-none" />
        
        <div className="flex items-center gap-2 mb-6">
          <SettingsIcon className="w-5 h-5 text-zinc-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Game Settings</h2>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Half Length (min)</label>
            <input 
              type="number" 
              value={settings.halfLength} 
              onChange={e => setSettings({...settings, halfLength: parseInt(e.target.value) || 0})}
              className="w-full bg-zinc-50 border-0 rounded-2xl px-4 py-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold text-lg"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Sub Interval (min)</label>
            <input 
              type="number" 
              value={settings.subInterval} 
              onChange={e => setSettings({...settings, subInterval: parseInt(e.target.value) || 0})}
              className="w-full bg-zinc-50 border-0 rounded-2xl px-4 py-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold text-lg"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Players on Field</label>
            <input 
              type="number" 
              value={settings.playersOnField} 
              onChange={e => setSettings({...settings, playersOnField: parseInt(e.target.value) || 0})}
              className="w-full bg-zinc-50 border-0 rounded-2xl px-4 py-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold text-lg"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Num. of Halves</label>
            <input 
              type="number" 
              value={settings.numHalves} 
              onChange={e => setSettings({...settings, numHalves: parseInt(e.target.value) || 0})}
              className="w-full bg-zinc-50 border-0 rounded-2xl px-4 py-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold text-lg"
            />
          </div>
        </div>
      </section>

      <section className="bg-white rounded-3xl p-6 shadow-sm border border-zinc-100">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-zinc-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Roster ({players.length})</h2>
          </div>
          <button 
            onClick={() => setShowImport(!showImport)}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-full transition-colors"
          >
            {showImport ? 'Close' : 'Bulk Import'}
          </button>
        </div>

        {showImport ? (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="space-y-4 mb-8 bg-zinc-50 p-4 rounded-2xl"
          >
            <p className="text-[10px] uppercase font-black text-zinc-400">Paste names (one per line or comma separated)</p>
            <textarea 
              value={importText}
              onChange={e => setImportText(e.target.value)}
              className="w-full min-h-[120px] bg-white border-0 rounded-xl p-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 shadow-inner"
              placeholder="Emma, Olivia, Sarah, Chloe..."
            />
            <button 
              onClick={() => {
                importText.split(/[,\n]/).forEach(n => addPlayer(n.trim()));
                setImportText('');
                setShowImport(false);
              }}
              className="w-full bg-zinc-900 text-white py-3 rounded-xl font-bold hover:bg-zinc-800 transition-all"
            >
              Add to Roster
            </button>
          </motion.div>
        ) : (
          <div className="flex gap-2 mb-6">
            <input 
              type="text" 
              placeholder="Player first name..." 
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  addPlayer(e.currentTarget.value);
                  e.currentTarget.value = '';
                }
              }}
              className="flex-1 bg-zinc-50 border-0 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
            />
            <button 
               onClick={(e) => {
                 const input = e.currentTarget.previousSibling as HTMLInputElement;
                 addPlayer(input.value);
                 input.value = '';
               }}
               className="bg-zinc-900 text-white px-5 rounded-2xl hover:bg-zinc-800 transition-all shadow-lg active:scale-95"
            >
              <UserPlus className="w-5 h-5" />
            </button>
          </div>
        )}

        <div className="space-y-2">
          <AnimatePresence>
            {players.map(p => (
              <motion.div 
                key={p.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex items-center justify-between p-3 bg-zinc-50 rounded-2xl group"
              >
                <div className="flex items-center gap-3">
                   <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-xs font-bold text-zinc-400 border border-zinc-100 shadow-sm">
                     {p.name[0]?.toUpperCase()}
                   </div>
                   <span className="font-medium text-zinc-800">{p.name}</span>
                </div>
                <button 
                  onClick={() => removePlayer(p.id)}
                  className="p-2 text-zinc-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 sm:opacity-100"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          {players.length === 0 && (
            <div className="text-center py-8">
              <p className="text-zinc-400 text-sm">Roster is empty. Add some players to start.</p>
            </div>
          )}
        </div>
      </section>

      <div className="fixed bottom-8 left-4 right-4 max-w-lg mx-auto">
        <button 
          disabled={players.length < settings.playersOnField}
          onClick={startMatch}
          className="w-full bg-blue-600 text-white py-5 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 disabled:opacity-50 disabled:grayscale"
        >
          {players.length < settings.playersOnField ? `Add ${settings.playersOnField - players.length} more players` : 'Start Game'}
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );

  const renderGame = () => {
    const fieldPlayers = players.filter(p => p.onField);
    const benchPlayers = players.filter(p => !p.onField);

    return (
      <div className="flex flex-col min-h-screen bg-zinc-50 pb-24">
        {/* Sticky Header */}
        <div className="sticky top-0 z-20 bg-white border-b border-zinc-100 p-4 shadow-sm">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-zinc-900 text-white px-3 py-1 rounded-full text-xs font-bold">
                HALF {currentHalf}
              </div>
              <div className="font-mono text-3xl font-bold tracking-tighter text-zinc-900">
                {formatTime(timeRemaining)}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={resetGame}
                className="p-3 text-zinc-400 hover:text-zinc-900 transition-colors"
              >
                <RotateCcw className="w-6 h-6" />
              </button>
              <button 
                onClick={() => setIsRunning(!isRunning)}
                className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${
                  isRunning 
                  ? 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200' 
                  : 'bg-zinc-900 text-white hover:bg-zinc-800 shadow-zinc-200'
                }`}
              >
                {isRunning ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-2xl mx-auto w-full p-4 space-y-8">
          {/* Sub Alert */}
          <AnimatePresence>
            {timeRemaining > 0 && Math.floor(timeRemaining) <= Math.floor(nextSubTime + 10) && Math.floor(timeRemaining) > Math.floor(nextSubTime) && (
               <motion.div 
                 initial={{ opacity: 0, scale: 0.9 }}
                 animate={{ opacity: 1, scale: 1 }}
                 exit={{ opacity: 0, scale: 0.9 }}
                 className="bg-blue-600 p-4 rounded-2xl flex items-center justify-between shadow-lg shadow-blue-200"
               >
                 <div className="flex items-center gap-3">
                    <Info className="w-5 h-5 text-blue-100" />
                    <p className="text-sm font-bold text-white uppercase tracking-tight">Time to sub in {formatTime(timeRemaining - nextSubTime)}</p>
                 </div>
                 <button 
                  onClick={triggerSubSuggestion}
                  className="bg-white text-blue-600 px-3 py-1 rounded-lg text-xs font-black uppercase"
                 >
                   Now
                 </button>
               </motion.div>
            )}
          </AnimatePresence>

          {/* End of Half / Game */}
          {timeRemaining === 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-zinc-900 p-8 rounded-[2.5rem] text-center space-y-6 shadow-2xl"
            >
              <div className="space-y-2">
                <h2 className="text-3xl font-black text-white italic transition-all">
                  {currentHalf < settings.numHalves ? `HALF ${currentHalf} OVER` : 'FINAL WHISTLE'}
                </h2>
                <p className="text-zinc-500 font-medium">Great work team!</p>
              </div>
              
              <div className="flex flex-col gap-3">
                {currentHalf < settings.numHalves ? (
                  <button 
                    onClick={() => {
                      setCurrentHalf(h => h + 1);
                      setTimeRemaining(settings.halfLength * 60);
                      setNextSubTime(settings.halfLength * 60 - settings.subInterval * 60);
                    }}
                    className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2"
                  >
                    Start Half {currentHalf + 1}
                  </button>
                ) : (
                  <button 
                    onClick={() => setGameState(GameState.SUMMARY)}
                    className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2"
                  >
                    View Final Stats
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* Field Section */}
          <section className="relative">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Live on Field ({fieldPlayers.length})
              </h3>
              <div className="text-[10px] font-bold text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-md">
                TARGET: {settings.playersOnField}
              </div>
            </div>
            
            {/* Visual Field Accent */}
            <div className="absolute inset-x-0 -top-4 bottom-0 bg-emerald-500/5 rounded-[3rem] -z-10 pointer-events-none" />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fieldPlayers.map(p => (
                <motion.div 
                  layout
                  key={p.id} 
                  className="bg-white border border-zinc-200/50 p-5 rounded-[2rem] shadow-sm relative overflow-hidden group touch-manipulation hover:border-emerald-200 transition-colors"
                >
                  <div className="absolute top-0 right-0 p-1">
                    <button 
                      onClick={() => toggleLock(p.id, 'on')}
                      className={`p-2 rounded-full transition-colors ${p.lockedOn ? 'text-blue-600 bg-blue-50' : 'text-zinc-200 hover:text-zinc-400'}`}
                    >
                      {p.lockedOn ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                      {p.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-zinc-900">{p.name}</h4>
                      <p className="text-xs text-zinc-400 font-medium">Played: <span className="text-zinc-600">{Math.floor(p.totalMinutes)}m</span> • {p.shifts} shifts</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleManualSub(p.id)}
                    className="mt-4 w-full py-2 bg-zinc-50 rounded-xl text-xs font-bold text-zinc-500 hover:bg-zinc-100 transition-colors"
                  >
                    Bench Player
                  </button>
                </motion.div>
              ))}
            </div>
          </section>

          {/* Bench Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-400">BENCH ({benchPlayers.length})</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {benchPlayers.map(p => (
                <div key={p.id} className="bg-zinc-100/50 border border-zinc-200/50 p-4 rounded-2xl shadow-sm relative group opacity-80">
                  <div className="absolute top-0 right-0 p-1">
                    <button 
                      onClick={() => toggleLock(p.id, 'off')}
                      className={`p-2 rounded-full transition-colors ${p.lockedOff ? 'text-red-500 bg-red-50' : 'text-zinc-300 hover:text-zinc-500'}`}
                    >
                      {p.lockedOff ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-zinc-200 text-zinc-500 flex items-center justify-center font-bold">
                      {p.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-zinc-600">{p.name}</h4>
                      <p className="text-xs text-zinc-400 font-medium">Played: <span className="text-zinc-500">{Math.floor(p.totalMinutes)}m</span> • {p.shifts} shifts</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleManualSub(p.id)}
                    className="mt-4 w-full py-2 bg-zinc-200/50 rounded-xl text-xs font-bold text-zinc-500 hover:bg-emerald-500 hover:text-white transition-all"
                  >
                    Send to Field
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Global Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-zinc-100 p-4 flex gap-4 max-w-2xl mx-auto shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
           <button 
             onClick={triggerSubSuggestion}
             className="flex-1 bg-zinc-900 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2"
           >
             <Users className="w-5 h-5" />
             Suggest Subs
           </button>
           <button 
             onClick={() => setGameState(GameState.SUMMARY)}
             className="px-6 bg-zinc-100 text-zinc-600 rounded-2xl font-bold flex items-center justify-center"
           >
             Stats
           </button>
        </div>

        {/* Sub Modal */}
        <AnimatePresence>
          {showSubModal && (
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="fixed inset-0 z-50 bg-zinc-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
            >
              <motion.div 
                initial={{ y: 100 }}
                animate={{ y: 0 }}
                exit={{ y: 100 }}
                className="bg-white w-full max-w-lg rounded-t-[2.5rem] sm:rounded-[2.5rem] p-8 shadow-2xl space-y-6"
              >
                <div className="text-center space-y-1">
                  <h2 className="text-2xl font-black text-zinc-900">Recommended Subs</h2>
                  <p className="text-zinc-500 font-medium italic">Based on playing time fairness</p>
                </div>

                <div className="grid grid-cols-2 gap-8 py-4">
                  <div className="space-y-4">
                    <span className="text-[10px] font-black tracking-widest text-red-400 uppercase">Coming Off</span>
                    {suggestedSubs.out.map(id => {
                      const p = players.find(x => x.id === id);
                      return (
                        <div key={id} className="flex items-center gap-3">
                           <div className="w-8 h-8 rounded-full bg-red-50 text-red-500 flex items-center justify-center text-xs font-bold">OUT</div>
                           <span className="font-bold text-zinc-700">{p?.name}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="space-y-4">
                    <span className="text-[10px] font-black tracking-widest text-emerald-400 uppercase">Coming On</span>
                    {suggestedSubs.in.map(id => {
                      const p = players.find(x => x.id === id);
                      return (
                        <div key={id} className="flex items-center gap-3">
                           <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center text-xs font-bold">IN</div>
                           <span className="font-bold text-zinc-700">{p?.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={() => setShowSubModal(false)}
                    className="flex-1 py-4 px-6 rounded-2xl font-bold bg-zinc-100 text-zinc-500"
                  >
                    Wait / Skip
                  </button>
                  <button 
                    onClick={() => confirmSubs(suggestedSubs.out, suggestedSubs.in)}
                    className="flex-[2] py-4 px-6 rounded-2xl font-bold bg-blue-600 text-white shadow-xl shadow-blue-100 flex items-center justify-center gap-2"
                  >
                    Apply Now <Check className="w-5 h-5" />
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const renderSummary = () => {
    const sortedPlayers = [...players].sort((a, b) => b.totalMinutes - a.totalMinutes);
    const avgMins = players.reduce((sum, p) => sum + p.totalMinutes, 0) / (players.length || 1);

    return (
      <div className="p-4 max-w-2xl mx-auto space-y-8 bg-zinc-50 min-h-screen">
        <header className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-zinc-100 text-center space-y-2">
           <h1 className="text-3xl font-black text-zinc-900 tracking-tight">Match Summary</h1>
           <p className="text-zinc-500 font-medium">Rotation Fairness Overview</p>
        </header>

        <section className="bg-white rounded-[2.5rem] overflow-hidden shadow-sm border border-zinc-100">
          <div className="p-6 border-b border-zinc-50 flex items-center justify-between">
             <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Player Statistics</h3>
             <button 
               onClick={() => {
                 const text = players.map(p => `${p.name}: ${Math.round(p.totalMinutes)} mins, ${p.shifts} shifts`).join('\n');
                 navigator.clipboard.writeText(text);
                 alert('Stats copied to clipboard!');
               }}
               className="text-blue-600 text-xs font-bold flex items-center gap-1"
             >
               <FileDown className="w-4 h-4" /> Copy CSV
             </button>
          </div>
          <div className="divide-y divide-zinc-50">
            {sortedPlayers.map(p => {
              const diff = p.totalMinutes - avgMins;
              const isLow = diff < -3;
              const isHigh = diff > 3;

              return (
                <div key={p.id} className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-zinc-50 text-zinc-400 flex items-center justify-center font-bold border border-zinc-100">
                      {p.name[0].toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-zinc-800">{p.name}</h4>
                      <p className="text-xs text-zinc-400">{p.shifts} total shifts</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xl font-black ${isLow ? 'text-red-500' : isHigh ? 'text-emerald-500' : 'text-zinc-900'}`}>
                      {Math.round(p.totalMinutes)} m
                    </div>
                    {isLow && <span className="text-[10px] font-bold text-red-400 uppercase tracking-tighter">Needs more time</span>}
                    {isHigh && <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-tighter">Played plenty</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex flex-col gap-3">
          <button 
             onClick={() => setGameState(GameState.ACTIVE)}
             className="w-full bg-zinc-900 text-white py-5 rounded-2xl font-bold flex items-center justify-center gap-2"
          >
             Back to Match
          </button>
          <button 
             onClick={resetGame}
             className="w-full bg-white text-red-500 border border-red-100 py-5 rounded-2xl font-bold"
          >
             End Session / New Game
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 selection:bg-blue-100">
      <nav className="p-4 flex items-center justify-between border-b border-zinc-200/50 bg-white/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-2">
           <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-200">
             <Play className="w-4 h-4 text-white fill-current" />
           </div>
           <span className="font-black text-lg tracking-tight">FAIRPLAY</span>
        </div>
        <div className="flex gap-4">
           {gameState !== GameState.SETUP && (
              <button 
                onClick={() => setGameState(GameState.SETUP)}
                className="text-xs font-bold text-zinc-500 uppercase tracking-widest hover:text-zinc-900"
              >
                Roster
              </button>
           )}
        </div>
      </nav>

      <main>
        {gameState === GameState.SETUP && renderSetup()}
        {gameState === GameState.ACTIVE && renderGame()}
        {gameState === GameState.SUMMARY && renderSummary()}
      </main>
    </div>
  );
}

