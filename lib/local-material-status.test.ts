import { expect, it } from 'vitest';
import { localMaterialStatus } from './local-material-status';

it('does not label an empty local cache as a completed clinical encounter', () => {
  expect(localMaterialStatus({status:'completed',transcript:[],decisions:[],audio:null})).toBe('Материалов пока нет');
  expect(localMaterialStatus({status:'in_progress',transcript:[],decisions:[],audio:null})).toBe('Локальный сеанс открыт');
});
it('describes local material state without claiming server completion or active recording', () => {
  const audio = new Blob(['synthetic']);
  expect(localMaterialStatus({status:'completed',transcript:[],decisions:[],audio})).toBe('Локальный сеанс закрыт');
  expect(localMaterialStatus({status:'interrupted',transcript:[],decisions:[],audio})).toBe('Локальный сеанс прерван');
});
