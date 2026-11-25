// Unit tests for the single-panel navigation flow (pure helpers).
// Run with: npm run test:navigation
import assert from 'node:assert/strict';
import {
  popNavigation,
  pushNavigation,
  resetNavigation,
  type NavigationSnapshot,
  type PanelView,
} from '../src/amongus/navigation.js';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✅ ${name}`);
}

function view(kind: PanelView['kind'], label: string): PanelView {
  return {
    kind,
    render: async () => ({ kind, label }) as never,
  };
}

console.log('🧪 Speaking/Among Us — single-panel navigation tests');

test('navigating pushes the previous view instead of replacing it', () => {
  const main = view('main', 'main');
  const players = view('players', 'players');
  const detail = view('player', 'detail');
  let nav: NavigationSnapshot = { current: main, stack: [] };
  nav = pushNavigation(nav, players);
  nav = pushNavigation(nav, detail);
  assert.equal(nav.current.kind, 'player');
  assert.deepEqual(nav.stack.map((v) => v.kind), ['main', 'players']);
});

test('Back returns to the immediately previous view', () => {
  const main = view('main', 'main');
  const players = view('players', 'players');
  const detail = view('player', 'detail');
  let nav: NavigationSnapshot = { current: main, stack: [] };
  nav = pushNavigation(nav, players);
  nav = pushNavigation(nav, detail);
  nav = popNavigation(nav, main);
  assert.equal(nav.current.kind, 'players');
  nav = popNavigation(nav, main);
  assert.equal(nav.current.kind, 'main');
  assert.equal(nav.stack.length, 0);
});

test('Back from the root stays on the main view', () => {
  const main = view('main', 'main');
  const nav = popNavigation({ current: main, stack: [] }, main);
  assert.equal(nav.current.kind, 'main');
  assert.equal(nav.stack.length, 0);
});

test('reset clears history (used by /amongus, setup finish and End Session)', () => {
  const main = view('main', 'main');
  let nav: NavigationSnapshot = { current: main, stack: [] };
  nav = pushNavigation(nav, view('settings', 'settings'));
  nav = pushNavigation(nav, view('speaking', 'speaking'));
  nav = resetNavigation(main);
  assert.equal(nav.current.kind, 'main');
  assert.equal(nav.stack.length, 0);
});

test('render closures are re-invoked on every panel refresh', async () => {
  let renders = 0;
  const fresh: PanelView = {
    kind: 'speaking',
    render: async () => {
      renders++;
      return { renders } as never;
    },
  };
  await fresh.render();
  await fresh.render();
  assert.equal(renders, 2);
});

console.log(`\n✅ ${passed} navigation tests passed.`);
