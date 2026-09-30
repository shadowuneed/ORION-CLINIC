import { expect, it, vi } from 'vitest';
vi.mock('./local-account-mode',()=>({localAccountModeEnabled:()=>true}));
import { listEncounters,markAbandonedEncountersInterrupted,saveEncounter } from './encounter-history';

it('never opens, reads, updates or deletes the legacy archive in personal local account mode',async()=>{
  const open=vi.fn(),deleteDatabase=vi.fn();
  vi.stubGlobal('window',{indexedDB:{open,deleteDatabase}});
  try {
    await expect(listEncounters()).rejects.toThrow('изолирован');
    await expect(markAbandonedEncountersInterrupted()).rejects.toThrow('изолирован');
    await expect(saveEncounter({} as Parameters<typeof saveEncounter>[0])).rejects.toThrow('изолирован');
    expect(open).not.toHaveBeenCalled();expect(deleteDatabase).not.toHaveBeenCalled();
  }finally{vi.unstubAllGlobals();}
});
