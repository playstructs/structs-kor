/* Attract mode: two computer fleets fighting on the real board, silently, forever — the title
 * screen's live window into the game. A new seed each round. */
import { Board } from './map/board';
import { Chain, type AttackDetail } from '../sim/chain';
import { Ai } from '../sim/ai';
import { CPU, YOU, chainSetup, layout } from '../sim/fleets';
import { COMMAND_SHIP_ID } from '../data/catalogue';

export function attract(host: HTMLElement, maxHeight = 340, stage = false): () => void {
  let alive = true;
  const board = new Board({ quiet: true, speed: 1.8, maxHeight: () => maxHeight, zoom: 'close', stage, label: '실시간 교전 미리보기' });
  board.el.classList.add('bd-attract');
  host.appendChild(board.el);
  const round = async () => {
    while (alive) {
      const seed = 'ATTRACT-' + Math.random().toString(36).slice(2, 7);
      const { setup } = chainSetup(layout('difficult', seed), seed, { player: 12, computer: 12 });
      const chain = new Chain(setup);
      const a = new Ai(YOU.id, 'hard', seed + ':a'), b = new Ai(CPU.id, 'hard', seed + ':b');
      const sync = () => board.setStructs(Object.values(chain.structs).map((s) => ({
        id: s.id, typeId: s.typeId, ambit: s.ambit, slot: s.slot, side: s.owner === YOU.id ? 'defender' : 'attacker', category: 'fleet',
        isCommand: s.typeId === COMMAND_SHIP_ID, health: chain.isDestroyed(s) ? 0 : s.health, maxHealth: chain.typeOf(s).maxHealth,
      })));
      sync();
      for (let i = 0; i < 300 && alive && chain.fleetsAtBattle().length > 1; i++) {
        await new Promise((r) => setTimeout(r, 900));
        await board.idle();
        if (!board.el.isConnected) alive = false;
        if (!alive) { board.dispose(); return; }
        sync();
        for (const [ai, id] of [[a, YOU.id], [b, CPU.id]] as const) { const m = ai.decide(chain); if (m) chain.submit(id, m); }
        for (const tx of chain.produceBlock().txs) for (const ev of tx.events) if (ev.category === 'struct_attack') board.playAttack(ev.detail as AttackDetail);
      }
      await board.idle();
      await new Promise((r) => setTimeout(r, 2500));
    }
  };
  void round();
  return () => { alive = false; board.dispose(); };
}
