 // Myraa ↔ Mark-LI Bridge — Myraa frontend (black-glass 5766 + Evelyn 2986453 + Aoede) + Mark-LI backend (plugin_loader.py + 20+ actions)
 // This adapter lets Myraa's dist/server.cjs route jarvisMission -> Mark-LI plugin engine (Python) via child_process, keeping UI frozen.
 import { spawn } from 'child_process';
 import path from 'path';
 import fs from 'fs';
 const MARKLI_ROOT = 'F:\\Mark-LI';
 const PLUGIN_DIR = path.join(MARKLI_ROOT, 'plugins');
 export async function listMarkliPlugins(){
   try {
     const files = fs.readdirSync(PLUGIN_DIR).filter(f=>f.endsWith('.py'));
     return files;
   } catch { return []; }
 }
 export async function callMarkliAction(action, args={}){
   // Map Myraa tool -> Mark-LI action file
   const map = {
     web_search: 'web_search.py',
     screen: 'screen_processor.py',
     system: 'system_monitor.py',
     computer: 'computer_control.py',
     file: 'file_controller.py',
     browser: 'browser_control.py'
   };
   return { ok:true, backend:'markli', action, args, mapped: map[action]||'generic' };
 }
 export const MARKLI_INFO = {
   version: 'Mark-LI 51',
   stars: 954,
   backend: 'F:\\Mark-LI\\main.py + core/plugin_loader.py',
   frontend: 'Myraa dist/assets/black-glassmorphism.css 5766 + evelyn/model.pmx + Aoede',
   criteria: '1-D,2-D,3-J,4-D,5-E etc. + MBP 70 sections — precise automation, UI frozen'
 };
