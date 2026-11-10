import React, { useState } from 'react';
import { WeaponProject } from '../types/weapon';
import { generateLuaCode, generateModToml, generateProfileToml, sanitizeModFolder } from '../utils/luaGenerator';
import { Copy, Check, FileCode2, Settings, UserCheck, X } from 'lucide-react';

interface LuaPreviewModalProps {
  project: WeaponProject;
  isOpen?: boolean;
  onClose?: () => void;
  inline?: boolean;
}

export const LuaPreviewModal: React.FC<LuaPreviewModalProps> = ({ project, isOpen = true, onClose, inline = false }) => {
  const [activeFile, setActiveFile] = useState<'lua' | 'mod_toml' | 'profile_toml'>('lua');
  const [copied, setCopied] = useState(false);

  if (!inline && !isOpen) return null;

  const luaCode = generateLuaCode(project);
  const modToml = generateModToml(project);
  const profileToml = generateProfileToml(project);

  const getActiveContent = () => {
    if (activeFile === 'lua') return luaCode;
    if (activeFile === 'mod_toml') return modToml;
    return profileToml;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(getActiveContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const containerContent = (
    <div className={`flex flex-col ${inline ? 'h-full' : 'max-h-[85vh]'} bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden shadow-xs transition-colors`}>
      {/* File Selector Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/60">
        <div className="flex items-center gap-1.5 p-1 bg-stone-200/60 dark:bg-stone-700/60 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveFile('lua')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors ${
              activeFile === 'lua'
                ? 'bg-white dark:bg-stone-900 text-forge-600 dark:text-forge-400 font-bold shadow-xs'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            weapons/{sanitizeModFolder(project.id)}.lua
          </button>

          <button
            type="button"
            onClick={() => setActiveFile('mod_toml')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors ${
              activeFile === 'mod_toml'
                ? 'bg-white dark:bg-stone-900 text-forge-600 dark:text-forge-400 font-bold shadow-xs'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            mod.toml
          </button>

          <button
            type="button"
            onClick={() => setActiveFile('profile_toml')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors ${
              activeFile === 'profile_toml'
                ? 'bg-white dark:bg-stone-900 text-forge-600 dark:text-forge-400 font-bold shadow-xs'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            profiles/{project.name || 'Profile'}.toml
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyToClipboard}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-stone-300 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 border border-stone-300 dark:border-stone-700 rounded-md transition-colors shadow-2xs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-forge-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : 'Copy Code'}</span>
          </button>

          {!inline && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Code Editor Viewport */}
      <div className="flex-1 overflow-auto bg-stone-950 p-4 font-mono text-xs leading-relaxed text-forge-400">
        <pre className="whitespace-pre-wrap select-text">{getActiveContent()}</pre>
      </div>

      {/* Footer Info */}
      <div className="px-4 py-2.5 bg-stone-100/80 dark:bg-stone-800/80 border-t border-stone-200 dark:border-stone-800 text-[11px] text-stone-500 dark:text-stone-400 flex items-center justify-between">
        <span>
          {activeFile === 'lua' && 'Component definition file executed when match loads.'}
          {activeFile === 'mod_toml' && 'Mod manifest declaring components, API version 4 & sprite animations.'}
          {activeFile === 'profile_toml' && 'Profile scheme placing the weapon alongside stock weapons for testing.'}
        </span>
        <span className="font-mono text-forge-600 dark:text-forge-400 font-semibold">
          WormForge bundle
        </span>
      </div>
    </div>
  );

  if (inline) {
    return containerContent;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-4xl">{containerContent}</div>
    </div>
  );
};
